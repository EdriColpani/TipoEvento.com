import { useQuery } from '@tanstack/react-query';
import { invokeEdgeFunctionRest } from '@/utils/edge-function-rest';
import { callRpcRest } from '@/utils/supabase-rest-rpc';
import { getAuthAccessToken } from '@/utils/auth-session-cache';

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
    const row = await callRpcRest<Record<string, unknown>>(
        'get_company_ticket_inactivity_status',
        { p_company_id: companyId },
        12_000,
    );

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
    return callRpcRest<Record<string, unknown>>(
        'admin_run_ticket_inactivity_check',
        { p_reference_month: referenceMonth ?? null },
        20_000,
    );
}

export async function adminRunTicketInactivityMonthlyJob(referenceMonth?: string): Promise<{
    check?: Record<string, unknown>;
    emails_sent?: number;
    emails_failed?: number;
}> {
    if (!getAuthAccessToken()) throw new Error('Sessão expirada.');

    const check = await adminRunTicketInactivityCheck(referenceMonth);

    const payload = await invokeEdgeFunctionRest<{
        error?: string;
        check?: Record<string, unknown>;
        emails_sent?: number;
        emails_failed?: number;
    }>(
        'run-ticket-inactivity-monthly-job',
        { skipCheck: true },
        { timeoutMs: 60_000 },
    );

    if (payload.error) throw new Error(payload.error);

    return {
        check,
        emails_sent: payload.emails_sent,
        emails_failed: payload.emails_failed,
    };
}

export async function adminClearCompanyTicketInactivity(companyId: string): Promise<void> {
    await callRpcRest('admin_clear_company_ticket_inactivity', { p_company_id: companyId }, 12_000);
}

export async function adminRunTicketInactivityAutoDeactivate(): Promise<{
    skipped?: boolean;
    reason?: string;
    events_deactivated?: number;
    notifications_queued?: number;
    days_after?: number;
}> {
    return callRpcRest<Record<string, unknown>>('admin_run_ticket_inactivity_auto_deactivate', {}, 20_000);
}

export async function adminRunTicketInactivityAutoDeactivateJob(): Promise<{
    deactivate?: Record<string, unknown>;
    emails_sent?: number;
    emails_failed?: number;
}> {
    if (!getAuthAccessToken()) throw new Error('Sessão expirada.');

    const payload = await invokeEdgeFunctionRest<{
        error?: string;
        deactivate?: Record<string, unknown>;
        emails_sent?: number;
        emails_failed?: number;
    }>('run-ticket-inactivity-auto-deactivate-job', {}, { timeoutMs: 60_000 });

    if (payload.error) throw new Error(payload.error);

    return payload;
}

export async function verifyAntiFraudDeploy(): Promise<Record<string, unknown>> {
    return callRpcRest<Record<string, unknown>>('verify_anti_fraud_deploy', {}, 15_000);
}
