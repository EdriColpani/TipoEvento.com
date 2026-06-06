import type { BillingPlanCode } from '@/constants/billing-plans';
import { BILLING_PLANS } from '@/constants/billing-plans';

/** Chaves estáveis — devem coincidir com billing_plan_features.feature_key no banco. */
export const PLAN_FEATURE_KEYS = [
    'dashboard',
    'events',
    'events_create',
    'events_banners',
    'wristbands',
    'validation_keys',
    'reports',
    'reports_financial',
    'reports_sales',
    'reports_events',
    'reports_audience',
    'reports_registrations',
    'reports_wristband_movements',
    'reports_listing_monthly',
    'settings',
] as const;

export type PlanFeatureKey = (typeof PLAN_FEATURE_KEYS)[number];

export type PlanFeaturesMap = Partial<Record<PlanFeatureKey, boolean>>;

export interface PlanFeatureDefinition {
    key: PlanFeatureKey;
    label: string;
    description: string;
    group: 'Geral' | 'Eventos' | 'Ingressos' | 'Relatórios' | 'Sistema';
}

export const PLAN_FEATURE_DEFINITIONS: PlanFeatureDefinition[] = [
    { key: 'dashboard', label: 'Dashboard PRO', description: 'Painel principal', group: 'Geral' },
    { key: 'events', label: 'Eventos', description: 'Lista de eventos', group: 'Eventos' },
    { key: 'events_create', label: 'Criar evento', description: 'Novo evento (vitrine ou ingressos)', group: 'Eventos' },
    { key: 'events_banners', label: 'Banners de evento', description: 'Criar banner promocional', group: 'Eventos' },
    { key: 'wristbands', label: 'Ingressos', description: 'Pulseiras / lotes de ingressos', group: 'Ingressos' },
    { key: 'validation_keys', label: 'Chaves de validação', description: 'Validação na portaria', group: 'Ingressos' },
    { key: 'reports', label: 'Central de relatórios', description: 'Hub de relatórios', group: 'Relatórios' },
    { key: 'reports_financial', label: 'Relatório financeiro', description: 'Comissões e líquido', group: 'Relatórios' },
    { key: 'reports_sales', label: 'Relatório de vendas', description: 'Performance de vendas', group: 'Relatórios' },
    { key: 'reports_events', label: 'Relatório de eventos', description: 'Ocupação e status', group: 'Relatórios' },
    { key: 'reports_audience', label: 'Relatório de público', description: 'Demografia de compradores', group: 'Relatórios' },
    { key: 'reports_registrations', label: 'Relatório de inscrições', description: 'Inscrições gratuitas / vitrine', group: 'Relatórios' },
    {
        key: 'reports_wristband_movements',
        label: 'Movimentação de ingressos',
        description: 'Entradas na portaria',
        group: 'Relatórios',
    },
    {
        key: 'reports_listing_monthly',
        label: 'Mensalidade divulgação',
        description: 'Faturas do plano vitrine',
        group: 'Relatórios',
    },
    { key: 'settings', label: 'Configurações', description: 'Perfil e preferências', group: 'Sistema' },
];

/** Item de menu do gestor vinculado a uma feature. */
export interface ManagerNavItemConfig {
    path: string;
    label: string;
    featureKey: PlanFeatureKey;
}

export const MANAGER_NAV_ITEMS: ManagerNavItemConfig[] = [
    { path: '/manager/dashboard', label: 'Dashboard PRO', featureKey: 'dashboard' },
    { path: '/manager/events', label: 'Eventos', featureKey: 'events' },
    { path: '/manager/events/create', label: 'Criar Novo Evento', featureKey: 'events_create' },
    { path: '/manager/events/banners', label: 'Banners de Evento', featureKey: 'events_banners' },
    { path: '/manager/events/banners/create', label: 'Criar Banner de Evento', featureKey: 'events_banners' },
    { path: '/manager/wristbands', label: 'Ingressos', featureKey: 'wristbands' },
    { path: '/manager/validation-keys', label: 'Chaves de Validação', featureKey: 'validation_keys' },
    { path: '/manager/reports', label: 'Relatórios', featureKey: 'reports' },
    { path: '/manager/settings', label: 'Configurações', featureKey: 'settings' },
];

