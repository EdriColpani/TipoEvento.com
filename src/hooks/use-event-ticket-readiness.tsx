import { useQuery } from '@tanstack/react-query';
import { callRpcRest } from '@/utils/supabase-rest-rpc';

export interface EventTicketReadiness {
    event_id: string;
    active_ticket_count: number;
    min_required: number;
    needs_more: boolean;
}

async function fetchEventTicketReadiness(companyId: string): Promise<EventTicketReadiness[]> {
    const data = await callRpcRest<unknown>(
        'get_manager_events_ticket_readiness',
        { p_company_id: companyId },
        12_000,
    );
    return Array.isArray(data) ? (data as EventTicketReadiness[]) : [];
}

export function useEventTicketReadiness(companyId: string | undefined, enabled = true) {
    return useQuery({
        queryKey: ['eventTicketReadiness', companyId],
        queryFn: () => fetchEventTicketReadiness(companyId!),
        enabled: Boolean(companyId) && enabled,
        staleTime: 60_000,
    });
}
