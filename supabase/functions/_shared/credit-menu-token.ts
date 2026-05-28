export const CREDIT_MENU_TOKEN_PREFIX = 'EFM';
const CREDIT_MENU_DEFAULT_TTL_SECONDS = 300;
const CREDIT_MENU_MAX_TTL_SECONDS = 1800;
const CREDIT_MENU_CLOCK_SKEW_SECONDS = 15;

type CreditMenuPayload = {
  est: string;
  exp: number;
  iat: number;
  jti: string;
};

function getSecretBytes(): Uint8Array {
  const raw = (
    Deno.env.get('CREDIT_MENU_QR_SIGNING_SECRET')
    ?? Deno.env.get('WALLET_QR_SIGNING_SECRET')
    ?? Deno.env.get('ENTRY_QR_SIGNING_SECRET')
    ?? ''
  ).trim();
  if (raw.length < 16) {
    throw new Error('CREDIT_MENU_QR_SIGNING_SECRET não configurada.');
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

function normalizeTtl(raw?: number | null): number {
  const ttl = Number(raw ?? CREDIT_MENU_DEFAULT_TTL_SECONDS);
  if (!Number.isFinite(ttl) || ttl <= 0) return CREDIT_MENU_DEFAULT_TTL_SECONDS;
  return Math.min(CREDIT_MENU_MAX_TTL_SECONDS, Math.max(60, Math.floor(ttl)));
}

export async function signCreditMenuToken(
  establishmentId: string,
  options?: { ttlSeconds?: number | null },
): Promise<{ token: string; expiresAt: string; ttlSeconds: number }> {
  const ttlSeconds = normalizeTtl(options?.ttlSeconds);
  const now = Math.floor(Date.now() / 1000);
  const payload: CreditMenuPayload = {
    est: establishmentId,
    iat: now,
    exp: now + ttlSeconds,
    jti: crypto.randomUUID(),
  };
  const payloadB64 = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const message = `${CREDIT_MENU_TOKEN_PREFIX}.${payloadB64}`;
  const sig = await signSegment(message);
  return {
    token: `${message}.${sig}`,
    expiresAt: new Date(payload.exp * 1000).toISOString(),
    ttlSeconds,
  };
}

type CreditMenuVerifyErrorCode = 'menu_qr_expired' | 'menu_qr_invalid' | 'menu_qr_malformed';
export type CreditMenuVerifyResult =
  | { ok: true; establishmentId: string }
  | { ok: false; error_code: CreditMenuVerifyErrorCode; message: string };

export async function verifyCreditMenuToken(token: string): Promise<CreditMenuVerifyResult> {
  const trimmed = token.trim();
  const parts = trimmed.split('.');
  if (parts.length !== 3 || parts[0] !== CREDIT_MENU_TOKEN_PREFIX) {
    return { ok: false, error_code: 'menu_qr_malformed', message: 'QR do balcão inválido.' };
  }
  const [, payloadB64, sigB64] = parts;
  const message = `${CREDIT_MENU_TOKEN_PREFIX}.${payloadB64}`;
  const sigOk = await verifySegment(message, sigB64);
  if (!sigOk) {
    return { ok: false, error_code: 'menu_qr_invalid', message: 'QR do balcão inválido.' };
  }

  let payload: CreditMenuPayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(payloadB64))) as CreditMenuPayload;
  } catch {
    return { ok: false, error_code: 'menu_qr_malformed', message: 'QR do balcão inválido.' };
  }

  if (!payload.est || !payload.exp) {
    return { ok: false, error_code: 'menu_qr_malformed', message: 'QR do balcão inválido.' };
  }

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp < now - CREDIT_MENU_CLOCK_SKEW_SECONDS) {
    return { ok: false, error_code: 'menu_qr_expired', message: 'QR do balcão expirado.' };
  }

  return { ok: true, establishmentId: payload.est };
}
