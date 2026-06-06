/** URL pública do app (vitrine/cortesia). Preferir VITE_PUBLIC_APP_URL em produção. */
export function buildPublicAppUrl(path: string): string {
    const envBase = (import.meta.env.VITE_PUBLIC_APP_URL as string | undefined)?.trim();
    const base = (envBase || window.location.origin).replace(/\/$/, '');
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    return `${base}${normalizedPath}`;
}

export function buildComplimentaryBundleUrl(publicToken: string): string {
    return buildPublicAppUrl(`/cortesia/pacote?token=${encodeURIComponent(publicToken)}`);
}

export function buildComplimentarySeatUrl(redeemToken: string): string {
    return buildPublicAppUrl(`/cortesia/resgatar?token=${encodeURIComponent(redeemToken)}`);
}
