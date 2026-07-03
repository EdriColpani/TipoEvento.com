/** Evita promises que nunca resolvem (ex.: deadlock de auth ou query lenta). */
export function withTimeout<T>(
    promise: Promise<T>,
    ms: number,
    fallback: T,
): Promise<T> {
    return Promise.race([
        promise,
        new Promise<T>((resolve) => {
            window.setTimeout(() => resolve(fallback), ms);
        }),
    ]);
}
