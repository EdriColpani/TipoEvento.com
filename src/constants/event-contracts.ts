import {
    BILLING_PLANS,
    BillingPlanCode,
    getBillingPlanLabel,
} from '@/constants/billing-plans';

/**
 * Contrato usado no fluxo de criação de evento (empresa em plano com venda de ingressos).
 * Deve existir contrato ativo com este contract_type (ou legado event_terms).
 */
export const MANAGER_EVENT_CREATION_CONTRACT_TYPE = 'ticket_commission';

/** Tipos de contrato = código do plano comercial (um contrato ativo por serviço). */
export const BILLING_SERVICE_CONTRACT_TYPES: BillingPlanCode[] = [
    'listing_monthly',
    'ticket_commission',
    'ticket_plus_consumption',
    'consumption_or_license',
];

/** Contratos de plataforma (não vinculados a plano comercial). */
export const PLATFORM_CONTRACT_TYPES = ['company_registration', 'client_terms'] as const;

export type PlatformContractType = (typeof PLATFORM_CONTRACT_TYPES)[number];

/** Tipos legados ainda exibidos em listagens antigas. */
export const LEGACY_CONTRACT_TYPES = ['event_terms', 'company_membership', 'other'] as const;

export const LEGACY_CONTRACT_TYPE_LABELS: Record<string, string> = {
    event_terms: 'Termos de evento (legado — use % ingressos)',
    company_membership: 'Adesão à empresa (legado — use divulgação)',
    other: 'Outros',
};

export const PLATFORM_CONTRACT_TYPE_LABELS: Record<PlatformContractType, string> = {
    company_registration: 'Cadastro da empresa (Gestor PRO)',
    client_terms: 'Termos do cliente (comprador de ingressos)',
};

/** Ordem no select do admin: serviços primeiro, depois plataforma. */
export const CONTRACT_TYPE_SELECT_GROUPS: Array<{
    groupLabel: string;
    types: string[];
}> = [
    {
        groupLabel: 'Serviços comerciais (planos)',
        types: [...BILLING_SERVICE_CONTRACT_TYPES],
    },
    {
        groupLabel: 'Cadastro e usuários',
        types: [...PLATFORM_CONTRACT_TYPES],
    },
];

export function getContractTypeLabel(contractType: string | null | undefined): string {
    if (!contractType) return '—';
    const asPlan = BILLING_PLANS.find((p) => p.code === contractType);
    if (asPlan) return asPlan.label;
    if (contractType in PLATFORM_CONTRACT_TYPE_LABELS) {
        return PLATFORM_CONTRACT_TYPE_LABELS[contractType as PlatformContractType];
    }
    if (contractType in LEGACY_CONTRACT_TYPE_LABELS) {
        return LEGACY_CONTRACT_TYPE_LABELS[contractType];
    }
    return contractType;
}

/** contract_type gravado em event_contracts para um plano. */
export function getContractTypeForBillingPlan(plan: BillingPlanCode): string {
    return plan;
}

/** Aceita tipo novo (código do plano) ou legado durante migração. */
export function contractTypeMatchesBillingPlan(
    contractType: string | null | undefined,
    plan: BillingPlanCode,
): boolean {
    if (!contractType) return false;
    if (contractType === plan) return true;
    if (plan === 'ticket_commission' && contractType === 'event_terms') return true;
    if (plan === 'listing_monthly' && contractType === 'company_membership') return true;
    return false;
}

/** Tipos válidos ao criar contrato no admin (sem legado). */
export function getSelectableContractTypes(): string[] {
    return [...BILLING_SERVICE_CONTRACT_TYPES, ...PLATFORM_CONTRACT_TYPES];
}

export function isBillingServiceContractType(contractType: string): boolean {
    return BILLING_SERVICE_CONTRACT_TYPES.includes(contractType as BillingPlanCode);
}

export function getBillingPlanLabelFromContractType(contractType: string): string | null {
    if (BILLING_SERVICE_CONTRACT_TYPES.includes(contractType as BillingPlanCode)) {
        return getBillingPlanLabel(contractType as BillingPlanCode);
    }
    return null;
}

/** Tipos a consultar no banco (inclui legado durante migração). */
export function getContractTypesForBillingPlan(plan: BillingPlanCode): string[] {
    const types: string[] = [plan];
    if (plan === 'ticket_commission') types.push('event_terms');
    if (plan === 'listing_monthly') types.push('company_membership');
    return types;
}
