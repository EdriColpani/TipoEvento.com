export const WALLET_QR_PREFIX = 'EFW';
export const WALLET_QR_DEFAULT_TTL_SECONDS = 90;
export const WALLET_QR_ALLOWED_TTLS = [60, 90, 120] as const;
export type WalletQrTtlOption = (typeof WALLET_QR_ALLOWED_TTLS)[number];

export const WALLET_QR_CLOCK_SKEW_SECONDS = 10;

export function normalizeWalletQrTtlSeconds(raw?: number | null): number {
  const n = Number(raw);
  if ((WALLET_QR_ALLOWED_TTLS as readonly number[]).includes(n)) return n;
  return WALLET_QR_DEFAULT_TTL_SECONDS;
}

export function walletQrRefreshSeconds(ttlSeconds: number): number {
  const ttl = normalizeWalletQrTtlSeconds(ttlSeconds);
  return Math.max(15, ttl - 15);
}

type WalletQrPayload = {
  uid: string;
  exp: number;
  iat: number;
  jti: string;
};

function getSecretBytes(): Uint8Array {
  const raw = (Deno.env.get('WALLET_QR_SIGNING_SECRET') ?? Deno.env.get('ENTRY_QR_SIGNING_SECRET') ?? '').trim();
  if (raw.length < 16) {
    throw new Error('WALLET_QR_SIGNING_SECRET (ou ENTRY_QR_SIGNING_SECRET) não configurada.');
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

export async function signWalletQrToken(
  userId: string,
  options?: { ttlSeconds?: number | null },
): Promise<{ token: string; expiresAt: string; refreshInSeconds: number; ttlSeconds: number }> {
  const ttlSeconds = normalizeWalletQrTtlSeconds(options?.ttlSeconds);
  const now = Math.floor(Date.now() / 1000);
  const payload: WalletQrPayload = {
    uid: userId,
    iat: now,
    exp: now + ttlSeconds,
    jti: crypto.randomUUID(),
  };
  const payloadB64 = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const message = `${WALLET_QR_PREFIX}.${payloadB64}`;
  const sig = await signSegment(message);
  return {
    token: `${message}.${sig}`,
    expiresAt: new Date(payload.exp * 1000).toISOString(),
    refreshInSeconds: walletQrRefreshSeconds(ttlSeconds),
    ttlSeconds,
  };
}

export type WalletQrVerifyErrorCode = 'qr_expired' | 'qr_invalid' | 'qr_malformed';

export type WalletQrVerifyResult =
  | { ok: true; userId: string }
  | { ok: false; error_code: WalletQrVerifyErrorCode; message: string };

export async function verifyWalletQrToken(token: string): Promise<WalletQrVerifyResult> {
  const trimmed = token.trim();
  const parts = trimmed.split('.');
  if (parts.length !== 3 || parts[0] !== WALLET_QR_PREFIX) {
    return { ok: false, error_code: 'qr_malformed', message: 'QR da carteira inválido.' };
  }

  const [, payloadB64, sigB64] = parts;
  const message = `${WALLET_QR_PREFIX}.${payloadB64}`;
  const sigOk = await verifySegment(message, sigB64);
  if (!sigOk) {
    return { ok: false, error_code: 'qr_invalid', message: 'QR da carteira inválido ou adulterado.' };
  }

  let payload: WalletQrPayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(payloadB64))) as WalletQrPayload;
  } catch {
    return { ok: false, error_code: 'qr_malformed', message: 'QR da carteira inválido.' };
  }

  if (!payload.uid || !payload.exp) {
    return { ok: false, error_code: 'qr_malformed', message: 'QR da carteira inválido.' };
  }

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp < now - WALLET_QR_CLOCK_SKEW_SECONDS) {
    return {
      ok: false,
      error_code: 'qr_expired',
      message: 'QR expirado. Peça ao cliente para abrir a carteira novamente.',
    };
  }

  return { ok: true, userId: payload.uid };
}

export function isWalletQrToken(code: string): boolean {
  return code.trim().startsWith(`${WALLET_QR_PREFIX}.`);
}
