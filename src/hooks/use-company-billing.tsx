import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { BillingPlanCode, CompanyBillingFields } from '@/constants/billing-plans';
import { restGet } from '@/utils/supabase-rest';
import { withTimeout } from '@/utils/promise-timeout';
import { fetchEventContractVersion } from '@/utils/fetch-event-contract-version';

export interface CompanyBillingRow extends CompanyBillingFields {
    id: string;
    corporate_name: string | null;
    billing_contract_version?: string | null;
    listing_monthly_fee?: number | null;
    consumption_license_fee?: number | null;
    min_event_tickets?: number;
    min_event_tickets_customized?: boolean;
    ticket_inactivity_blocked?: boolean;
    ticket_inactivity_reference_month?: string | null;
}

const BILLING_SELECT =
    'id, corporate_name, billing_plan, billing_plan_accepted_at, billing_contract_id, billing_plan_locked_until, requires_billing_reacceptance, listing_active_until, listing_last_payment_at, listing_monthly_fee, consumption_license_fee, min_event_tickets, min_event_tickets_customized, ticket_inactivity_blocked, ticket_inactivity_reference_month, billing_contract:event_contracts!billing_contract_id(version)';

const BILLING_SELECT_REST =
    'id,corporate_name,billing_plan,billing_plan_accepted_at,billing_contract_id,billing_plan_locked_until,requires_billing_reacceptance,listing_active_until,listing_last_payment_at,listing_monthly_fee,consumption_license_fee,min_event_tickets,min_event_tickets_customized,ticket_inactivity_blocked,ticket_inactivity_reference_month';

async function fetchCompanyBilling(companyId: string): Promise<CompanyBillingRow | null> {
    try {
        const rows = await restGet<Record<string, unknown>[]>(
            `companies?id=eq.${companyId}&select=${BILLING_SELECT_REST}&limit=1`,
            8_000,
        );
        const row = rows?.[0];
        if (row) {
            const billingContractId = row.billing_contract_id as string | null;
            const billingContractVersion = billingContractId
                ? await fetchEventContractVersion(billingContractId)
                : null;

            return {
                id: row.id as string,
                corporate_name: row.corporate_name as string | null,
                billing_plan: (row.billing_plan as BillingPlanCode | null) ?? null,
                billing_plan_accepted_at: row.billing_plan_accepted_at as string | null,
                billing_contract_id: billingContractId,
                billing_plan_locked_until: row.billing_plan_locked_until as string | null,
                requires_billing_reacceptance: Boolean(row.requires_billing_reacceptance),
                listing_active_until: (row.listing_active_until as string | null) ?? null,
                listing_last_payment_at: (row.listing_last_payment_at as string | null) ?? null,
                listing_monthly_fee: (row.listing_monthly_fee as number | null) ?? null,
                consumption_license_fee: (row.consumption_license_fee as number | null) ?? null,
                min_event_tickets: Number(row.min_event_tickets ?? 10),
                min_event_tickets_customized: Boolean(row.min_event_tickets_customized),
                ticket_inactivity_blocked: Boolean(row.ticket_inactivity_blocked),
                ticket_inactivity_reference_month: (row.ticket_inactivity_reference_month as string | null) ?? null,
                billing_contract_version: billingContractVersion,
            };
        }
    } catch (restError) {
        console.warn('[useCompanyBilling] REST falhou:', restError);
    }

    try {
        const { data, error } = await withTimeout(
            supabase.from('companies').select(BILLING_SELECT).eq('id', companyId).maybeSingle(),
            8_000,
            { data: null, error: { message: 'timeout', code: 'TIMEOUT' } as { message: string; code: string } },
        );

        if (error && error.code !== 'PGRST116') {
            console.warn('companyBilling:', error.message);
            return null;
        }
        if (!data) return null;

        const row = data as Record<string, unknown>;
        const nested = row.billing_contract as { version?: string } | null | undefined;

        return {
            id: row.id as string,
            corporate_name: row.corporate_name as string | null,
            billing_plan: (row.billing_plan as BillingPlanCode | null) ?? null,
            billing_plan_accepted_at: row.billing_plan_accepted_at as string | null,
            billing_contract_id: row.billing_contract_id as string | null,
            billing_plan_locked_until: row.billing_plan_locked_until as string | null,
            requires_billing_reacceptance: Boolean(row.requires_billing_reacceptance),
            listing_active_until: (row.listing_active_until as string | null) ?? null,
            listing_last_payment_at: (row.listing_last_payment_at as string | null) ?? null,
            listing_monthly_fee: (row.listing_monthly_fee as number | null) ?? null,
            consumption_license_fee: (row.consumption_license_fee as number | null) ?? null,
            min_event_tickets: Number(row.min_event_tickets ?? 10),
            min_event_tickets_customized: Boolean(row.min_event_tickets_customized),
            ticket_inactivity_blocked: Boolean(row.ticket_inactivity_blocked),
            ticket_inactivity_reference_month: (row.ticket_inactivity_reference_month as string | null) ?? null,
            billing_contract_version: nested?.version ?? null,
        };
    } catch (e) {
        console.warn('companyBilling failed', e);
        return null;
    }
}

export function useCompanyBilling(companyId: string | undefined) {
    const queryClient = useQueryClient();

    const query = useQuery({
        queryKey: ['companyBilling', companyId],
        queryFn: () => withTimeout(fetchCompanyBilling(companyId!), 12_000, null),
        enabled: !!companyId,
        staleTime: 1000 * 60 * 2,
        retry: 1,
    });

    return {
        ...query,
        billing: query.data,
        invalidate: () => queryClient.invalidateQueries({ queryKey: ['companyBilling', companyId] }),
    };
}
