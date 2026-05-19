import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { DEFAULT_LISTING_MONTHLY_FEE } from '@/utils/company-billing-rules';

export interface SystemBillingSettings {
    listing_monthly_default_fee: number;
    updated_at: string | null;
}

async function fetchSystemBillingSettings(): Promise<SystemBillingSettings> {
    const { data, error } = await supabase
        .from('system_billing_settings')
        .select('listing_monthly_default_fee, updated_at')
        .eq('id', 1)
        .maybeSingle();

    if (error) {
        if (error.code === '42P01' || error.message?.includes('does not exist')) {
            return { listing_monthly_default_fee: DEFAULT_LISTING_MONTHLY_FEE, updated_at: null };
        }
        throw new Error(error.message);
    }

    return {
        listing_monthly_default_fee: Number(data?.listing_monthly_default_fee ?? DEFAULT_LISTING_MONTHLY_FEE),
        updated_at: data?.updated_at ?? null,
    };
}

export function useSystemBillingSettings(enabled: boolean) {
    const queryClient = useQueryClient();

    const query = useQuery({
        queryKey: ['systemBillingSettings'],
        queryFn: fetchSystemBillingSettings,
        enabled,
        staleTime: 1000 * 60 * 2,
    });

    return {
        settings: query.data,
        listingMonthlyDefaultFee: query.data?.listing_monthly_default_fee ?? DEFAULT_LISTING_MONTHLY_FEE,
        isLoading: query.isLoading,
        isError: query.isError,
        invalidate: () => queryClient.invalidateQueries({ queryKey: ['systemBillingSettings'] }),
    };
}

export async function saveListingMonthlyDefaultFee(fee: number): Promise<void> {
    const { data: { user } } = await supabase.auth.getUser();

    const { error } = await supabase
        .from('system_billing_settings')
        .upsert(
            {
                id: 1,
                listing_monthly_default_fee: fee,
                updated_at: new Date().toISOString(),
                updated_by: user?.id ?? null,
            },
            { onConflict: 'id' },
        );

    if (error) throw new Error(error.message);
}
