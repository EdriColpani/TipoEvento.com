export type MobilePlatform = 'ios' | 'android' | 'other';

/** Detecta plataforma móvel pelo userAgent (browser). */
export function detectMobilePlatform(): MobilePlatform {
    if (typeof navigator === 'undefined') return 'other';

    const ua = navigator.userAgent || '';
    const isIOS =
        /iPad|iPhone|iPod/i.test(ua) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (isIOS) return 'ios';

    if (/Android/i.test(ua)) return 'android';

    return 'other';
}
