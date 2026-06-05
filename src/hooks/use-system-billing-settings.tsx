import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { DEFAULT_LISTING_MONTHLY_FEE, DEFAULT_MIN_EVENT_TICKETS } from '@/utils/company-billing-rules';

export interface SystemBillingSettings {
    min_event_tickets_default: number;
    listing_monthly_default_fee: number;
    hybrid_consumption_commission_pct: number;
    consumption_license_commission_pct: number;
    consumption_license_default_fee: number;
    hybrid_plan_notes: string | null;
    consumption_plan_notes: string | null;
    hybrid_consumption_module_enabled: boolean;
    consumption_module_enabled: boolean;
    updated_at: string | null;
}

const DEFAULT_COMMISSION_PCT = 8;
const DEFAULT_LICENSE_FEE = 99.99;

async function fetchSystemBillingSettings(): Promise<SystemBillingSettings> {
    const { data, error } = await supabase
        .from('system_billing_settings')
        .select(
            'min_event_tickets_default, listing_monthly_default_fee, hybrid_consumption_commission_pct, consumption_license_commission_pct, consumption_license_default_fee, hybrid_plan_notes, consumption_plan_notes, hybrid_consumption_module_enabled, consumption_module_enabled, updated_at',
        )
        .eq('id', 1)
        .maybeSingle();

    if (error) {
        if (error.code === '42P01' || error.message?.includes('does not exist')) {
            return {
                min_event_tickets_default: DEFAULT_MIN_EVENT_TICKETS,
                listing_monthly_default_fee: DEFAULT_LISTING_MONTHLY_FEE,
                hybrid_consumption_commission_pct: DEFAULT_COMMISSION_PCT,
                consumption_license_commission_pct: DEFAULT_COMMISSION_PCT,
                consumption_license_default_fee: DEFAULT_LICENSE_FEE,
                hybrid_plan_notes: null,
                consumption_plan_notes: null,
                hybrid_consumption_module_enabled: false,
                consumption_module_enabled: false,
                updated_at: null,
            };
        }
        throw new Error(error.message);
    }

    return {
        min_event_tickets_default: Number(data?.min_event_tickets_default ?? DEFAULT_MIN_EVENT_TICKETS),
        listing_monthly_default_fee: Number(data?.listing_monthly_default_fee ?? DEFAULT_LISTING_MONTHLY_FEE),
        hybrid_consumption_commission_pct: Number(
            data?.hybrid_consumption_commission_pct ?? DEFAULT_COMMISSION_PCT,
        ),
        consumption_license_commission_pct: Number(
            data?.consumption_license_commission_pct ?? DEFAULT_COMMISSION_PCT,
        ),
        consumption_license_default_fee: Number(
            data?.consumption_license_default_fee ?? DEFAULT_LICENSE_FEE,
        ),
        hybrid_plan_notes: (data?.hybrid_plan_notes as string | null) ?? null,
        consumption_plan_notes: (data?.consumption_plan_notes as string | null) ?? null,
        hybrid_consumption_module_enabled: data?.hybrid_consumption_module_enabled === true,
        consumption_module_enabled: data?.consumption_module_enabled === true,
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
        consumptionLicenseDefaultFee: query.data?.consumption_license_default_fee ?? DEFAULT_LICENSE_FEE,
        isLoading: query.isLoading,
        isError: query.isError,
        invalidate: () => queryClient.invalidateQueries({ queryKey: ['systemBillingSettings'] }),
    };
}

async function upsertBillingSettings(patch: Record<string, unknown>): Promise<void> {
    const {
        data: { user },
    } = await supabase.auth.getUser();

    const { error } = await supabase.from('system_billing_settings').upsert(
        {
            id: 1,
            ...patch,
            updated_at: new Date().toISOString(),
            updated_by: user?.id ?? null,
        },
        { onConflict: 'id' },
    );

    if (error) throw new Error(error.message);
}

export async function saveListingMonthlyDefaultFee(fee: number): Promise<void> {
    await upsertBillingSettings({ listing_monthly_default_fee: fee });
}

export async function saveMinEventTicketsDefault(
    minTickets: number,
    applyToNonCustomized: boolean,
): Promise<{ companies_updated: number }> {
    const { data, error } = await supabase.rpc('admin_set_min_event_tickets_default', {
        p_min_tickets: minTickets,
        p_apply_to_non_customized: applyToNonCustomized,
    });

    if (error) throw new Error(error.message);

    const row = (data ?? {}) as { companies_updated?: number };
    return { companies_updated: Number(row.companies_updated ?? 0) };
}

export async function saveCompanyMinEventTickets(
    companyId: string,
    options: { minTickets: number } | { restoreGlobalDefault: true },
): Promise<void> {
    const { error } = await supabase.rpc('admin_set_company_min_event_tickets', {
        p_company_id: companyId,
        p_min_tickets: 'restoreGlobalDefault' in options ? null : options.minTickets,
        p_restore_global_default: 'restoreGlobalDefault' in options,
    });

    if (error) throw new Error(error.message);
}

export async function saveHybridPlanSettings(values: {
    commissionPct: number;
    notes: string | null;
    moduleEnabled: boolean;
}): Promise<void> {
    await upsertBillingSettings({
        hybrid_consumption_commission_pct: values.commissionPct,
        hybrid_plan_notes: values.notes,
        hybrid_consumption_module_enabled: values.moduleEnabled,
    });
}

export async function saveConsumptionLicensePlanSettings(values: {
    commissionPct: number;
    licenseFee: number;
    notes: string | null;
    moduleEnabled: boolean;
}): Promise<void> {
    await upsertBillingSettings({
        consumption_license_commission_pct: values.commissionPct,
        consumption_license_default_fee: values.licenseFee,
        consumption_plan_notes: values.notes,
        consumption_module_enabled: values.moduleEnabled,
    });
}
