/** UUID v4 — funciona em HTTP (crypto.randomUUID exige contexto seguro: HTTPS ou localhost). */
export function generateRandomUuid(): string {
    const safeCrypto = globalThis.crypto as Crypto | undefined;
    if (safeCrypto && typeof safeCrypto.randomUUID === 'function') {
        return safeCrypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
        const rnd = (Math.random() * 16) | 0;
        const val = ch === 'x' ? rnd : (rnd & 0x3) | 0x8;
        return val.toString(16);
    });
}
