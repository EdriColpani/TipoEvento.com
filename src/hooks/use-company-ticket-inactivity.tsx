import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface TicketInactivityPendingEvent {
    event_id: string;
    event_title: string;
    event_date: string;
    is_active: boolean;
    reference_month: string;
}

export interface CompanyTicketInactivityStatus {
    blocked: boolean;
    reference_month: string | null;
    pending_events: TicketInactivityPendingEvent[];
}

async function fetchTicketInactivityStatus(
    companyId: string,
): Promise<CompanyTicketInactivityStatus> {
    const { data, error } = await supabase.rpc('get_company_ticket_inactivity_status', {
        p_company_id: companyId,
    });

    if (error) throw new Error(error.message);

    const row = (data ?? {}) as Record<string, unknown>;
    const pending = Array.isArray(row.pending_events) ? row.pending_events : [];

    return {
        blocked: row.blocked === true,
        reference_month: (row.reference_month as string | null) ?? null,
        pending_events: pending as TicketInactivityPendingEvent[],
    };
}

export function useCompanyTicketInactivity(companyId: string | undefined, enabled = true) {
    return useQuery({
        queryKey: ['companyTicketInactivity', companyId],
        queryFn: () => fetchTicketInactivityStatus(companyId!),
        enabled: Boolean(companyId) && enabled,
        staleTime: 1000 * 60,
    });
}

export async function adminRunTicketInactivityCheck(referenceMonth?: string): Promise<{
    reference_month?: string;
    events_flagged?: number;
    companies_blocked?: number;
    charges_created?: number;
    notifications_queued?: number;
}> {
    const { data, error } = await supabase.rpc('admin_run_ticket_inactivity_check', {
        p_reference_month: referenceMonth ?? null,
    });
    if (error) throw new Error(error.message);
    return (data ?? {}) as Record<string, unknown>;
}

export async function adminRunTicketInactivityMonthlyJob(referenceMonth?: string): Promise<{
    check?: Record<string, unknown>;
    emails_sent?: number;
    emails_failed?: number;
}> {
    const { data: sess } = await supabase.auth.getSession();
    const token = sess.session?.access_token;
    if (!token) throw new Error('Sessão expirada.');

    const { data, error } = await supabase.functions.invoke('run-ticket-inactivity-monthly-job', {
        body: { referenceMonth: referenceMonth ?? null },
        headers: { Authorization: `Bearer ${token}` },
    });

    const payload = (data ?? {}) as {
        error?: string;
        check?: Record<string, unknown>;
        emails_sent?: number;
        emails_failed?: number;
    };

    if (error) {
        throw new Error(payload.error || (error instanceof Error ? error.message : 'Erro no job mensal.'));
    }
    if (payload.error) throw new Error(payload.error);
    return payload;
}

export async function adminClearCompanyTicketInactivity(companyId: string): Promise<void> {
    const { error } = await supabase.rpc('admin_clear_company_ticket_inactivity', {
        p_company_id: companyId,
    });
    if (error) throw new Error(error.message);
}
