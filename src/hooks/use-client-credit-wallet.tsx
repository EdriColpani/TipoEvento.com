import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export type CreditLedgerEntry = {
    id: string;
    account_user_id: string;
    entry_type: string;
    entry_subtype: string | null;
    amount: number;
    balance_after: number;
    public_description: string;
    created_at: string;
    gross_paid_amount: number | null;
    mp_fee_amount: number | null;
    net_cash_received: number | null;
};

export type CreditBalance = {
    user_id: string;
    balance: number;
    currency: string;
    status: string;
};

async function fetchBalance(): Promise<CreditBalance | null> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    const { data, error } = await supabase.rpc('get_client_credit_balance');
    if (error) throw error;
    return data as CreditBalance;
}

async function fetchLedger(): Promise<CreditLedgerEntry[]> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return [];

    const { data, error } = await supabase.rpc('list_credit_ledger', {
        p_limit: 50,
        p_offset: 0,
    });
    if (error) throw error;
    return (data ?? []) as CreditLedgerEntry[];
}

export function useClientCreditWallet() {
    const queryClient = useQueryClient();

    const balanceQuery = useQuery({
        queryKey: ['client-credit-balance'],
        queryFn: fetchBalance,
    });

    const ledgerQuery = useQuery({
        queryKey: ['client-credit-ledger'],
        queryFn: fetchLedger,
    });

    const refresh = () => {
        queryClient.invalidateQueries({ queryKey: ['client-credit-balance'] });
        queryClient.invalidateQueries({ queryKey: ['client-credit-ledger'] });
    };

    return {
        balance: balanceQuery.data?.balance ?? 0,
        currency: balanceQuery.data?.currency ?? 'BRL',
        status: balanceQuery.data?.status ?? 'active',
        isLoading: balanceQuery.isLoading || ledgerQuery.isLoading,
        isError: balanceQuery.isError || ledgerQuery.isError,
        ledger: ledgerQuery.data ?? [],
        refresh,
    };
}
