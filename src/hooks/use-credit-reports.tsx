import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export type CreditLiabilityReconciliation = {
    module_enabled?: boolean;
    liability_cached?: number;
    liability_from_ledger?: number;
    total_wallet_balances?: number;
    topup_credit_granted?: number;
    topup_mp_fees?: number;
    topup_net_cash?: number;
    spend_gross_total?: number;
    platform_commission_total?: number;
    liability_matches_ledger?: boolean;
    liability_matches_wallets?: boolean;
    expected_liability_from_topups?: number;
};

export type AdminCreditMpIssue = {
    created_at: string;
    issue_type: string;
    severity: 'high' | 'medium' | 'low' | string;
    reference_type: string;
    reference_id: string;
    client_user_id: string | null;
    company_id: string | null;
    company_name: string | null;
    amount: number | null;
    status: string | null;
    details: string;
};

export type AdminCreditMpIssueSummary = {
    total_issues?: number;
    high_severity?: number;
    medium_severity?: number;
    topup_issues?: number;
    spend_issues?: number;
};

export type AdminCreditFinancialPosition = {
    period?: {
        start_date?: string | null;
        end_date?: string | null;
    };
    client_credit?: {
        liability_now?: number;
        wallet_balances?: number;
        expected_liability_from_period?: number;
    };
    platform_revenue?: {
        platform_commission?: number;
        spend_gross?: number;
        manager_net?: number;
    };
    mp_costs?: {
        topup_mp_fees?: number;
        topup_net_cash?: number;
        billing_mp_fees?: number;
        mp_disbursed_total?: number;
        mp_disbursed_failed?: number;
    };
    managerial_position?: {
        available_operational_cash?: number;
        estimated_mp_wallet_position?: number;
    };
    platform_billing?: AdminPlatformBillingRevenue;
};

export type AdminPlatformBillingRevenue = {
    period?: {
        start_date?: string | null;
        end_date?: string | null;
    };
    listing_monthly?: {
        paid_revenue?: number;
        paid_revenue_net?: number;
        mp_fees?: number;
        pending_amount?: number;
    };
    consumption_license?: {
        paid_revenue?: number;
        paid_revenue_net?: number;
        mp_fees?: number;
        pending_amount?: number;
    };
    ticket_inactivity?: {
        paid_revenue?: number;
        paid_revenue_net?: number;
        pending_amount?: number;
    };
    ticket_commission?: {
        revenue?: number;
    };
    consumption_commission?: {
        revenue?: number;
    };
    totals?: {
        platform_revenue?: number;
        platform_revenue_gross?: number;
        platform_revenue_net?: number;
        consolidated_revenue_net?: number;
        recurring_revenue?: number;
        recurring_revenue_gross?: number;
        recurring_revenue_net?: number;
        billing_mp_fees?: number;
        commission_revenue?: number;
    };
};

export type CreditCommissionRow = {
    company_id: string;
    company_name: string;
    spend_count: number;
    spend_gross: number;
    platform_commission: number;
    manager_net: number;
};

export type CreditCrossCompanyRow = {
    spend_order_id: string;
    client_user_id: string;
    spend_amount: number;
    spend_at: string;
    receiver_company_id: string;
    receiver_company_name: string;
    origin_company_id: string | null;
    origin_company_name: string | null;
    topup_order_id: string;
    topup_credit_amount: number;
    topup_paid_at: string;
};

export type CreditAuditRow = {
    id: string;
    event_type: string;
    subject_user_id: string | null;
    company_id: string | null;
    company_name: string | null;
    reference_type: string | null;
    reference_id: string | null;
    summary: string;
    payload: Record<string, unknown>;
    created_at: string;
};

export function useAdminCreditReconciliation() {
    return useQuery({
        queryKey: ['adminCreditReconciliation'],
        queryFn: async () => {
            const { data, error } = await supabase.rpc('get_admin_credit_liability_reconciliation');
            if (error) throw error;
            return data as CreditLiabilityReconciliation;
        },
        staleTime: 30_000,
    });
}

export function useAdminCreditFinancialPosition(startDate?: string | null, endDate?: string | null) {
    return useQuery({
        queryKey: ['adminCreditFinancialPosition', startDate, endDate],
        queryFn: async () => {
            const { data, error } = await supabase.rpc('get_admin_credit_financial_position', {
                p_start_date: startDate || null,
                p_end_date: endDate || null,
            });
            if (error) throw error;
            return data as AdminCreditFinancialPosition;
        },
        staleTime: 30_000,
    });
}

export function useAdminPlatformBillingRevenue(startDate?: string | null, endDate?: string | null) {
    return useQuery({
        queryKey: ['adminPlatformBillingRevenue', startDate, endDate],
        queryFn: async () => {
            const { data, error } = await supabase.rpc('get_admin_platform_billing_revenue', {
                p_start_date: startDate || null,
                p_end_date: endDate || null,
            });
            if (error) throw error;
            return data as AdminPlatformBillingRevenue;
        },
        staleTime: 30_000,
    });
}

