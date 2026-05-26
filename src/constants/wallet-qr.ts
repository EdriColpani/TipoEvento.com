/** Alinhado a `wallet-qr-token.ts` no backend (prefixo EFW). */
export const WALLET_QR_PREFIX = 'EFW';
export const WALLET_QR_DEFAULT_TTL_SECONDS = 90;

export function walletQrRefreshMs(ttlSeconds: number): number {
    const ttl = ttlSeconds > 0 ? ttlSeconds : WALLET_QR_DEFAULT_TTL_SECONDS;
    return Math.max(15_000, (ttl - 15) * 1000);
}

export const WALLET_QR_REFRESH_MS = walletQrRefreshMs(WALLET_QR_DEFAULT_TTL_SECONDS);

export function isWalletQrToken(code: string): boolean {
    return code.trim().startsWith(`${WALLET_QR_PREFIX}.`);
}
