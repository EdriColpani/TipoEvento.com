import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export type CheckoutObservabilityAlert = {
    level: 'critical' | 'warning' | 'info';
    code: string;
    message: string;
};

export type CheckoutObservabilityData = {
    ok: boolean;
    generated_at: string;
    window_minutes: number;
    event: {
        id: string;
        title: string;
        inventory_mode: string;
        checkout_queue_enabled: boolean;
        checkout_async_webhook: boolean;
    } | null;
    metrics: {
        reservations_window: number;
        reservations_per_minute: number;
        payments_window: number;
        payments_per_minute: number;
        pending_receivables: number;
        pending_checkout_tickets: number;
        queue_waiting: number;
        queue_admitted: number;
        webhook_jobs_pending: number;
        webhook_jobs_failed: number;
        rate_limited_window: number;
        reserve_errors_window: number;
        reserve_conflicts_window: number;
        availability_cache_age_seconds: number | null;
    };
    inventory: {
        total_capacity: number;
        sold: number;
        reserved: number;
        available: number;
        integrity: {
            ok: boolean;
            inventory_mode?: string;
            violations?: unknown[];
        };
    } | null;
    alerts: CheckoutObservabilityAlert[];
    recent_events: Array<{
        operation: string;
        status: string;
        correlation_id: string | null;
        duration_ms: number | null;
        details: Record<string, unknown>;
        created_at: string;
    }>;
};

export type HighTrafficEventOption = {
    id: string;
    title: string;
    date: string | null;
    inventory_mode: string;
    checkout_queue_enabled: boolean;
};

async function fetchHighTrafficEvents(): Promise<HighTrafficEventOption[]> {
    const { data, error } = await supabase
        .from('events')
        .select('id, title, date, inventory_mode, checkout_queue_enabled')
        .or('inventory_mode.eq.counter,checkout_queue_enabled.eq.true,checkout_async_webhook.eq.true')
        .order('date', { ascending: false })
        .limit(100);

    if (error) throw error;

    return (data ?? []).map((row) => ({
        id: row.id,
        title: row.title,
        date: row.date,
        inventory_mode: row.inventory_mode ?? 'unit_rows',
        checkout_queue_enabled: row.checkout_queue_enabled ?? false,
    }));
}

async function fetchCheckoutObservability(
    eventId: string | null,
    windowMinutes: number,
): Promise<CheckoutObservabilityData> {
    const { data, error } = await supabase.rpc('get_checkout_observability', {
        p_event_id: eventId,
        p_window_minutes: windowMinutes,
    });

    if (error) throw error;
    return data as CheckoutObservabilityData;
}

export function useHighTrafficEvents(enabled: boolean) {
    return useQuery({
        queryKey: ['high_traffic_events'],
        enabled,
        staleTime: 60_000,
        queryFn: fetchHighTrafficEvents,
    });
}

export function useCheckoutObservability(
    eventId: string | null,
    windowMinutes: number,
    enabled: boolean,
) {
    return useQuery({
        queryKey: ['checkout_observability', eventId, windowMinutes],
        enabled,
        refetchInterval: 15_000,
        staleTime: 10_000,
        queryFn: () => fetchCheckoutObservability(eventId, windowMinutes),
    });
}
