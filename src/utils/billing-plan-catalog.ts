import type { BillingPlanCode, BillingPlanDefinition } from '@/constants/billing-plans';
import { getBillingPlanDefinition } from '@/constants/billing-plans';
import type { SystemBillingSettings } from '@/hooks/use-system-billing-settings';
import { formatCurrencyBrInput } from '@/utils/currency-input';

export interface PublicCommissionRange {
    min_tickets: number;
    max_tickets: number;
    percentage: number;
}

/** Aba correspondente em Admin → Preços e comissões */
export const ADMIN_PRICING_TAB_BY_PLAN: Record<BillingPlanCode, string> = {
    listing_monthly: 'Divulgação',
    ticket_commission: 'Cobrança de ingressos',
    ticket_plus_consumption: 'Ingresso + consumo',
    consumption_or_license: 'Consumo / licença',
};

export interface BillingPlanDisplayInfo {
    priceLabel: string;
    priceDetail: string;
    pricingBullets: string[];
    /** Faixas ativas (aba Cobrança de ingressos) */
    commissionTiers?: PublicCommissionRange[];
    /** Aba do admin de onde vêm os valores */
    adminPricingTab: string;
    usesCompanyOverride?: boolean;
    settingsUpdatedAt?: string | null;
}

export interface CompanyPlanFeeOverrides {
    listingMonthlyFee?: number | null;
    consumptionLicenseFee?: number | null;
}

function formatCurrencyBRL(value: number): string {
    return `R$ ${formatCurrencyBrInput(value)}`;
}

function formatPct(value: number): string {
    return `${value.toFixed(2).replace('.', ',')}%`;
}

function formatTicketRange(min: number, max: number): string {
    const minStr = min.toLocaleString('pt-BR');
    if (max >= 999999) return `${minStr}+ ingressos`;
    return `${minStr} a ${max.toLocaleString('pt-BR')} ingressos`;
}

export function formatCommissionRangesSummary(ranges: PublicCommissionRange[]): string {
    const active = ranges.filter((r) => r.percentage > 0);
    if (!active.length) {
        return 'Comissão por faixa de volume — consulte o contrato';
    }
    const minPct = Math.min(...active.map((r) => Number(r.percentage)));
    const maxPct = Math.max(...active.map((r) => Number(r.percentage)));
    if (minPct === maxPct) {
        return `${formatPct(minPct)} sobre cada ingresso vendido`;
    }
    return `De ${formatPct(minPct)} a ${formatPct(maxPct)} conforme volume de ingressos vendidos`;
}

export function formatCommissionRangesDetail(ranges: PublicCommissionRange[]): string[] {
    const active = ranges.filter((r) => r.percentage > 0);
    if (!active.length) return [];
    return active.map(
        (r) =>
            `${formatTicketRange(r.min_tickets, r.max_tickets)}: ${formatPct(Number(r.percentage))} de comissão EventFest`,
    );
}

function resolveListingFee(settings: SystemBillingSettings, overrides?: CompanyPlanFeeOverrides): number {
    return overrides?.listingMonthlyFee ?? settings.listing_monthly_default_fee;
}

function resolveLicenseFee(settings: SystemBillingSettings, overrides?: CompanyPlanFeeOverrides): number {
    return overrides?.consumptionLicenseFee ?? settings.consumption_license_default_fee;
}

function hasListingOverride(settings: SystemBillingSettings, overrides?: CompanyPlanFeeOverrides): boolean {
    return (
        overrides?.listingMonthlyFee != null &&
        overrides.listingMonthlyFee !== settings.listing_monthly_default_fee
    );
}

function hasLicenseOverride(settings: SystemBillingSettings, overrides?: CompanyPlanFeeOverrides): boolean {
    return (
        overrides?.consumptionLicenseFee != null &&
        overrides.consumptionLicenseFee !== settings.consumption_license_default_fee
    );
}

