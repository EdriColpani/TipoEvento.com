import { callRpcRest } from '@/utils/supabase-rest-rpc';
import { companyAllowsTicketSales } from '@/utils/company-billing-rules';
import { batchQuantityAsNumber } from '@/utils/batch-quantity';
import type { BillingPlanCode } from '@/constants/billing-plans';

/** Ingressos ativos emitidos para o evento (analytics com preço > 0). */
export async function fetchEventActiveTicketCount(eventId: string): Promise<number> {
    const data = await callRpcRest<number>('event_active_wristband_count', {
        p_event_id: eventId,
    }, 10_000);
    return Number(data ?? 0);
}

export function buildMinTicketsShortfallMessage(
    minRequired: number,
    adding: number,
    currentTotal: number,
): string {
    const after = currentTotal + adding;
    return (
        `É necessário ter pelo menos ${minRequired} ingressos ativos neste evento. ` +
        `Você está cadastrando ${adding}; o total ficaria ${after}.`
    );
}

export function validateMinBatchTicketSum(
    batches: Array<{ quantity?: string | number | null }> | undefined,
    minRequired: number,
): string | null {
    const batchSum = (batches ?? []).reduce((sum, b) => sum + batchQuantityAsNumber(b.quantity), 0);
    if (batchSum < minRequired) {
        return `A soma das quantidades dos lotes deve ser pelo menos ${minRequired} ingressos (mínimo da sua empresa).`;
    }
    return null;
}

export async function validateEventTicketMinimumOnIssue(params: {
    eventId: string;
    billingPlan: BillingPlanCode | string | null | undefined;
    minEventTickets: number;
    quantityToAdd: number;
    unitPrice: number;
}): Promise<string | null> {
    const { eventId, billingPlan, minEventTickets, quantityToAdd, unitPrice } = params;

    if (!companyAllowsTicketSales(billingPlan) || unitPrice <= 0 || quantityToAdd < 1) {
        return null;
    }

    const current = await fetchEventActiveTicketCount(eventId);
    if (current + quantityToAdd < minEventTickets) {
        return buildMinTicketsShortfallMessage(minEventTickets, quantityToAdd, current);
    }

    return null;
}
