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

export async function decryptCredential(ciphertextB64: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', getEncryptionKeyBytes(), { name: 'AES-GCM' }, false, ['decrypt']);
  const combined = Uint8Array.from(atob(ciphertextB64), (c) => c.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const data = combined.slice(12);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
  return new TextDecoder().decode(plain);
}
