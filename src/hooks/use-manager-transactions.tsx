import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { showError } from '@/utils/toast';
import { consolidateSplitsByTransaction, resolveReceivableFinancials } from '@/utils/resolve-receivable-financials';

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
  let query = supabase
    .from('receivables')
    .select(`
      id,
      status,
      payment_status,
      mp_status_detail,
      mp_payment_id,
      total_value,
      gross_amount,
      mp_fee_amount,
      platform_fee_amount,
      net_amount_after_mp,
      created_at,
      paid_at,
      events:event_id (
        id,
        title,
        date,
        applied_percentage
      )
    `)
    .order('created_at', { ascending: false })
    .limit(100);

  if (!isAdminMaster) {
    query = query.eq('manager_user_id', userId);
  }
  if (filters.eventId) query = query.eq('event_id', filters.eventId);
  if (filters.status) query = query.eq('status', filters.status);
  if (filters.startDate) query = query.gte('created_at', filters.startDate);
  if (filters.endDate) {
    const endDateWithTime = new Date(filters.endDate);
    endDateWithTime.setHours(23, 59, 59, 999);
    query = query.lte('created_at', endDateWithTime.toISOString());
  }

  const { data, error } = await query;
  if (error) throw error;

  const transactionIds = (data || []).map((row: any) => row.id);
  const { data: splits = [], error: splitsError } = transactionIds.length > 0
    ? await supabase
        .from('financial_splits')
        .select('transaction_id, platform_amount, manager_amount, applied_percentage')
        .in('transaction_id', transactionIds)
    : { data: [], error: null };
  if (splitsError) throw splitsError;

  const splitByTransaction = consolidateSplitsByTransaction(splits || []);

  const mapped = (data || []).map((row: any) => {
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
      net_amount_after_mp: netMp,
      mp_fee_percentage,
      system_commission_percentage: resolved.appliedPercentage,
      system_commission_amount: resolved.systemCommission,
      organizer_net_amount: resolved.organizerNet,
      split_recorded: splitRecorded,
    };
  });
  return mapped as ManagerTransactionData[];
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
    staleTime: 1000 * 60,
    onError: (error) => {
      console.error('Query Error: Failed to load manager transactions.', error);
      showError('Erro ao carregar transações. Tente novamente.');
    },
  });

  return {
    ...query,
    transactions: query.data || [],
  };
};

