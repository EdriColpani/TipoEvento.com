import { useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { readCachedAuthSession } from '@/utils/auth-session-cache';
import { callRpcRest } from '@/utils/supabase-rest-rpc';
import { withTimeout } from '@/utils/promise-timeout';

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

function parseCreditBalance(raw: unknown): CreditBalance | null {
    if (!raw || typeof raw !== 'object') return null;
    const row = raw as Record<string, unknown>;
    return {
        user_id: String(row.user_id ?? ''),
        balance: Number(row.balance ?? 0),
        currency: String(row.currency ?? 'BRL'),
        status: String(row.status ?? 'active'),
    };
}

async function fetchBalance(): Promise<CreditBalance | null> {
    const { userId, accessToken } = readCachedAuthSession();
    if (!userId || !accessToken) return null;

    try {
        const data = await callRpcRest<unknown>('get_client_credit_balance', {}, 12_000);
        return parseCreditBalance(data);
    } catch (restError) {
        console.warn('[useClientCreditWallet] balance REST falhou:', restError);
    }

    const { data, error } = await withTimeout(
        supabase.rpc('get_client_credit_balance'),
        12_000,
        { data: null, error: { message: 'Tempo esgotado ao carregar saldo.' } as { message: string } },
    );
    if (error?.message) throw new Error(error.message);
    return parseCreditBalance(data);
}

async function fetchLedger(): Promise<CreditLedgerEntry[]> {
    const { userId, accessToken } = readCachedAuthSession();
    if (!userId || !accessToken) return [];

    const args = { p_limit: 50, p_offset: 0 };

    try {
        const data = await callRpcRest<CreditLedgerEntry[]>('list_credit_ledger', args, 12_000);
        return data ?? [];
    } catch (restError) {
        console.warn('[useClientCreditWallet] ledger REST falhou:', restError);
    }

    const { data, error } = await withTimeout(
        supabase.rpc('list_credit_ledger', args),
        12_000,
        { data: null, error: { message: 'Tempo esgotado ao carregar extrato.' } as { message: string } },
    );
    if (error?.message) throw new Error(error.message);
    return (data ?? []) as CreditLedgerEntry[];
}

function resolveDisplayBalance(
    balanceData: CreditBalance | null | undefined,
    ledger: CreditLedgerEntry[] | undefined,
): number {
    const fromRpc = balanceData?.balance;
    const latestLedgerBalance = ledger?.[0]?.balance_after;

    if (fromRpc != null && Number.isFinite(fromRpc)) {
        if (fromRpc === 0 && latestLedgerBalance != null && latestLedgerBalance > 0) {
            return latestLedgerBalance;
        }
        return fromRpc;
    }

    return latestLedgerBalance ?? 0;
}

export function useClientCreditWallet() {
    const queryClient = useQueryClient();

    const balanceQuery = useQuery({
        queryKey: ['client-credit-balance'],
        queryFn: fetchBalance,
        staleTime: 15_000,
        retry: 1,
    });

    const ledgerQuery = useQuery({
        queryKey: ['client-credit-ledger'],
        queryFn: fetchLedger,
        staleTime: 15_000,
        retry: 1,
    });

    const balance = useMemo(
        () => resolveDisplayBalance(balanceQuery.data, ledgerQuery.data),
        [balanceQuery.data, ledgerQuery.data],
    );

    const refresh = () => {
        queryClient.invalidateQueries({ queryKey: ['client-credit-balance'] });
        queryClient.invalidateQueries({ queryKey: ['client-credit-ledger'] });
    };

    return {
        balance,
        currency: balanceQuery.data?.currency ?? 'BRL',
        status: balanceQuery.data?.status ?? 'active',
        isLoading: balanceQuery.isLoading && ledgerQuery.isLoading,
        isBalanceLoading: balanceQuery.isLoading && resolveDisplayBalance(balanceQuery.data, ledgerQuery.data) === 0,
        isLedgerLoading: ledgerQuery.isLoading,
        isError: balanceQuery.isError && ledgerQuery.isError,
        ledger: ledgerQuery.data ?? [],
        refresh,
    };
}
