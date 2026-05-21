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

async function importAesKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', getEncryptionKeyBytes(), { name: 'AES-GCM' }, false, ['encrypt']);
}

export async function encryptCredential(plaintext: string): Promise<string> {
  const key = await importAesKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(plaintext.trim()),
  );
  const combined = new Uint8Array(iv.length + cipher.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(cipher), iv.length);
  return btoa(String.fromCharCode(...combined));
}

export function last4(value: string): string | null {
  const t = value.trim();
  return t.length >= 4 ? t.slice(-4) : null;
}
