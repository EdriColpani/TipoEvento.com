/** Planos comerciais da empresa (espelha enum billing_plan_type no Postgres). */
export type BillingPlanCode =
    | 'listing_monthly'
    | 'ticket_commission'
    | 'ticket_plus_consumption'
    | 'consumption_or_license';

export const BILLING_PLAN_ORDER: BillingPlanCode[] = [
    'listing_monthly',
    'ticket_commission',
    'ticket_plus_consumption',
    'consumption_or_license',
];

export const BILLING_PLAN_RANK: Record<BillingPlanCode, number> = {
    listing_monthly: 1,
    ticket_commission: 2,
    ticket_plus_consumption: 3,
    consumption_or_license: 4,
};

export interface BillingPlanDefinition {
    code: BillingPlanCode;
    label: string;
    description: string;
    /** Gestor pode escolher/confirmar na v1 */
    selectableByGestor: boolean;
    contractType: string;
}

export const BILLING_PLANS: BillingPlanDefinition[] = [
    {
        code: 'listing_monthly',
        label: 'Mensalidade — divulgação',
        description: 'Cobrança mensal fixa para divulgar o evento na plataforma, sem venda de ingressos pelo sistema.',
        selectableByGestor: true,
        contractType: 'listing_monthly',
    },
    {
        code: 'ticket_commission',
        label: '% sobre venda de ingressos',
        description: 'Comissão sobre ingressos vendidos, conforme faixas cadastradas pelo administrador.',
        selectableByGestor: true,
        contractType: 'ticket_commission',
    },
    {
        code: 'ticket_plus_consumption',
        label: '% ingresso + consumo interno',
        description:
            'Venda de ingressos (faixas de comissão) + módulo de consumo interno quando liberado pelo admin. Contratação via Admin Master.',
        selectableByGestor: false,
        contractType: 'ticket_plus_consumption',
    },
    {
        code: 'consumption_or_license',
        label: 'Consumo / licença / mensal',
        description:
            'Divulgação de eventos; consumo por créditos/licença quando o módulo estiver ativo. Contratação via Admin Master.',
        selectableByGestor: false,
        contractType: 'consumption_or_license',
    },
];

export function getBillingPlanDefinition(code: BillingPlanCode | string | null | undefined): BillingPlanDefinition | undefined {
    return BILLING_PLANS.find((p) => p.code === code);
}

export function getBillingPlanLabel(code: BillingPlanCode | string | null | undefined): string {
    return getBillingPlanDefinition(code)?.label ?? (code ? String(code) : '—');
}

export const BILLING_CHANGE_TYPE_LABELS: Record<string, string> = {
    initial: 'Confirmação inicial',
    reacceptance: 'Reaceite de contrato',
    upgrade: 'Upgrade (gestor)',
    admin_change: 'Alteração (admin)',
    admin_downgrade: 'Downgrade (admin)',
};

export function isBillingPlanUpgrade(from: BillingPlanCode, to: BillingPlanCode): boolean {
    return BILLING_PLAN_RANK[to] > BILLING_PLAN_RANK[from];
}

export function isBillingPlanDowngrade(from: BillingPlanCode, to: BillingPlanCode): boolean {
    return BILLING_PLAN_RANK[to] < BILLING_PLAN_RANK[from];
}

/** Mensagem exibida ao gestor ao tentar reduzir o plano (downgrade só via Admin Master). */
export const BILLING_DOWNGRADE_GESTOR_MESSAGE =
    'Para reduzir o plano comercial, entre em contato com a EventFest e informe sua solicitação. ' +
    'Após a análise, o administrador da plataforma registrará a alteração; quando o novo plano estiver ativo, ' +
    'aceite o contrato correspondente nesta aba, se solicitado.';

export interface CompanyBillingFields {
    billing_plan: BillingPlanCode | null;
    billing_plan_accepted_at: string | null;
    billing_contract_id: string | null;
    billing_plan_locked_until: string | null;
    requires_billing_reacceptance: boolean;
}

/** Empresa pode criar eventos sem passar pelo passo de contrato no formulário. */
export function isCompanyBillingReady(billing: CompanyBillingFields | null | undefined): boolean {
    if (!billing?.billing_plan) return false;
    if (billing.requires_billing_reacceptance) return false;
    if (!billing.billing_plan_accepted_at || !billing.billing_contract_id) return false;
    return true;
}
