import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { showError } from '@/utils/toast';
import { restGet } from '@/utils/supabase-rest';
import { withTimeout } from '@/utils/promise-timeout';

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
  wristband_analytics_ids: string[] | null;
  events: {
    id: string;
    title: string;
    date: string;
    location: string;
    address: string | null;
    address_lat: number | null;
    address_lng: number | null;
    description: string | null;
  } | null;
}

const PURCHASE_SELECT =
  'id,status,payment_status,mp_status_detail,mp_payment_id,total_value,gross_amount,mp_fee_amount,net_amount_after_mp,created_at,paid_at,wristband_analytics_ids,events:event_id(id,title,date,location,address,address_lat,address_lng,description)';

async function fetchMyPurchases(userId: string): Promise<PurchaseData[]> {
  if (!userId) return [];

  const restPath =
    `receivables?client_user_id=eq.${encodeURIComponent(userId)}` +
    `&select=${encodeURIComponent(PURCHASE_SELECT)}` +
    '&order=created_at.desc';

  try {
    return await restGet<PurchaseData[]>(restPath, 12_000);
  } catch (restError) {
    console.warn('[useMyPurchases] REST falhou:', restError);
  }

  const { data, error } = await withTimeout(
    supabase
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
      wristband_analytics_ids,
      events:event_id (
        id,
        title,
        date,
        location,
        address,
        address_lat,
        address_lng,
        description
      )
    `)
      .eq('client_user_id', userId)
      .order('created_at', { ascending: false }),
    12_000,
    { data: null, error: { message: 'Tempo esgotado ao carregar compras.' } as { message: string } },
  );

  if (error?.message) {
    console.error('Error fetching user purchases:', error);
    throw new Error(error.message);
  }

  return (data || []) as PurchaseData[];
}

export const useMyPurchases = (userId: string | undefined) => {
  const query = useQuery({
    queryKey: ['myPurchases', userId],
    queryFn: () => fetchMyPurchases(userId!),
    enabled: !!userId,
    staleTime: 1000 * 60,
    retry: 1,
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
