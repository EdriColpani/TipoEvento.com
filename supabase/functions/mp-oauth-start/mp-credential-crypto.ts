function getEncryptionKeyBytes(): Uint8Array {
  const raw = (Deno.env.get('PAYMENT_CREDENTIALS_ENCRYPTION_KEY') ?? '').trim();
  if (raw.length < 16) throw new Error('PAYMENT_CREDENTIALS_ENCRYPTION_KEY não configurada.');
  const enc = new TextEncoder().encode(raw);
  const out = new Uint8Array(32);
  out.set(enc.slice(0, 32));
  if (enc.length < 32) {
    for (let i = enc.length; i < 32; i++) out[i] = enc[i % enc.length];
  }
  return out;
}

function toBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function randomVerifier(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return toBase64Url(bytes);
}

export async function sha256Challenge(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return toBase64Url(new Uint8Array(hash));
}

export function randomState(): string {
  return crypto.randomUUID();
}
