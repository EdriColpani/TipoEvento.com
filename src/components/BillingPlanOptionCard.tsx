import React from 'react';
import { Button } from '@/components/ui/button';
import { ArrowUpCircle, Check, X } from 'lucide-react';
import type { BillingPlanDefinition } from '@/constants/billing-plans';
import { BILLING_DOWNGRADE_GESTOR_MESSAGE } from '@/constants/billing-plans';
import type { BillingPlanDisplayInfo } from '@/utils/billing-plan-catalog';
import BillingPlanCommissionTiersTable from '@/components/BillingPlanCommissionTiersTable';
import {
    billingBadgeCurrent,
    billingBtnGhost,
    billingBtnOutline,
    billingBtnSolid,
    billingCardCurrent,
    billingCardDefault,
} from '@/constants/billing-ui';
import { showError } from '@/utils/toast';

interface BillingPlanOptionCardProps {
    plan: BillingPlanDefinition;
    display: BillingPlanDisplayInfo | undefined;
    isCurrent: boolean;
    billingReady: boolean;
    canSelect: boolean;
    isUpgrade: boolean;
    isDowngradeBlocked: boolean;
    lockedUpgrade: boolean;
    onAction: () => void;
}

const BillingPlanOptionCard: React.FC<BillingPlanOptionCardProps> = ({
    plan,
    display,
    isCurrent,
    billingReady,
    canSelect,
    isUpgrade,
    isDowngradeBlocked,
    lockedUpgrade,
    onAction,
}) => {
    const showConfirmCurrent = isCurrent && !billingReady && canSelect;
    const showChange = canSelect && !isCurrent && !isDowngradeBlocked;

    return (
        <article
            className={`flex flex-col h-full rounded-2xl border p-5 gap-4 ${
                isCurrent ? billingCardCurrent : billingCardDefault
            }`}
        >
            <header className="space-y-2">
                <div className="flex flex-wrap items-start justify-between gap-2">
                    <h3 className="text-white font-semibold text-lg leading-snug">{plan.label}</h3>
                    {isCurrent && <span className={billingBadgeCurrent}>Plano atual</span>}
                </div>
                <p className="text-cyan-300/90 text-sm font-medium">{plan.tagline}</p>
            </header>

            <div className="rounded-xl border border-cyan-500/25 bg-cyan-500/5 px-4 py-3 space-y-1">
                {display?.usesCompanyOverride && (
                    <span className="inline-block text-[11px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30 mb-1">
                        Valor personalizado para sua empresa
                    </span>
                )}
                <p className="text-white text-xl font-bold tracking-tight">
                    {display?.priceLabel ?? 'Carregando valores...'}
                </p>
                <p className="text-gray-400 text-xs leading-relaxed">
                    {display?.priceDetail ?? plan.description}
                </p>
                {display?.adminPricingTab && (
                    <p className="text-[11px] text-cyan-500/70 leading-relaxed">
                        Fonte: Preços e comissões → {display.adminPricingTab}
                    </p>
                )}
            </div>

            {display?.commissionTiers?.length ? (
                <section className="space-y-2">
                    <p className="text-xs uppercase tracking-wide text-gray-500 font-medium">
                        Faixas de comissão sobre ingressos
                    </p>
                    <BillingPlanCommissionTiersTable tiers={display.commissionTiers} />
                </section>
            ) : null}

            <section className="space-y-2">
                <p className="text-xs uppercase tracking-wide text-gray-500 font-medium">Ideal para</p>
                <p className="text-gray-300 text-sm leading-relaxed">{plan.idealFor}</p>
            </section>

            {display?.pricingBullets?.length ? (
                <section className="space-y-2">
                    <p className="text-xs uppercase tracking-wide text-gray-500 font-medium">Como cobra</p>
                    <ul className="space-y-1.5">
                        {display.pricingBullets.map((item) => (
                            <li key={item} className="flex gap-2 text-sm text-gray-300 leading-relaxed">
                                <Check className="h-4 w-4 shrink-0 text-cyan-400 mt-0.5" />
                                <span>{item}</span>
                            </li>
                        ))}
                    </ul>
                </section>
            ) : null}

            <section className="space-y-2">
                <p className="text-xs uppercase tracking-wide text-gray-500 font-medium">Principais recursos</p>
                <ul className="space-y-1.5">
                    {plan.highlights.map((item) => (
                        <li key={item} className="flex gap-2 text-sm text-gray-300 leading-relaxed">
                            <Check className="h-4 w-4 shrink-0 text-emerald-400/90 mt-0.5" />
                            <span>{item}</span>
                        </li>
                    ))}
                </ul>
            </section>

            {display?.enabledFeatures?.length ? (
                <section className="space-y-2">
                    <p className="text-xs uppercase tracking-wide text-gray-500 font-medium">Menu do painel</p>
                    <div className="flex flex-wrap gap-1.5">
                        {display.enabledFeatures.map((f) => (
                            <span
                                key={f.label}
                                title={f.description}
                                className="text-xs px-2 py-1 rounded-md bg-white/5 text-gray-300 ring-1 ring-cyan-500/20"
                            >
                                {f.label}
                            </span>
                        ))}
                    </div>
                </section>
            ) : null}

            {plan.limitations.length > 0 && (
                <section className="space-y-2">
                    <p className="text-xs uppercase tracking-wide text-gray-500 font-medium">Limitações</p>
                    <ul className="space-y-1.5">
                        {plan.limitations.map((item) => (
                            <li key={item} className="flex gap-2 text-sm text-gray-400 leading-relaxed">
                                <X className="h-4 w-4 shrink-0 text-amber-500/80 mt-0.5" />
                                <span>{item}</span>
                            </li>
                        ))}
                    </ul>
                </section>
            )}

            <div className="mt-auto pt-2 flex flex-wrap gap-2">
                {showConfirmCurrent && (
                    <Button type="button" size="sm" className={billingBtnSolid} onClick={onAction}>
                        Confirmar contrato
                    </Button>
                )}
                {showChange && (
                    <Button
                        type="button"
                        size="sm"
                        disabled={!!lockedUpgrade}
                        className={isUpgrade || billingReady ? billingBtnGhost : billingBtnOutline}
                        onClick={onAction}
                    >
                        {isUpgrade ? (
                            <>
                                <ArrowUpCircle className="h-4 w-4 mr-1" />
                                Fazer upgrade
                            </>
                        ) : billingReady ? (
                            'Alterar plano'
                        ) : (
                            'Escolher este plano'
                        )}
                    </Button>
                )}
                {isDowngradeBlocked && (
                    <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className={`${billingBtnGhost} max-w-full text-left h-auto py-2 whitespace-normal`}
                        onClick={() => showError(BILLING_DOWNGRADE_GESTOR_MESSAGE)}
                    >
                        Solicitar redução de plano
                    </Button>
                )}
                {!canSelect && (
                    <span className="text-xs text-gray-500 self-center">Disponível em breve</span>
                )}
                {lockedUpgrade && (
                    <span className="text-xs text-gray-500 self-center">Upgrade temporariamente bloqueado</span>
                )}
            </div>
        </article>
    );
};

export default BillingPlanOptionCard;