export function buildBillingPlanDisplay(
    plan: BillingPlanDefinition,
    settings: SystemBillingSettings,
    commissionRanges: PublicCommissionRange[],
    overrides?: CompanyPlanFeeOverrides,
): BillingPlanDisplayInfo {
    const activeTiers = commissionRanges.filter((r) => r.percentage > 0);
    const commissionSummary = formatCommissionRangesSummary(activeTiers);
    const commissionDetail = formatCommissionRangesDetail(activeTiers);
    const listingFee = resolveListingFee(settings, overrides);
    const licenseFee = resolveLicenseFee(settings, overrides);
    const hybridPct = settings.hybrid_consumption_commission_pct;
    const licensePct = settings.consumption_license_commission_pct;
    const listingOverride = hasListingOverride(settings, overrides);
    const licenseOverride = hasLicenseOverride(settings, overrides);
    const adminTab = ADMIN_PRICING_TAB_BY_PLAN[plan.code];
    const updatedAt = settings.updated_at;

    switch (plan.code) {
        case 'listing_monthly':
            return {
                priceLabel: `${formatCurrencyBRL(listingFee)}/mês`,
                priceDetail: 'Mensalidade padrão do sistema (aba Divulgação)',
                pricingBullets: [
                    `Mensalidade padrão do sistema: ${formatCurrencyBRL(settings.listing_monthly_default_fee)}/mês`,
                    ...(listingOverride
                        ? [`Valor da sua empresa: ${formatCurrencyBRL(listingFee!)}/mês (personalizado pela EventFest)`]
                        : []),
                    'Sem comissão sobre ingressos — não há venda de ingressos neste plano',
                    'Pagamento via Mercado Pago em Relatórios → Mensalidade de divulgação',
                ],
                adminPricingTab: adminTab,
                usesCompanyOverride: listingOverride,
                settingsUpdatedAt: updatedAt,
            };
        case 'ticket_commission':
            return {
                priceLabel: commissionSummary,
                priceDetail: 'Faixas de comissão cadastradas em Cobrança de ingressos',
                pricingBullets: [
                    commissionSummary,
                    ...commissionDetail,
                    'Sem mensalidade fixa de divulgação',
                    'Comissão aplicada automaticamente em cada venda de ingresso',
                ],
                commissionTiers: activeTiers,
                adminPricingTab: adminTab,
                settingsUpdatedAt: updatedAt,
            };
        case 'ticket_plus_consumption':
            return {
                priceLabel: `${commissionSummary} + ${formatPct(hybridPct)} consumo`,
                priceDetail: 'Ingressos (faixas) + % sobre consumo de créditos (aba Ingresso + consumo)',
                pricingBullets: [
                    `Ingressos — ${commissionSummary}`,
                    ...commissionDetail,
                    `% EventFest sobre consumo de créditos: ${formatPct(hybridPct)} (aba Ingresso + consumo)`,
                    settings.hybrid_consumption_module_enabled
                        ? 'Módulo de consumo: liberado pela EventFest'
                        : 'Módulo de consumo: aguardando liberação pela EventFest',
                    'Sem licença mensal fixa (diferente do plano Consumo / licença)',
                ],
                commissionTiers: activeTiers,
                adminPricingTab: adminTab,
                settingsUpdatedAt: updatedAt,
            };
        case 'consumption_or_license':
            return {
                priceLabel: `${formatCurrencyBRL(licenseFee)}/mês + ${formatPct(licensePct)} consumo`,
                priceDetail: 'Licença mensal + % sobre consumo (aba Consumo / licença)',
                pricingBullets: [
                    `Licença mensal padrão: ${formatCurrencyBRL(settings.consumption_license_default_fee)}/mês`,
                    ...(licenseOverride
                        ? [`Licença da sua empresa: ${formatCurrencyBRL(licenseFee!)}/mês (personalizada)`]
                        : []),
                    `% EventFest sobre consumo de créditos: ${formatPct(licensePct)}`,
                    'Cobrança integral da licença no mês da adesão ao plano',
                    'Eventos em vitrine — sem venda de ingressos pagos pela plataforma',
                    settings.consumption_module_enabled
                        ? 'Módulo de consumo: liberado pela EventFest'
                        : 'Módulo de consumo: aguardando liberação pela EventFest',
                ],
                adminPricingTab: adminTab,
                usesCompanyOverride: licenseOverride,
                settingsUpdatedAt: updatedAt,
            };
        default:
            return {
                priceLabel: 'Consulte o contrato',
                priceDetail: plan.description,
                pricingBullets: [],
                adminPricingTab: adminTab,
                settingsUpdatedAt: updatedAt,
            };
    }
}

export function buildAllBillingPlanDisplays(
    settings: SystemBillingSettings,
    commissionRanges: PublicCommissionRange[],
    overrides?: CompanyPlanFeeOverrides,
): Record<BillingPlanCode, BillingPlanDisplayInfo> {
    const result = {} as Record<BillingPlanCode, BillingPlanDisplayInfo>;
    for (const plan of [
        'listing_monthly',
        'ticket_commission',
        'ticket_plus_consumption',
        'consumption_or_license',
    ] as BillingPlanCode[]) {
        const def = getBillingPlanDefinition(plan);
        if (def) {
            result[plan] = buildBillingPlanDisplay(def, settings, commissionRanges, overrides);
        }
    }
    return result;
}
