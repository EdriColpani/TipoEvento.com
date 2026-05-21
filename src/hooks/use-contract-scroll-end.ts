import { useCallback, useEffect, useRef, useState } from 'react';

const SCROLL_END_THRESHOLD_PX = 12;

/**
 * Detecta se o usuário rolou até o final do container de contrato.
 * Contratos curtos (sem scroll) liberam o aceite imediatamente.
 */
export function useContractScrollEnd(contentKey?: string | null) {
    const scrollRef = useRef<HTMLDivElement>(null);
    const [hasScrolledToEnd, setHasScrolledToEnd] = useState(false);

    const evaluateScrollEnd = useCallback(() => {
        const el = scrollRef.current;
        if (!el) return;

        const { scrollTop, scrollHeight, clientHeight } = el;
        if (scrollHeight <= clientHeight + 2) {
            setHasScrolledToEnd(true);
            return;
        }

        const atEnd = scrollHeight - scrollTop <= clientHeight + SCROLL_END_THRESHOLD_PX;
        setHasScrolledToEnd(atEnd);
    }, []);

    useEffect(() => {
        setHasScrolledToEnd(false);
    }, [contentKey]);

    useEffect(() => {
        const el = scrollRef.current;
        if (!el) return;

        const raf = requestAnimationFrame(evaluateScrollEnd);
        const resizeObserver = new ResizeObserver(() => evaluateScrollEnd());
        resizeObserver.observe(el);

        return () => {
            cancelAnimationFrame(raf);
            resizeObserver.disconnect();
        };
    }, [contentKey, evaluateScrollEnd]);

    return {
        scrollRef,
        hasScrolledToEnd,
        onScroll: evaluateScrollEnd,
    };
}
