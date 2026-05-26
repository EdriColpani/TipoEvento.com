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