export function useAdminCreditMpReconciliationIssues(startDate?: string | null, endDate?: string | null) {
    return useQuery({
        queryKey: ['adminCreditMpReconciliationIssues', startDate, endDate],
        queryFn: async () => {
            const { data, error } = await supabase.rpc('list_admin_credit_mp_reconciliation_issues', {
                p_start_date: startDate || null,
                p_end_date: endDate || null,
                p_limit: 400,
                p_offset: 0,
            });
            if (error) throw error;
            return data as { items: AdminCreditMpIssue[]; summary: AdminCreditMpIssueSummary };
        },
        staleTime: 20_000,
    });
}

export function useAdminCreditCommissionReport() {
    return useQuery({
        queryKey: ['adminCreditCommission'],
        queryFn: async () => {
            const { data, error } = await supabase.rpc('list_admin_credit_commission_report', {
                p_limit: 200,
                p_offset: 0,
            });
            if (error) throw error;
            return data as { items: CreditCommissionRow[]; summary: Record<string, number> };
        },
        staleTime: 30_000,
    });
}

export function useAdminCreditCrossCompanyFlows() {
    return useQuery({
        queryKey: ['adminCreditCrossCompany'],
        queryFn: async () => {
            const { data, error } = await supabase.rpc('list_admin_credit_cross_company_flows', {
                p_limit: 200,
                p_offset: 0,
            });
            if (error) throw error;
            return (data as { items: CreditCrossCompanyRow[] })?.items ?? [];
        },
        staleTime: 30_000,
    });
}

export function useAdminCreditAuditLog() {
    return useQuery({
        queryKey: ['adminCreditAudit'],
        queryFn: async () => {
            const { data, error } = await supabase.rpc('list_admin_credit_audit_log', {
                p_limit: 200,
                p_offset: 0,
            });
            if (error) throw error;
            return (data as { items: CreditAuditRow[] })?.items ?? [];
        },
        staleTime: 30_000,
    });
}

export function useManagerCreditSpends(companyId: string | undefined) {
    return useQuery({
        queryKey: ['managerCreditSpends', companyId],
        queryFn: async () => {
            const { data, error } = await supabase.rpc('list_manager_credit_spends', {
                p_company_id: companyId,
                p_limit: 200,
                p_offset: 0,
            });
            if (error) throw error;
            return (data as { items: ManagerCreditSpendRow[] })?.items ?? [];
        },
        enabled: !!companyId,
        staleTime: 30_000,
    });
}

export type ManagerCreditSpendRow = {
    spend_order_id: string;
    gross_amount: number;
    event_id: string | null;
    event_title: string | null;
    public_description: string | null;
    created_at: string;
    platform_amount: number;
    manager_amount: number;
    applied_percentage: number;
};

export type ManagerSettlementRow = {
    id: string;
    company_id: string;
    spend_order_id: string;
    manager_amount: number;
    platform_amount?: number;
    gross_amount?: number;
    status: string;
    release_at: string;
    released_at: string | null;
    paid_at: string | null;
    payout_batch_id: string | null;
    mp_payout_reference: string | null;
    mp_transfer_id?: string | null;
    mp_error?: string | null;
    spend_description: string | null;
    spend_at: string;
};

export type SettlementSummary = {
    pending: number;
    released: number;
    paid: number;
    clawback: number;
    failed?: number;
};

export function useManagerCreditSettlements(companyId: string | undefined, status?: string | null) {
    return useQuery({
        queryKey: ['managerCreditSettlements', companyId, status],
        queryFn: async () => {
            const { data, error } = await supabase.rpc('list_manager_credit_settlements', {
                p_company_id: companyId,
                p_status: status ?? null,
                p_limit: 200,
                p_offset: 0,
            });
            if (error) throw error;
            return data as {
                items: ManagerSettlementRow[];
                summary: SettlementSummary;
                retention_days: number;
            };
        },
        enabled: !!companyId,
        staleTime: 20_000,
    });
}

export function useAdminCreditSettlements() {
    return useQuery({
        queryKey: ['adminCreditSettlements'],
        queryFn: async () => {
            const { data, error } = await supabase.rpc('list_admin_credit_settlements', {
                p_limit: 200,
                p_offset: 0,
            });
            if (error) throw error;
            return (data as { items: Array<Record<string, unknown>> })?.items ?? [];
        },
        staleTime: 30_000,
    });
}

export type CreditRefundCaseRow = {
    id: string;
    client_user_id: string;
    refund_amount: number;
    status: string;
    reason: string;
    public_description: string | null;
    clawback_count: number;
    created_at: string;
    completed_at: string | null;
};

