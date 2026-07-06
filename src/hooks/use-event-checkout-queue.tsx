import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { getAuthAccessToken, readCachedAuthSession } from '@/utils/auth-session-cache';
import { parseEdgeFunctionError } from '@/utils/edge-function-error';

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

function rpcPayloadError(payload: unknown): string | null {
    if (!payload || typeof payload !== 'object') return null;
    const record = payload as Record<string, unknown>;
    if (record.ok === false && typeof record.error === 'string') {
        return record.error;
    }
    return null;
}

async function invokeCheckoutQueueFunction(
    eventId: string,
    action: 'join' | 'poll',
    sessionToken?: string,
): Promise<Record<string, unknown>> {
    const token = getAuthAccessToken();
    if (!token) throw new Error('Faça login para entrar na fila.');

    const response = await supabase.functions.invoke('event-checkout-queue', {
        body: {
            eventId,
            action,
            sessionToken,
        },
        headers: { Authorization: `Bearer ${token}` },
    });

    if (response.error) {
        throw new Error(await parseEdgeFunctionError(response.error, response.data));
    }

    const payloadError = rpcPayloadError(response.data);
    if (payloadError) throw new Error(payloadError);

    return (response.data ?? {}) as Record<string, unknown>;
}

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

        if (statusRaw === 'admitted') {
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

        if (statusRaw === 'waiting') {
            setState({
                status: 'waiting',
                sessionToken,
                position: Number(payload.position ?? 0),
                waitEstimateSeconds: Number(payload.wait_estimate_seconds ?? 30),
                queueEnabled: true,
                error: null,
            });
            return;
        }

        setState({
            status: 'error',
            sessionToken: null,
            position: 0,
            waitEstimateSeconds: 0,
            queueEnabled: queueEnabled || true,
            error: typeof payload.error === 'string' ? payload.error : 'Status da fila inválido.',
        });
    }, [storageKey]);

    const joinQueue = useCallback(async () => {
        if (!eventId || !enabled) {
            setState((prev) => ({ ...prev, status: 'admitted', queueEnabled: false }));
            return;
        }

        setState((prev) => ({ ...prev, status: 'joining', error: null }));

        try {
            const { userId } = readCachedAuthSession();
            if (!userId) throw new Error('Faça login para entrar na fila.');

            let payload: Record<string, unknown> | null = null;
            let lastError: Error | null = null;

            const { data, error } = await supabase.rpc('join_event_checkout_queue', {
                p_event_id: eventId,
                p_client_user_id: userId,
            });

            if (error) {
                lastError = new Error(error.message);
            } else {
                const payloadError = rpcPayloadError(data);
                if (payloadError) {
                    lastError = new Error(payloadError);
                } else {
                    payload = data as Record<string, unknown>;
                }
            }

            if (!payload) {
                try {
                    payload = await invokeCheckoutQueueFunction(eventId, 'join');
                } catch (edgeErr) {
                    throw lastError ?? edgeErr;
                }
            }

            applyPayload(payload);
        } catch (err) {
            let message = err instanceof Error ? err.message : 'Erro ao entrar na fila.';
            if (message.includes('non-2xx')) {
                message =
                    'Fila virtual indisponível. Verifique se a migration da fila foi aplicada no Supabase (db push).';
            }
            if (message.includes('Could not find the function')) {
                message =
                    'Função da fila não encontrada no banco. Execute supabase db push no projeto Supabase.';
            }

            setState({
                status: 'error',
                sessionToken: null,
                position: 0,
                waitEstimateSeconds: 0,
                queueEnabled: true,
                error: message,
            });
        }
    }, [applyPayload, enabled, eventId]);

    const pollQueue = useCallback(async () => {
        if (!eventId || !state.sessionToken || state.status !== 'waiting') return;

        try {
            let payload: Record<string, unknown> | null = null;

            const { data, error } = await supabase.rpc('poll_event_checkout_queue', {
                p_session_token: state.sessionToken,
            });

            if (error) {
                payload = await invokeCheckoutQueueFunction(eventId, 'poll', state.sessionToken);
            } else {
                const payloadError = rpcPayloadError(data);
                if (payloadError) throw new Error(payloadError);
                payload = data as Record<string, unknown>;
            }

            applyPayload(payload);
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
