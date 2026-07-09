import { useQuery } from '@tanstack/react-query';
import { consolidateSplitsByTransaction, resolveReceivableFinancials } from '@/utils/resolve-receivable-financials';
import { fetchFinancialSplitsRest, fetchReceivablesRest } from '@/utils/fetch-receivables-rest';

export interface ManagerTransactionData {
  id: string;
  status: 'pending' | 'paid' | 'failed';
  payment_status: string | null;
  mp_status_detail: string | null;
  mp_payment_id: string | null;
  total_value: number;
  gross_amount: number | null;
  mp_fee_amount: number | null;
  mp_fee_percentage: number | null;
  net_amount_after_mp: number | null;
  system_commission_percentage: number | null;
  system_commission_amount: number | null;
  organizer_net_amount: number | null;
  /** true quando financial_splits foi gravado (comissão + líquido gestor). */
  split_recorded: boolean;
  created_at: string;
  paid_at: string | null;
  events: {
    id: string;
    title: string;
    date: string;
  } | null;
}

export interface ManagerTransactionFilters {
  eventId?: string;
  startDate?: string;
  endDate?: string;
  status?: 'pending' | 'paid' | 'failed';
}

const fetchManagerTransactions = async (
  userId: string,
  isAdminMaster: boolean,
  filters: ManagerTransactionFilters = {},
): Promise<ManagerTransactionData[]> => {
  const data = await fetchReceivablesRest(filters, userId, isAdminMaster, {
    limit: 100,
    orderDesc: true,
  });

  const transactionIds = data.map((row) => row.id);
  const splits = await fetchFinancialSplitsRest(transactionIds);
  const splitByTransaction = consolidateSplitsByTransaction(splits);

  return data.map((row) => {
    const gross = typeof row.gross_amount === 'number' ? row.gross_amount : Number(row.gross_amount ?? row.total_value ?? 0);
    const fee = typeof row.mp_fee_amount === 'number' ? row.mp_fee_amount : Number(row.mp_fee_amount ?? 0);
    const netMp = typeof row.net_amount_after_mp === 'number'
      ? row.net_amount_after_mp
      : Number(row.net_amount_after_mp ?? Math.max(gross - fee, 0));
    const mp_fee_percentage = gross > 0 ? (fee / gross) * 100 : null;
    const eventPct =
      row.events?.applied_percentage !== null && row.events?.applied_percentage !== undefined
        ? Number(row.events.applied_percentage)
        : null;
    const resolved = resolveReceivableFinancials(row, splitByTransaction.get(row.id), eventPct);
    const split = splitByTransaction.get(row.id);
    const splitRecorded = Boolean(
      split &&
        (split.system_commission_amount > 0 || split.organizer_net_amount > 0),
    );

    return {
      ...row,
      status: row.status as ManagerTransactionData['status'],
      net_amount_after_mp: netMp,
      mp_fee_percentage,
      system_commission_percentage: resolved.appliedPercentage,
      system_commission_amount: resolved.systemCommission,
      organizer_net_amount: resolved.organizerNet,
      split_recorded: splitRecorded,
    };
  });
};

export const useManagerTransactions = (
  userId: string | undefined,
  isAdminMaster: boolean,
  filters: ManagerTransactionFilters = {},
  options?: { enabled?: boolean },
) => {
  const enabled =
    options?.enabled !== undefined ? options.enabled : Boolean(userId);

  const query = useQuery({
    queryKey: ['managerTransactions', userId, isAdminMaster, filters],
    queryFn: () => fetchManagerTransactions(userId!, isAdminMaster, filters),
    enabled,
    staleTime: 30_000,
    retry: 1,
  });

  return {
    ...query,
    transactions: query.data || [],
  };
};
