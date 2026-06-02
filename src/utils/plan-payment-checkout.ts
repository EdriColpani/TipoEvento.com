import { supabase } from '@/integrations/supabase/client';
import type { BillingPlanCode } from '@/constants/billing-plans';
import { startListingMonthlyCheckout } from '@/utils/listing-monthly-checkout';
import { startConsumptionLicenseCheckout } from '@/utils/consumption-license-checkout';

export interface ConsumptionLicenseChargePayload {
    charge_id?: string;
    already_paid?: boolean;
    requires_payment?: boolean;
    status?: string;
}

function parseConsumptionLicensePayload(raw: unknown): ConsumptionLicenseChargePayload | null {
    if (!raw || typeof raw !== 'object') return null;
    return raw as ConsumptionLicenseChargePayload;
}

/**
 * Após confirmar plano, redireciona ao checkout MP (mensalidade vitrine ou licença consumo).
 * @throws se não conseguir gerar cobrança ou URL de pagamento
 */
export async function redirectToPlanPaymentCheckout(
    companyId: string,
    plan: BillingPlanCode,
    options?: {
        chargeId?: string;
        /** Objeto retornado por confirm/upgrade em consumption_license */
        consumptionLicenseFromRpc?: unknown;
    },
): Promise<'redirected' | 'already_paid'> {
    if (plan === 'listing_monthly') {
        const { error: ensureError } = await supabase.rpc('ensure_listing_monthly_charge', {
            p_company_id: companyId,
        });
        if (ensureError) throw new Error(ensureError.message);

        const { checkoutUrl } = await startListingMonthlyCheckout(companyId, options?.chargeId);
        window.location.href = checkoutUrl;
        return 'redirected';
    }

    if (plan === 'consumption_or_license') {
        const fromRpc = parseConsumptionLicensePayload(options?.consumptionLicenseFromRpc);
        let chargeId = options?.chargeId ?? fromRpc?.charge_id;
        let alreadyPaid =
            fromRpc?.already_paid === true ||
            fromRpc?.status === 'paid' ||
            fromRpc?.requires_payment === false;

        if (!chargeId && !alreadyPaid) {
            const { data, error } = await supabase.rpc('ensure_consumption_license_charge', {
                p_company_id: companyId,
            });
            if (error) throw new Error(error.message);
            const row = parseConsumptionLicensePayload(data);
            chargeId = row?.charge_id;
            alreadyPaid = row?.already_paid === true || row?.status === 'paid';
        }

        if (alreadyPaid) {
            return 'already_paid';
        }
        if (!chargeId) {
            throw new Error('Não foi possível gerar a cobrança da licença mensal.');
        }

        const { checkoutUrl } = await startConsumptionLicenseCheckout(companyId, chargeId);
        window.location.href = checkoutUrl;
        return 'redirected';
    }

    return 'already_paid';
}
