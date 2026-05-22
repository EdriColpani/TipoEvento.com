export const ENTRY_QR_PREFIX = 'EF1';
export const ENTRY_QR_DEFAULT_TTL_SECONDS = 90;
export const ENTRY_QR_CLOCK_SKEW_SECONDS = 10;
export const ENTRY_QR_ALLOWED_TTLS = [60, 90, 120] as const;

/** Legado — preferir normalizeEntryQrTtlSeconds. */
export const ENTRY_QR_TTL_SECONDS = ENTRY_QR_DEFAULT_TTL_SECONDS;
export const ENTRY_QR_REFRESH_SECONDS = entryQrRefreshSeconds(ENTRY_QR_DEFAULT_TTL_SECONDS);

type EntryQrPayload = {
  aid: string;
  uid: string;
  exp: number;
  iat: number;
  ver: number;
};

export function normalizeEntryQrTtlSeconds(raw?: number | null): number {
  const n = Number(raw);
  if ((ENTRY_QR_ALLOWED_TTLS as readonly number[]).includes(n)) return n;
  return ENTRY_QR_DEFAULT_TTL_SECONDS;
}

/** Renova o QR um pouco antes de expirar (margem para fila na portaria). */
export function entryQrRefreshSeconds(ttlSeconds: number): number {
  const ttl = normalizeEntryQrTtlSeconds(ttlSeconds);
  return Math.max(15, ttl - 15);
}

function getSecretBytes(): Uint8Array {
  const raw = (Deno.env.get('ENTRY_QR_SIGNING_SECRET') ?? '').trim();
  if (raw.length < 16) {
    throw new Error('ENTRY_QR_SIGNING_SECRET não configurada (mín. 16 caracteres).');
  }
  const enc = new TextEncoder().encode(raw);
  const out = new Uint8Array(32);
  out.set(enc.slice(0, 32));
  if (enc.length < 32) {
    for (let i = enc.length; i < 32; i++) out[i] = enc[i % enc.length];
  }
  return out;
}

async function hmacKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', getSecretBytes(), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ]);
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + pad;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function signSegment(message: string): Promise<string> {
  const key = await hmacKey();
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return bytesToBase64Url(new Uint8Array(sig));
}

async function verifySegment(message: string, signatureB64: string): Promise<boolean> {
  const key = await hmacKey();
  const sigBytes = base64UrlToBytes(signatureB64);
  return crypto.subtle.verify('HMAC', key, sigBytes, new TextEncoder().encode(message));
}

export async function signEntryToken(
  analyticsId: string,
  userId: string,
  options: { ttlSeconds?: number | null; tokenVersion?: number },
): Promise<{ token: string; expiresAt: string; refreshInSeconds: number; ttlSeconds: number }> {
  const ttlSeconds = normalizeEntryQrTtlSeconds(options.ttlSeconds);
  const tokenVersion = Math.max(0, Math.floor(options.tokenVersion ?? 0));
  const now = Math.floor(Date.now() / 1000);
  const payload: EntryQrPayload = {
    aid: analyticsId,
    uid: userId,
    iat: now,
    exp: now + ttlSeconds,
    ver: tokenVersion,
  };
  const payloadB64 = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const message = `${ENTRY_QR_PREFIX}.${payloadB64}`;
  const sig = await signSegment(message);
  return {
    token: `${message}.${sig}`,
    expiresAt: new Date(payload.exp * 1000).toISOString(),
    refreshInSeconds: entryQrRefreshSeconds(ttlSeconds),
    ttlSeconds,
  };
}

export type EntryQrVerifyErrorCode =
  | 'qr_expired'
  | 'qr_invalid'
  | 'qr_malformed'
  | 'qr_revoked';

export type EntryQrVerifyResult =
  | { ok: true; analyticsId: string; userId: string; tokenVersion: number }
  | { ok: false; error_code: EntryQrVerifyErrorCode; message: string };

export async function verifyEntryToken(token: string): Promise<EntryQrVerifyResult> {
  const trimmed = token.trim();
  const parts = trimmed.split('.');
  if (parts.length !== 3 || parts[0] !== ENTRY_QR_PREFIX) {
    return {
      ok: false,
      error_code: 'qr_malformed',
      message: 'QR inválido ou adulterado.',
    };
  }

  const [, payloadB64, sigB64] = parts;
  const message = `${ENTRY_QR_PREFIX}.${payloadB64}`;
  const sigOk = await verifySegment(message, sigB64);
  if (!sigOk) {
    return {
      ok: false,
      error_code: 'qr_invalid',
      message: 'QR inválido ou adulterado.',
    };
  }

  let payload: EntryQrPayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(payloadB64))) as EntryQrPayload;
  } catch {
    return {
      ok: false,
      error_code: 'qr_malformed',
      message: 'QR inválido ou adulterado.',
    };
  }

  if (!payload.aid || !payload.uid || !payload.exp) {
    return {
      ok: false,
      error_code: 'qr_malformed',
      message: 'QR inválido ou adulterado.',
    };
  }

  const tokenVersion = typeof payload.ver === 'number' ? Math.floor(payload.ver) : 0;

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp < now - ENTRY_QR_CLOCK_SKEW_SECONDS) {
    return {
      ok: false,
      error_code: 'qr_expired',
      message: 'QR expirado. Peça ao cliente para abrir o ingresso no app novamente.',
    };
  }

  return { ok: true, analyticsId: payload.aid, userId: payload.uid, tokenVersion };
}

export function isDynamicEntryQr(code: string): boolean {
  return code.trim().startsWith(`${ENTRY_QR_PREFIX}.`);
}
