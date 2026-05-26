import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export type CreditWalletStatus = {
    module_enabled: boolean;
    can_topup: boolean;
    can_use: boolean;
    consumption_commission_pct: number;
    biometric_threshold?: number;
    biometric_enabled?: boolean;
    mobile_wallet_ready?: boolean;
    message: string | null;
};

export type CreditAcceptanceEvent = {
    event_id: string;
    title: string;
    event_date: string;
    event_time: string | null;
    location: string | null;
    company_id: string;
    company_name: string;
};

export type CreditAcceptanceEstablishment = {
    establishment_id: string;
    name: string;
    event_id: string | null;
    company_id: string;
    company_name: string;
    event_title: string | null;
};

export type CreditAcceptanceNetwork = {
    module_enabled: boolean;
    events: CreditAcceptanceEvent[];
    establishments: CreditAcceptanceEstablishment[];
    message: string | null;
};

async function fetchWalletStatus(): Promise<CreditWalletStatus> {
    const { data, error } = await supabase.rpc('get_credit_wallet_status');
    if (error) throw error;
    return data as CreditWalletStatus;
}

async function fetchAcceptanceNetwork(): Promise<CreditAcceptanceNetwork> {
    const { data, error } = await supabase.rpc('list_credit_acceptance_network');
    if (error) throw error;
    const raw = data as CreditAcceptanceNetwork;
    return {
        module_enabled: Boolean(raw?.module_enabled),
        events: Array.isArray(raw?.events) ? raw.events : [],
        establishments: Array.isArray(raw?.establishments) ? raw.establishments : [],
        message: raw?.message ?? null,
    };
}

export function useCreditWalletStatus() {
    return useQuery({
        queryKey: ['credit-wallet-status'],
        queryFn: fetchWalletStatus,
        staleTime: 60_000,
    });
}

export function useCreditAcceptanceNetwork(enabled = true) {
    return useQuery({
        queryKey: ['credit-acceptance-network'],
        queryFn: fetchAcceptanceNetwork,
        enabled,
        staleTime: 120_000,
    });
}

type TopupPollOptions = {
    orderId: string | null;
    active: boolean;
    onSettled: () => void;
};

/** Poll até pedido paid ou timeout (webhook MP). */
export function useCreditTopupPolling({ orderId, active, onSettled }: TopupPollOptions) {
    const [isPolling, setIsPolling] = useState(false);
    const attemptsRef = useRef(0);
    const onSettledRef = useRef(onSettled);
    onSettledRef.current = onSettled;

    useEffect(() => {
        if (!active || !orderId) {
            setIsPolling(false);
            return;
        }

        setIsPolling(true);
        attemptsRef.current = 0;
        const maxAttempts = 20;
        const intervalMs = 3000;

        const tick = async () => {
            attemptsRef.current += 1;
            const { data, error } = await supabase.rpc('get_credit_topup_order_status', {
                p_order_id: orderId,
            });
            if (!error && data && (data as { status?: string }).status === 'paid') {
                setIsPolling(false);
                onSettledRef.current();
                return true;
            }
            if (attemptsRef.current >= maxAttempts) {
                setIsPolling(false);
                onSettledRef.current();
                return true;
            }
            return false;
        };

        let timer: ReturnType<typeof setInterval> | null = null;

        void tick().then((done) => {
            if (done) return;
            timer = setInterval(async () => {
                const finished = await tick();
                if (finished && timer) clearInterval(timer);
            }, intervalMs);
        });

        return () => {
            if (timer) clearInterval(timer);
            setIsPolling(false);
        };
    }, [active, orderId]);

    return { isPolling };
}
