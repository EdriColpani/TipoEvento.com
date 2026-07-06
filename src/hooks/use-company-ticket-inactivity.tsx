import { useQuery } from '@tanstack/react-query';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { getAuthAccessToken } from '@/utils/auth-session-cache';

async function readFunctionErrorMessage(
    error: unknown,
    payload: { error?: string } | null,
): Promise<string> {
    if (payload?.error) return payload.error;
    if (error instanceof FunctionsHttpError) {
        try {
            const json = (await error.context.json()) as { error?: string };
            if (json?.error) return json.error;
        } catch {
            /* ignore */
        }
    }
    if (error instanceof Error) return error.message;
    return 'Erro no job mensal.';
}

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
    const token = getAuthAccessToken();
    if (!token) throw new Error('Sessão expirada.');

    const check = await adminRunTicketInactivityCheck(referenceMonth);

    const { data, error } = await supabase.functions.invoke('run-ticket-inactivity-monthly-job', {
        body: { skipCheck: true },
        headers: { Authorization: `Bearer ${token}` },
    });

    const payload = (data ?? {}) as {
        error?: string;
        check?: Record<string, unknown>;
        emails_sent?: number;
        emails_failed?: number;
    };

    if (error) {
        throw new Error(await readFunctionErrorMessage(error, payload));
    }
    if (payload.error) throw new Error(payload.error);

    return {
        check,
        emails_sent: payload.emails_sent,
        emails_failed: payload.emails_failed,
    };
}

export async function adminClearCompanyTicketInactivity(companyId: string): Promise<void> {
    const { error } = await supabase.rpc('admin_clear_company_ticket_inactivity', {
        p_company_id: companyId,
    });
    if (error) throw new Error(error.message);
}

export async function adminRunTicketInactivityAutoDeactivate(): Promise<{
    skipped?: boolean;
    reason?: string;
    events_deactivated?: number;
    notifications_queued?: number;
    days_after?: number;
}> {
    const { data, error } = await supabase.rpc('admin_run_ticket_inactivity_auto_deactivate');
    if (error) throw new Error(error.message);
    return (data ?? {}) as Record<string, unknown>;
}

export async function adminRunTicketInactivityAutoDeactivateJob(): Promise<{
    deactivate?: Record<string, unknown>;
    emails_sent?: number;
    emails_failed?: number;
}> {
    const token = getAuthAccessToken();
    if (!token) throw new Error('Sessão expirada.');

    const { data, error } = await supabase.functions.invoke('run-ticket-inactivity-auto-deactivate-job', {
        body: {},
        headers: { Authorization: `Bearer ${token}` },
    });

    const payload = (data ?? {}) as {
        error?: string;
        deactivate?: Record<string, unknown>;
        emails_sent?: number;
        emails_failed?: number;
    };

    if (error) {
        throw new Error(await readFunctionErrorMessage(error, payload));
    }
    if (payload.error) throw new Error(payload.error);

    return payload;
}

export async function verifyAntiFraudDeploy(): Promise<Record<string, unknown>> {
    const { data, error } = await supabase.rpc('verify_anti_fraud_deploy');
    if (error) throw new Error(error.message);
    return (data ?? {}) as Record<string, unknown>;
}
