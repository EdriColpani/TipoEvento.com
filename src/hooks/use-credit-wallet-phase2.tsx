import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { callRpcRest } from '@/utils/supabase-rest-rpc';

export type CreditWalletStatus = {
    module_enabled: boolean;
    wallet_visible?: boolean;
    can_topup: boolean;
    can_use: boolean;
    consumption_commission_pct: number;
    biometric_threshold?: number;
    biometric_enabled?: boolean;
    mobile_wallet_ready?: boolean;
    message: string | null;
};

function normalizeWalletStatus(raw: unknown): CreditWalletStatus {
    const row = (raw ?? {}) as Record<string, unknown>;
    const moduleEnabled = row.module_enabled === true;
    return {
        module_enabled: moduleEnabled,
        wallet_visible: row.wallet_visible !== false,
        can_topup: row.can_topup === true,
        can_use: row.can_use === true || moduleEnabled,
        consumption_commission_pct: Number(row.consumption_commission_pct ?? 0),
        biometric_threshold: row.biometric_threshold != null ? Number(row.biometric_threshold) : undefined,
        biometric_enabled: row.biometric_enabled === true,
        mobile_wallet_ready: row.mobile_wallet_ready !== false,
        message: typeof row.message === 'string' ? row.message : null,
    };
}

export type CreditAcceptanceEvent = {
    event_id: string;
    title: string;
    event_date: string;
    event_time: string | null;
    location: string | null;
    address?: string | null;
    address_lat?: number | null;
    address_lng?: number | null;
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
    location?: string | null;
    address?: string | null;
    address_lat?: number | null;
    address_lng?: number | null;
};

export type CreditAcceptanceNetwork = {
    module_enabled: boolean;
    events: CreditAcceptanceEvent[];
    establishments: CreditAcceptanceEstablishment[];
    message: string | null;
};

async function fetchWalletStatus(): Promise<CreditWalletStatus> {
    const data = await callRpcRest<unknown>('get_credit_wallet_status', {}, 12_000);
    return normalizeWalletStatus(data);
}

async function fetchAcceptanceNetwork(): Promise<CreditAcceptanceNetwork> {
    const raw = await callRpcRest<CreditAcceptanceNetwork>('list_credit_acceptance_network', {}, 15_000);
    const events = Array.isArray(raw?.events) ? raw.events : [];
    const establishments = (Array.isArray(raw?.establishments) ? raw.establishments : []).map((est) => ({
        ...est,
        address: typeof est.address === 'string' && est.address.trim() ? est.address.trim() : null,
        location: typeof est.location === 'string' && est.location.trim() ? est.location.trim() : null,
        address_lat: est.address_lat != null ? Number(est.address_lat) : null,
        address_lng: est.address_lng != null ? Number(est.address_lng) : null,
    }));
    return {
        module_enabled: Boolean(raw?.module_enabled),
        events: events.map((ev) => ({
            ...ev,
            address: typeof ev.address === 'string' && ev.address.trim() ? ev.address.trim() : null,
            location: typeof ev.location === 'string' && ev.location.trim() ? ev.location.trim() : null,
            address_lat: ev.address_lat != null ? Number(ev.address_lat) : null,
            address_lng: ev.address_lng != null ? Number(ev.address_lng) : null,
        })),
        establishments,
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
        staleTime: 30_000,
        refetchOnMount: 'always',
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
            try {
                const data = await callRpcRest<{ status?: string }>(
                    'get_credit_topup_order_status',
                    { p_order_id: orderId },
                    8_000,
                );
                if (data?.status === 'paid') {
                    setIsPolling(false);
                    onSettledRef.current();
                    return true;
                }
            } catch {
                /* timeout/rede: tenta de novo no próximo tick */
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
