import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { showError } from '@/utils/toast';

export interface PurchaseData {
  id: string;
  status: 'pending' | 'paid' | 'failed';
  payment_status: string | null;
  mp_status_detail: string | null;
  mp_payment_id: string | null;
  total_value: number;
  gross_amount: number | null;
  mp_fee_amount: number | null;
  net_amount_after_mp: number | null;
  created_at: string;
  paid_at: string | null;
  events: {
    id: string;
    title: string;
    date: string;
    location: string;
  } | null;
}

const fetchMyPurchases = async (userId: string): Promise<PurchaseData[]> => {
  if (!userId) return [];

  const { data, error } = await supabase
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
        date,
        location
      )
    `)
    .eq('client_user_id', userId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error fetching user purchases:', error);
    throw new Error(error.message);
  }

  return (data || []) as PurchaseData[];
};

export const useMyPurchases = (userId: string | undefined) => {
  const query = useQuery({
    queryKey: ['myPurchases', userId],
    queryFn: () => fetchMyPurchases(userId!),
    enabled: !!userId,
    staleTime: 1000 * 60,
    onError: (error) => {
      console.error('Query Error: Failed to load user purchases.', error);
      showError('Erro ao carregar suas compras. Tente novamente.');
    },
  });

  return {
    ...query,
    purchases: query.data || [],
  };
};

