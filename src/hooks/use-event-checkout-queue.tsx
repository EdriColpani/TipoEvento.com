import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

export type CheckoutQueueStatus = 'idle' | 'joining' | 'waiting' | 'admitted' | 'error';

interface QueueState {
    status: CheckoutQueueStatus;
    sessionToken: string | null;
    position: number;
    waitEstimateSeconds: number;
    queueEnabled: boolean;
    error: string | null;
}

const STORAGE_KEY_PREFIX = 'eventfest_checkout_queue:';

export function useEventCheckoutQueue(eventId: string | undefined, enabled: boolean) {
    const [state, setState] = useState<QueueState>({
        status: 'idle',
        sessionToken: null,
        position: 0,
        waitEstimateSeconds: 0,
        queueEnabled: false,
        error: null,
    });
    const pollRef = useRef<number | null>(null);

    const storageKey = eventId ? `${STORAGE_KEY_PREFIX}${eventId}` : null;

    const applyPayload = useCallback((payload: Record<string, unknown>) => {
        const queueEnabled = payload.queue_enabled === true;
        const statusRaw = String(payload.status ?? 'admitted');
        const sessionToken = typeof payload.session_token === 'string' ? payload.session_token : null;

        if (storageKey && sessionToken) {
            sessionStorage.setItem(storageKey, sessionToken);
        }

        if (!queueEnabled || statusRaw === 'admitted') {
            setState({
                status: 'admitted',
                sessionToken,
                position: 0,
                waitEstimateSeconds: 0,
                queueEnabled,
                error: null,
            });
            return;
        }

        setState({
            status: 'waiting',
            sessionToken,
            position: Number(payload.position ?? 0),
            waitEstimateSeconds: Number(payload.wait_estimate_seconds ?? 30),
            queueEnabled: true,
            error: null,
        });
    }, [storageKey]);

    const joinQueue = useCallback(async () => {
        if (!eventId || !enabled) {
            setState((prev) => ({ ...prev, status: 'admitted', queueEnabled: false }));
            return;
        }

        setState((prev) => ({ ...prev, status: 'joining', error: null }));

        try {
            const { data: sess } = await supabase.auth.getSession();
            const token = sess.session?.access_token;
            if (!token) throw new Error('Faça login para entrar na fila.');

            const { data, error } = await supabase.functions.invoke('event-checkout-queue', {
                body: { eventId, action: 'join' },
                headers: { Authorization: `Bearer ${token}` },
            });

            if (error) throw error;
            if (data?.error) throw new Error(String(data.error));

            applyPayload(data as Record<string, unknown>);
        } catch (err) {
            setState({
                status: 'error',
                sessionToken: null,
                position: 0,
                waitEstimateSeconds: 0,
                queueEnabled: true,
                error: err instanceof Error ? err.message : 'Erro ao entrar na fila.',
            });
        }
    }, [applyPayload, enabled, eventId]);

    const pollQueue = useCallback(async () => {
        if (!eventId || !state.sessionToken || state.status !== 'waiting') return;

        try {
            const { data: sess } = await supabase.auth.getSession();
            const token = sess.session?.access_token;
            if (!token) return;

            const { data, error } = await supabase.functions.invoke('event-checkout-queue', {
                body: { eventId, action: 'poll', sessionToken: state.sessionToken },
                headers: { Authorization: `Bearer ${token}` },
            });

            if (error) throw error;
            if (data?.error) throw new Error(String(data.error));

            applyPayload(data as Record<string, unknown>);
        } catch (err) {
            setState((prev) => ({
                ...prev,
                status: 'error',
                queueEnabled: true,
                error: err instanceof Error ? err.message : 'Erro ao consultar fila.',
            }));
        }
    }, [applyPayload, eventId, state.sessionToken, state.status]);

    useEffect(() => {
        if (!enabled || !eventId) return;

        const saved = storageKey ? sessionStorage.getItem(storageKey) : null;
        if (saved) {
            setState((prev) => ({ ...prev, sessionToken: saved }));
        }

        void joinQueue();
    }, [enabled, eventId, joinQueue, storageKey]);

    useEffect(() => {
        if (state.status !== 'waiting') {
            if (pollRef.current) {
                window.clearInterval(pollRef.current);
                pollRef.current = null;
            }
            return;
        }

        pollRef.current = window.setInterval(() => {
            void pollQueue();
        }, 3000);

        return () => {
            if (pollRef.current) {
                window.clearInterval(pollRef.current);
                pollRef.current = null;
            }
        };
    }, [pollQueue, state.status]);

    const canCheckout = state.status === 'admitted' && Boolean(state.sessionToken);

    return {
        ...state,
        canCheckout,
        joinQueue,
        pollQueue,
    };
}
