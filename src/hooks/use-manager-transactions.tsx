import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { showError } from '@/utils/toast';

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
      net_amount_after_mp,
      created_at,
      paid_at,
      events:event_id (
        id,
        title,
        date
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
  const mapped = (data || []).map((row: any) => {
    const gross = typeof row.gross_amount === 'number' ? row.gross_amount : Number(row.gross_amount ?? row.total_value ?? 0);
    const fee = typeof row.mp_fee_amount === 'number' ? row.mp_fee_amount : Number(row.mp_fee_amount ?? 0);
    const mp_fee_percentage = gross > 0 ? (fee / gross) * 100 : null;
    return {
      ...row,
      mp_fee_percentage,
    };
  });
  return mapped as ManagerTransactionData[];
};

export const useManagerTransactions = (
  userId: string | undefined,
  isAdminMaster: boolean,
  filters: ManagerTransactionFilters = {},
) => {
  const query = useQuery({
    queryKey: ['managerTransactions', userId, isAdminMaster, filters],
    queryFn: () => fetchManagerTransactions(userId!, isAdminMaster, filters),
    enabled: !!userId,
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

