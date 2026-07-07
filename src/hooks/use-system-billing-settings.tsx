import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { readCachedAuthSession } from '@/utils/auth-session-cache';
import { DEFAULT_LISTING_MONTHLY_FEE, DEFAULT_MIN_EVENT_TICKETS } from '@/utils/company-billing-rules';
import { restGet } from '@/utils/supabase-rest';
import { callRpcRest } from '@/utils/supabase-rest-rpc';
import { withTimeout } from '@/utils/promise-timeout';

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
    ticket_inactivity_enabled: boolean;
    ticket_inactivity_fee_default: number;
    ticket_inactivity_auto_deactivate_enabled: boolean;
    ticket_inactivity_auto_deactivate_days: number;
    updated_at: string | null;
}

const DEFAULT_COMMISSION_PCT = 8;
const DEFAULT_LICENSE_FEE = 99.99;

const SETTINGS_SELECT =
    'min_event_tickets_default,listing_monthly_default_fee,hybrid_consumption_commission_pct,consumption_license_commission_pct,consumption_license_default_fee,hybrid_plan_notes,consumption_plan_notes,hybrid_consumption_module_enabled,consumption_module_enabled,ticket_inactivity_enabled,ticket_inactivity_fee_default,ticket_inactivity_auto_deactivate_enabled,ticket_inactivity_auto_deactivate_days,updated_at';

export const DEFAULT_SYSTEM_BILLING_SETTINGS: SystemBillingSettings = {
    min_event_tickets_default: DEFAULT_MIN_EVENT_TICKETS,
    listing_monthly_default_fee: DEFAULT_LISTING_MONTHLY_FEE,
    hybrid_consumption_commission_pct: DEFAULT_COMMISSION_PCT,
    consumption_license_commission_pct: DEFAULT_COMMISSION_PCT,
    consumption_license_default_fee: DEFAULT_LICENSE_FEE,
    hybrid_plan_notes: null,
    consumption_plan_notes: null,
    hybrid_consumption_module_enabled: false,
    consumption_module_enabled: false,
    ticket_inactivity_enabled: true,
    ticket_inactivity_fee_default: 0,
    ticket_inactivity_auto_deactivate_enabled: false,
    ticket_inactivity_auto_deactivate_days: 30,
    updated_at: null,
};

function mapSystemBillingSettings(data: Record<string, unknown> | null | undefined): SystemBillingSettings {
    if (!data) return DEFAULT_SYSTEM_BILLING_SETTINGS;
    return {
        min_event_tickets_default: Number(data.min_event_tickets_default ?? DEFAULT_MIN_EVENT_TICKETS),
        listing_monthly_default_fee: Number(data.listing_monthly_default_fee ?? DEFAULT_LISTING_MONTHLY_FEE),
        hybrid_consumption_commission_pct: Number(
            data.hybrid_consumption_commission_pct ?? DEFAULT_COMMISSION_PCT,
        ),
        consumption_license_commission_pct: Number(
            data.consumption_license_commission_pct ?? DEFAULT_COMMISSION_PCT,
        ),
        consumption_license_default_fee: Number(
            data.consumption_license_default_fee ?? DEFAULT_LICENSE_FEE,
        ),
        hybrid_plan_notes: (data.hybrid_plan_notes as string | null) ?? null,
        consumption_plan_notes: (data.consumption_plan_notes as string | null) ?? null,
        hybrid_consumption_module_enabled: data.hybrid_consumption_module_enabled === true,
        consumption_module_enabled: data.consumption_module_enabled === true,
        ticket_inactivity_enabled: data.ticket_inactivity_enabled !== false,
        ticket_inactivity_fee_default: Number(data.ticket_inactivity_fee_default ?? 0),
        ticket_inactivity_auto_deactivate_enabled: data.ticket_inactivity_auto_deactivate_enabled === true,
        ticket_inactivity_auto_deactivate_days: Number(data.ticket_inactivity_auto_deactivate_days ?? 30),
        updated_at: (data.updated_at as string | null) ?? null,
    };
}

async function fetchSystemBillingSettings(): Promise<SystemBillingSettings> {
    try {
        const rows = await restGet<Record<string, unknown>[]>(
            `system_billing_settings?id=eq.1&select=${SETTINGS_SELECT}&limit=1`,
            8_000,
        );
        if (rows?.[0]) return mapSystemBillingSettings(rows[0]);
    } catch (restError) {
        console.warn('[useSystemBillingSettings] REST falhou:', restError);
    }

    const { data, error } = await withTimeout(
        supabase
            .from('system_billing_settings')
            .select(SETTINGS_SELECT.replace(/,/g, ', '))
            .eq('id', 1)
            .maybeSingle(),
        8_000,
        { data: null, error: { message: 'timeout', code: 'TIMEOUT' } as { message: string; code: string } },
    );

    if (error?.code === '42P01' || error?.message?.includes('does not exist')) {
        return DEFAULT_SYSTEM_BILLING_SETTINGS;
    }
    if (error && error.code !== 'PGRST116' && error.code !== 'TIMEOUT') {
        console.warn('[useSystemBillingSettings]', error.message);
    }

    return mapSystemBillingSettings(data as Record<string, unknown> | null);
}

export function useSystemBillingSettings(enabled: boolean) {
    const queryClient = useQueryClient();

    const query = useQuery({
        queryKey: ['systemBillingSettings'],
        queryFn: () => withTimeout(fetchSystemBillingSettings(), 10_000, DEFAULT_SYSTEM_BILLING_SETTINGS),
        enabled,
        staleTime: 1000 * 60 * 2,
        retry: 1,
        placeholderData: DEFAULT_SYSTEM_BILLING_SETTINGS,
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
    const { userId } = readCachedAuthSession();

    const { error } = await supabase.from('system_billing_settings').upsert(
        {
            id: 1,
            ...patch,
            updated_at: new Date().toISOString(),
            updated_by: userId ?? null,
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
    const row = await callRpcRest<{ companies_updated?: number }>(
        'admin_set_min_event_tickets_default',
        {
            p_min_tickets: minTickets,
            p_apply_to_non_customized: applyToNonCustomized,
        },
        15_000,
    );

    return { companies_updated: Number(row.companies_updated ?? 0) };
}

export async function saveCompanyMinEventTickets(
    companyId: string,
    options: { minTickets: number } | { restoreGlobalDefault: true },
): Promise<void> {
    await callRpcRest('admin_set_company_min_event_tickets', {
        p_company_id: companyId,
        p_min_tickets: 'restoreGlobalDefault' in options ? null : options.minTickets,
        p_restore_global_default: 'restoreGlobalDefault' in options,
    }, 12_000);
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
