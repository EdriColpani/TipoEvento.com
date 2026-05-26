const STORAGE_PREFIX = 'ef_wallet_bio_v1';

function bufferToBase64Url(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    bytes.forEach((b) => {
        binary += String.fromCharCode(b);
    });
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBuffer(value: string): ArrayBuffer {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/');
    const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
    const binary = atob(padded + pad);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
}

function storageKey(userId: string): string {
    return `${STORAGE_PREFIX}:${userId}`;
}

export type WalletBiometricState = {
    credentialId: string;
    createdAt: string;
};

export function isWalletBiometricSupported(): boolean {
    return typeof window !== 'undefined'
        && window.isSecureContext
        && typeof PublicKeyCredential !== 'undefined'
        && typeof navigator.credentials?.create === 'function';
}

export function isWalletBiometricRegistered(userId: string): boolean {
    if (!userId) return false;
    try {
        return !!localStorage.getItem(storageKey(userId));
    } catch {
        return false;
    }
}

export function clearWalletBiometric(userId: string): void {
    localStorage.removeItem(storageKey(userId));
}

export async function registerWalletBiometric(userId: string, userLabel: string): Promise<void> {
    if (!isWalletBiometricSupported()) {
        throw new Error('Biometria não disponível neste dispositivo ou navegador.');
    }

    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const userIdBytes = new TextEncoder().encode(userId);

    const credential = (await navigator.credentials.create({
        publicKey: {
            challenge,
            rp: {
                name: 'EventFest',
                id: window.location.hostname,
            },
            user: {
                id: userIdBytes,
                name: userLabel || userId,
                displayName: userLabel || 'Cliente EventFest',
            },
            pubKeyCredParams: [{ alg: -7, type: 'public-key' }],
            authenticatorSelection: {
                authenticatorAttachment: 'platform',
                userVerification: 'required',
                residentKey: 'preferred',
            },
            timeout: 60_000,
        },
    })) as PublicKeyCredential | null;

    if (!credential?.rawId) {
        throw new Error('Não foi possível registrar a biometria.');
    }

    const payload: WalletBiometricState = {
        credentialId: bufferToBase64Url(credential.rawId),
        createdAt: new Date().toISOString(),
    };
    localStorage.setItem(storageKey(userId), JSON.stringify(payload));
}

export async function verifyWalletBiometric(userId: string): Promise<void> {
    if (!isWalletBiometricSupported()) {
        throw new Error('Biometria não disponível neste dispositivo.');
    }

    const raw = localStorage.getItem(storageKey(userId));
    if (!raw) {
        throw new Error('Ative a biometria na Carteira EventFest antes de pagamentos altos.');
    }

    const state = JSON.parse(raw) as WalletBiometricState;
    const challenge = crypto.getRandomValues(new Uint8Array(32));

    const assertion = (await navigator.credentials.get({
        publicKey: {
            challenge,
            rpId: window.location.hostname,
            allowCredentials: [
                {
                    id: base64UrlToBuffer(state.credentialId),
                    type: 'public-key',
                },
            ],
            userVerification: 'required',
            timeout: 60_000,
        },
    })) as PublicKeyCredential | null;

    if (!assertion) {
        throw new Error('Confirmação biométrica cancelada.');
    }
}

export function requiresBiometricForAmount(amount: number, threshold: number): boolean {
    if (!Number.isFinite(amount) || amount <= 0) return false;
    if (!Number.isFinite(threshold) || threshold <= 0) return false;
    return amount >= threshold;
}

export async function ensureWalletBiometricForSpend(
    userId: string,
    amount: number,
    threshold: number,
): Promise<void> {
    if (!requiresBiometricForAmount(amount, threshold)) return;
    if (!isWalletBiometricRegistered(userId)) {
        throw new Error(
            `Pagamentos a partir de R$ ${threshold.toFixed(2).replace('.', ',')} exigem biometria. Ative em Carteira EventFest.`,
        );
    }
    await verifyWalletBiometric(userId);
}

export function isStandalonePwa(): boolean {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(display-mode: standalone)').matches
        || (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export function detectCreditSpendChannel(isMobile: boolean): 'web' | 'app' {
    return isMobile || isStandalonePwa() ? 'app' : 'web';
}