export type CreditAccountingRow = {
    transaction_at: string;
    row_kind: string;
    company_id: string;
    company_name: string | null;
    origin_company_id: string | null;
    origin_company_name: string | null;
    receiver_company_id: string | null;
    receiver_company_name: string | null;
    client_user_id: string;
    reference_type: string;
    reference_id: string;
    spend_order_id: string | null;
    gross_amount: number;
    platform_amount: number;
    manager_amount: number;
    mp_fee_amount: number | null;
    credit_granted_amount: number | null;
    net_cash_received: number | null;
    disbursement_status: string | null;
    mp_transfer_id: string | null;
    event_title: string | null;
    channel: string | null;
    public_description: string | null;
    is_cross_company: boolean;
};

export type CreditAccountingSummary = {
    topup_count?: number;
    topup_gross?: number;
    topup_mp_fees?: number;
    topup_credit_granted?: number;
    spend_count?: number;
    spend_gross?: number;
    platform_commission?: number;
    manager_net?: number;
    refund_count?: number;
    refund_total?: number;
    cross_spend_count?: number;
    total_rows?: number;
};

export type CreditAccountingFilters = {
    startDate?: string | null;
    endDate?: string | null;
    companyId?: string | null;
};

const ACCOUNTING_PAGE_SIZE = 500;
const ACCOUNTING_EXPORT_MAX = 5000;

async function fetchAllAccountingRows(
    rpcName: 'list_manager_credit_accounting_report' | 'list_admin_credit_accounting_report',
    params: Record<string, unknown>,
): Promise<CreditAccountingRow[]> {
    const all: CreditAccountingRow[] = [];
    let offset = 0;

    while (offset < ACCOUNTING_EXPORT_MAX) {
        const { data, error } = await supabase.rpc(rpcName, {
            ...params,
            p_limit: ACCOUNTING_PAGE_SIZE,
            p_offset: offset,
        });
        if (error) throw error;

        const items = ((data as { items?: CreditAccountingRow[] })?.items ?? []) as CreditAccountingRow[];
        all.push(...items);
        if (items.length < ACCOUNTING_PAGE_SIZE) break;
        offset += ACCOUNTING_PAGE_SIZE;
    }

    return all;
}

export function useManagerCreditAccountingReport(
    companyId: string | undefined,
    filters: CreditAccountingFilters,
) {
    return useQuery({
        queryKey: ['managerCreditAccounting', companyId, filters.startDate, filters.endDate],
        queryFn: async () => {
            const { data, error } = await supabase.rpc('list_manager_credit_accounting_report', {
                p_company_id: companyId,
                p_start_date: filters.startDate || null,
                p_end_date: filters.endDate || null,
                p_limit: 200,
                p_offset: 0,
            });
            if (error) throw error;
            return data as { items: CreditAccountingRow[]; summary: CreditAccountingSummary };
        },
        enabled: !!companyId,
        staleTime: 30_000,
    });
}

export async function fetchManagerCreditAccountingExport(
    companyId: string,
    filters: CreditAccountingFilters,
): Promise<CreditAccountingRow[]> {
    return fetchAllAccountingRows('list_manager_credit_accounting_report', {
        p_company_id: companyId,
        p_start_date: filters.startDate || null,
        p_end_date: filters.endDate || null,
    });
}

export function useAdminCreditAccountingReport(filters: CreditAccountingFilters) {
    return useQuery({
        queryKey: ['adminCreditAccounting', filters.companyId, filters.startDate, filters.endDate],
        queryFn: async () => {
            const { data, error } = await supabase.rpc('list_admin_credit_accounting_report', {
                p_company_id: filters.companyId || null,
                p_start_date: filters.startDate || null,
                p_end_date: filters.endDate || null,
                p_limit: 200,
                p_offset: 0,
            });
            if (error) throw error;
            return data as { items: CreditAccountingRow[]; summary: CreditAccountingSummary };
        },
        staleTime: 30_000,
    });
}

export async function fetchAdminCreditAccountingExport(
    filters: CreditAccountingFilters,
): Promise<CreditAccountingRow[]> {
    return fetchAllAccountingRows('list_admin_credit_accounting_report', {
        p_company_id: filters.companyId || null,
        p_start_date: filters.startDate || null,
        p_end_date: filters.endDate || null,
    });
}

export function useAdminCreditRefundCases() {
    return useQuery({
        queryKey: ['adminCreditRefunds'],
        queryFn: async () => {
            const { data, error } = await supabase.rpc('list_admin_credit_refund_cases', {
                p_limit: 100,
                p_offset: 0,
            });
            if (error) throw error;
            return (data as { items: CreditRefundCaseRow[] })?.items ?? [];
        },
        staleTime: 30_000,
    });
}
