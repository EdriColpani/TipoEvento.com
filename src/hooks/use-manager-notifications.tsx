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

export async function fetchManagerNotifications(userId: string): Promise<ManagerNotificationItem[]> {
    const { data: events, error } = await supabase
        .from('events')
        .select('id, title, capacity, is_active')
        .eq('created_by', userId)
        .neq('is_active', false);

    if (error) throw error;
    if (!events?.length) return [];

    const eligibleEvents = events.filter(
        (event) => typeof event.capacity === 'number' && event.capacity > 0,
    );
    if (!eligibleEvents.length) return [];

    const eventIds = eligibleEvents.map((event) => event.id);
    const { data: soldTickets, error: ticketsError } = await supabase
        .from('wristband_analytics')
        .select('event_id')
        .in('event_id', eventIds)
        .eq('event_type', 'purchase')
        .not('client_user_id', 'is', null);

    if (ticketsError) throw ticketsError;

    const ticketsSoldByEvent = new Map<string, number>();
    soldTickets?.forEach((ticket) => {
        const count = ticketsSoldByEvent.get(ticket.event_id) || 0;
        ticketsSoldByEvent.set(ticket.event_id, count + 1);
    });

    const notifications: ManagerNotificationItem[] = [];

    for (const event of eligibleEvents) {
        const capacity = Number(event.capacity);
        const ticketsSold = ticketsSoldByEvent.get(event.id) || 0;
        const available = capacity - ticketsSold;
        const percentage = (available / capacity) * 100;

        if (percentage >= 10 || percentage <= 0) continue;

        const eventTitle = event.title?.trim() || 'Evento';
        notifications.push({
            id: `low_stock:${event.id}`,
            type: 'low_stock',
            title: 'Alerta de estoque baixo',
            message: `O evento "${eventTitle}" está com menos de 10% dos ingressos disponíveis (${Math.max(available, 0)} restantes).`,
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