/** Rotas protegidas (ordem: prefixos mais longos primeiro). */
export const ROUTE_PLAN_FEATURE_RULES: Array<{ pathPrefix: string; featureKey: PlanFeatureKey }> = [
    { pathPrefix: '/manager/reports/financial', featureKey: 'reports_financial' },
    { pathPrefix: '/manager/reports/sales', featureKey: 'reports_sales' },
    { pathPrefix: '/manager/reports/events', featureKey: 'reports_events' },
    { pathPrefix: '/manager/reports/audience', featureKey: 'reports_audience' },
    { pathPrefix: '/manager/reports/registrations', featureKey: 'reports_registrations' },
    { pathPrefix: '/manager/reports/complimentary-bundles', featureKey: 'wristbands' },
    { pathPrefix: '/manager/reports/wristband-movements', featureKey: 'reports_wristband_movements' },
    { pathPrefix: '/manager/reports/listing-monthly', featureKey: 'reports_listing_monthly' },
    { pathPrefix: '/manager/reports', featureKey: 'reports' },
    { pathPrefix: '/manager/wristbands', featureKey: 'wristbands' },
    { pathPrefix: '/manager/validation-keys', featureKey: 'validation_keys' },
    { pathPrefix: '/manager/events/banners', featureKey: 'events_banners' },
    { pathPrefix: '/manager/events/create', featureKey: 'events_create' },
    { pathPrefix: '/manager/events/edit', featureKey: 'events' },
    { pathPrefix: '/manager/events', featureKey: 'events' },
    { pathPrefix: '/manager/dashboard', featureKey: 'dashboard' },
    { pathPrefix: '/manager/settings', featureKey: 'settings' },
];

export function resolveFeatureForPath(pathname: string): PlanFeatureKey | null {
    const rule = ROUTE_PLAN_FEATURE_RULES.find((r) => pathname.startsWith(r.pathPrefix));
    return rule?.featureKey ?? null;
}

export function isPlanFeatureEnabled(
    features: PlanFeaturesMap | null | undefined,
    key: PlanFeatureKey,
    bypass = false,
): boolean {
    if (bypass) return true;
    if (!features || Object.keys(features).length === 0) return false;
    return features[key] === true;
}

/** Admin Master, contrato pendente ou mapa vazio = não filtra menu por feature. */
export function shouldApplyPlanFeatureFilter(
    features: PlanFeaturesMap | null | undefined,
    isAdminMaster: boolean,
    billingReady: boolean,
): boolean {
    if (isAdminMaster || !billingReady) return false;
    return !!features && Object.keys(features).length > 0;
}

export function filterNavItemsByPlanFeatures(
    items: ManagerNavItemConfig[],
    features: PlanFeaturesMap | null | undefined,
    isAdminMaster: boolean,
    billingReady: boolean,
): ManagerNavItemConfig[] {
    if (!shouldApplyPlanFeatureFilter(features, isAdminMaster, billingReady)) return items;
    return items.filter((item) => isPlanFeatureEnabled(features, item.featureKey, false));
}

export function isNavPathLockedByPlan(
    path: string,
    features: PlanFeaturesMap | null | undefined,
    isAdminMaster: boolean,
    billingReady: boolean,
): boolean {
    if (isAdminMaster || !shouldApplyPlanFeatureFilter(features, isAdminMaster, billingReady)) return false;
    const item = MANAGER_NAV_ITEMS.find((n) => n.path === path);
    if (!item) return false;
    return !isPlanFeatureEnabled(features, item.featureKey, false);
}

export function isRouteBlockedByPlan(
    pathname: string,
    features: PlanFeaturesMap | null | undefined,
    isAdminMaster: boolean,
    billingReady: boolean,
): boolean {
    if (isAdminMaster || !shouldApplyPlanFeatureFilter(features, isAdminMaster, billingReady)) return false;
    const featureKey = resolveFeatureForPath(pathname);
    if (!featureKey) return false;
    return !isPlanFeatureEnabled(features, featureKey, false);
}

export const BILLING_PLAN_COLUMNS: Array<{ code: BillingPlanCode; label: string }> = BILLING_PLANS.map(
    (p) => ({ code: p.code, label: p.label }),
);
