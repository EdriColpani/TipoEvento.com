import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Box } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export type ManagerNotificationItem = {
    id: string;
    type: 'low_stock' | 'contact_message';
    title: string;
    message: string;
    link: string;
    icon: LucideIcon;
    color: string;
    bgColor: string;
    borderColor: string;
};

function chunks<T>(arr: T[], size: number): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
}

type ManagerEventRow = {
    id: string;
    title: string | null;
    capacity: number | null;
    is_active: boolean | null;
    inventory_mode?: string | null;
};

async function loadLegacySoldByEvent(eventIds: string[]): Promise<Map<string, number>> {
    const soldByEvent = new Map<string, number>();
    eventIds.forEach((id) => soldByEvent.set(id, 0));
    if (eventIds.length === 0) return soldByEvent;

    const { data: wristbands, error: wErr } = await supabase
        .from('wristbands')
        .select('id, event_id')
        .in('event_id', eventIds);
    if (wErr) throw wErr;

    const eventByWristband = new Map<string, string>(
        (wristbands ?? []).map((w) => [w.id, w.event_id]),
    );
    const wristbandIds = [...eventByWristband.keys()];

    for (const wbChunk of chunks(wristbandIds, 250)) {
        if (wbChunk.length === 0) continue;
        const { data: analytics, error: aErr } = await supabase
            .from('wristband_analytics')
            .select('wristband_id')
            .in('wristband_id', wbChunk)
            .not('client_user_id', 'is', null);
        if (aErr) throw aErr;
        for (const row of analytics ?? []) {
            const eventId = eventByWristband.get(row.wristband_id);
            if (!eventId) continue;
            soldByEvent.set(eventId, (soldByEvent.get(eventId) || 0) + 1);
        }
    }

    return soldByEvent;
}

async function loadCounterAvailabilityByEvent(
    eventIds: string[],
): Promise<Map<string, { total: number; available: number }>> {
    const byEvent = new Map<string, { total: number; available: number }>();
    eventIds.forEach((id) => byEvent.set(id, { total: 0, available: 0 }));
    if (eventIds.length === 0) return byEvent;

    const { data, error } = await supabase
        .from('batch_inventory')
        .select('event_id, total, sold, reserved')
        .in('event_id', eventIds);
    if (error) throw error;

    for (const row of data ?? []) {
        const eventId = String(row.event_id);
        const total = Number(row.total ?? 0);
        const sold = Number(row.sold ?? 0);
        const reserved = Number(row.reserved ?? 0);
        const remaining = Math.max(total - sold - reserved, 0);
        const prev = byEvent.get(eventId) ?? { total: 0, available: 0 };
        byEvent.set(eventId, {
            total: prev.total + total,
            available: prev.available + remaining,
        });
    }

    return byEvent;
}

export async function fetchManagerNotifications(userId: string): Promise<ManagerNotificationItem[]> {
    const selectAttempts = [
        'id, title, capacity, is_active, inventory_mode',
        'id, title, capacity, is_active',
    ];

    let events: ManagerEventRow[] = [];
    for (const sel of selectAttempts) {
        const { data, error } = await supabase
            .from('events')
            .select(sel)
            .eq('created_by', userId)
            .neq('is_active', false);
        if (error) continue;
        events = (data ?? []) as ManagerEventRow[];
        break;
    }

    if (!events.length) return [];

    const eligibleEvents = events.filter(
        (event) => typeof event.capacity === 'number' && event.capacity > 0,
    );
    if (!eligibleEvents.length) return [];

    const counterEventIds = eligibleEvents
        .filter((event) => event.inventory_mode === 'counter')
        .map((event) => event.id);
    const legacyEventIds = eligibleEvents
        .filter((event) => event.inventory_mode !== 'counter')
        .map((event) => event.id);

    const [counterAvailability, legacySoldByEvent] = await Promise.all([
        loadCounterAvailabilityByEvent(counterEventIds),
        loadLegacySoldByEvent(legacyEventIds),
    ]);

    const notifications: ManagerNotificationItem[] = [];

    for (const event of eligibleEvents) {
        const isCounter = event.inventory_mode === 'counter';
        let total = Number(event.capacity);
        let available: number;

        if (isCounter) {
            const stats = counterAvailability.get(event.id);
            if (stats && stats.total > 0) {
                total = stats.total;
                available = stats.available;
            } else {
                available = total;
            }
        } else {
            const sold = legacySoldByEvent.get(event.id) || 0;
            available = Math.max(total - sold, 0);
        }

        const percentage = total > 0 ? (available / total) * 100 : 0;

        if (percentage >= 10 || percentage <= 0) continue;

        const eventTitle = event.title?.trim() || 'Evento';
        notifications.push({
            id: `low_stock:${event.id}`,
            type: 'low_stock',
            title: 'Alerta de estoque baixo',
            message: `O evento "${eventTitle}" está com menos de 10% dos ingressos disponíveis (${available} restantes).`,
            link: `/manager/events/edit/${event.id}`,
            icon: Box,
            color: 'text-yellow-400',
            bgColor: 'bg-yellow-500/10',
            borderColor: 'border-yellow-500/30',
        });
    }

    return notifications;
}

export function useManagerNotifications(userId: string | undefined, enabled = true) {
    const query = useQuery({
        queryKey: ['managerNotifications', userId],
        queryFn: () => fetchManagerNotifications(userId!),
        enabled: Boolean(userId && enabled),
        staleTime: 60_000,
        refetchInterval: 120_000,
    });

    const notifications = query.data ?? [];

    return {
        notifications,
        hasPendingNotifications: notifications.length > 0,
        isLoading: query.isLoading,
        isError: query.isError,
    };
}
