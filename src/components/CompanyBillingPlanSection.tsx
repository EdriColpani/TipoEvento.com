import React, { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Loader2, CreditCard, CheckCircle2, AlertTriangle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { showError, showSuccess, showLoading, dismissToast } from '@/utils/toast';
import ContractHtmlBody from '@/components/ContractHtmlBody';
import {
    BILLING_PLANS,
    BillingPlanCode,
    getBillingPlanDefinition,
    BILLING_DOWNGRADE_GESTOR_MESSAGE,
    isBillingPlanDowngrade,
    isBillingPlanUpgrade,
    isCompanyBillingReady,
} from '@/constants/billing-plans';
import { useCompanyBilling } from '@/hooks/use-company-billing';
import { useInvalidateCompanyPlanFeatures } from '@/hooks/use-company-plan-features';
import { useContractScrollEnd } from '@/hooks/use-contract-scroll-end';
import ContractScrollHint from '@/components/ContractScrollHint';
import { fetchBillingPlanContract } from '@/utils/fetchBillingPlanContract';
import { useBillingPlansCatalog } from '@/hooks/use-billing-plans-catalog';
import { useConsumptionLicenseStatus } from '@/hooks/use-consumption-license-status';
import { useTicketInactivityChargeStatus } from '@/hooks/use-ticket-inactivity-charge-status';
import { startTicketInactivityCheckout } from '@/utils/ticket-inactivity-checkout';
import BillingPlanOptionCard from '@/components/BillingPlanOptionCard';
import { redirectToPlanPaymentCheckout } from '@/utils/plan-payment-checkout';
import { companyAllowsTicketSales, isListingMonthlyPlan } from '@/utils/company-billing-rules';
import { startListingMonthlyCheckout } from '@/utils/listing-monthly-checkout';
import { startConsumptionLicenseCheckout } from '@/utils/consumption-license-checkout';
import { callRpcRest } from '@/utils/supabase-rest-rpc';
import { withTimeout } from '@/utils/promise-timeout';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { billingBtnGhost, billingBtnSolid } from '@/constants/billing-ui';

interface CompanyBillingPlanSectionProps {
    companyId: string;
    isAdminMaster?: boolean;
}

const CompanyBillingPlanSection: React.FC<CompanyBillingPlanSectionProps> = ({
    companyId,
    isAdminMaster = false,
}) => {
    const queryClient = useQueryClient();
    const [searchParams] = useSearchParams();
    const urlRecommendedPlan = searchParams.get('plan') as BillingPlanCode | null;
    const { billing, isLoading, invalidate } = useCompanyBilling(companyId);
    const feeOverrides = useMemo(
        () => ({
            listingMonthlyFee: billing?.listing_monthly_fee,
            consumptionLicenseFee: billing?.consumption_license_fee,
        }),
        [billing?.listing_monthly_fee, billing?.consumption_license_fee],
    );
    const { displays, settings: pricingSettings, isLoading: isLoadingCatalog } = useBillingPlansCatalog(feeOverrides);
    const invalidatePlanFeatures = useInvalidateCompanyPlanFeatures();
    const [dialogOpen, setDialogOpen] = useState(false);
    const [pendingPlan, setPendingPlan] = useState<BillingPlanCode | null>(null);
    const [contractAccepted, setContractAccepted] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [listingPayDialogOpen, setListingPayDialogOpen] = useState(false);
    const [listingPayLoading, setListingPayLoading] = useState(false);
    const [licensePayDialogOpen, setLicensePayDialogOpen] = useState(false);
    const [licensePayLoading, setLicensePayLoading] = useState(false);
    const [pendingLicenseChargeId, setPendingLicenseChargeId] = useState<string | null>(null);
    const [inactivityPayDialogOpen, setInactivityPayDialogOpen] = useState(false);
    const [inactivityPayLoading, setInactivityPayLoading] = useState(false);

    const { data: companyKind } = useQuery({
        queryKey: ['companyKind', companyId],
        queryFn: async () => {
            const { data, error } = await supabase
                .from('companies')
                .select('company_kind')
                .eq('id', companyId)
                .maybeSingle();
            if (error) throw error;
            return (data?.company_kind as string | null) ?? 'organizer';
        },
        enabled: Boolean(companyId),
        staleTime: 60_000,
    });

    const recommendedPlan = useMemo(() => {
        if (urlRecommendedPlan) return urlRecommendedPlan;
        if (companyKind === 'partner') return 'consumption_or_license' as BillingPlanCode;
        return null;
    }, [urlRecommendedPlan, companyKind]);

    const pendingDefinition = pendingPlan ? getBillingPlanDefinition(pendingPlan) : undefined;

    const { data: licenseStatus, refetch: refetchLicenseStatus } = useConsumptionLicenseStatus(
        companyId,
        billing?.billing_plan,
    );
    const { data: inactivityChargeStatus, refetch: refetchInactivityCharge } =
        useTicketInactivityChargeStatus(companyId, billing?.billing_plan);

    const {
        data: pendingContract,
        isLoading: isLoadingContract,
        isError: isContractError,
        error: contractError,
    } = useQuery({
        queryKey: ['billingPlanContract', pendingPlan],
        queryFn: () => fetchBillingPlanContract(pendingPlan!),
        enabled: !!pendingPlan && dialogOpen,
        refetchOnMount: 'always',
        retry: 1,
    });

    const contractScrollKey = pendingContract
        ? `${pendingContract.id}-${pendingContract.version}`
        : null;
    const { scrollRef, hasScrolledToEnd, onScroll } = useContractScrollEnd(contractScrollKey);

    useEffect(() => {
        if (dialogOpen) {
            setContractAccepted(false);
        }
    }, [dialogOpen, pendingPlan, contractScrollKey]);

    const currentPlan = billing?.billing_plan ?? null;
    const billingReady = isCompanyBillingReady(billing);

    const openPlanAction = (plan: BillingPlanCode) => {
        const def = getBillingPlanDefinition(plan);
        if (!def?.selectableByGestor && !isAdminMaster) {
            showError('Este plano ainda não está disponível.');
            return;
        }
        if (currentPlan && !isAdminMaster && isBillingPlanDowngrade(currentPlan, plan)) {
            showError(BILLING_DOWNGRADE_GESTOR_MESSAGE);
            return;
        }
        setPendingPlan(plan);
        setContractAccepted(false);
        setDialogOpen(true);
    };

    const handleConfirm = async () => {
        if (!pendingPlan || !pendingContract) {
            showError('Contrato do plano não encontrado. Contate o administrador.');
            return;
        }
        if (!contractAccepted) {
            showError('Aceite o contrato para continuar.');
            return;
        }

        setIsSubmitting(true);
        const toastId = showLoading('Salvando plano...');

        try {
            const isUpgrade =
                currentPlan &&
                pendingPlan !== currentPlan &&
                isBillingPlanUpgrade(currentPlan, pendingPlan);

            const rpcName = isUpgrade
                ? 'request_company_billing_plan_upgrade'
                : 'confirm_company_billing_plan';

            const rpcArgs = {
                p_company_id: companyId,
                p_user_agent:
                    typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 2000) : null,
                p_scrolled_to_end: hasScrolledToEnd,
                ...(isUpgrade
                    ? { p_new_plan: pendingPlan, p_contract_id: pendingContract.id }
                    : { p_plan: pendingPlan, p_contract_id: pendingContract.id }),
            };

            let data: unknown = null;
            try {
                data = await callRpcRest(rpcName, rpcArgs, 20_000);
            } catch (restError) {
                console.warn('[CompanyBillingPlanSection] REST RPC falhou:', restError);
                const { data: fallbackData, error } = await withTimeout(
                    supabase.rpc(rpcName, rpcArgs),
                    20_000,
                    { data: null, error: { message: 'timeout' } as { message: string } },
                );
                if (error?.message && error.message !== 'timeout') throw error;
                data = fallbackData;
            }
            if (data && typeof data === 'object' && 'success' in data && !data.success) {
                throw new Error('Não foi possível salvar o plano.');
            }

            const rpcPayload = data as {
                consumption_license?: unknown;
            } | null;

            dismissToast(toastId);
            const confirmedPlan = pendingPlan;
            showSuccess(isUpgrade ? 'Plano atualizado com sucesso!' : 'Plano confirmado com sucesso!');
            setDialogOpen(false);
            setPendingPlan(null);
            await invalidate();
            invalidatePlanFeatures(companyId);

            if (!isListingMonthlyPlan(confirmedPlan)) {
                queryClient.removeQueries({ queryKey: ['listingSubscription', companyId] });
            }
            if (isListingMonthlyPlan(confirmedPlan)) {
                queryClient.removeQueries({ queryKey: ['consumptionLicenseStatus', companyId] });
            }

            const needsPaymentCheckout =
                !isAdminMaster &&
                (confirmedPlan === 'listing_monthly' || confirmedPlan === 'consumption_or_license');

            if (needsPaymentCheckout) {
                const checkoutToastId = showLoading('Abrindo pagamento no Mercado Pago...');
                try {
                    const result = await redirectToPlanPaymentCheckout(companyId, confirmedPlan, {
                        consumptionLicenseFromRpc: rpcPayload?.consumption_license,
                        chargeId:
                            confirmedPlan === 'consumption_or_license'
                                ? licenseStatus?.charge_id
                                : undefined,
                    });
                    dismissToast(checkoutToastId);
                    if (result === 'already_paid') {
                        showSuccess('Pagamento deste mês já consta como quitado.');
                    }
                    return;
                } catch (checkoutErr: unknown) {
                    dismissToast(checkoutToastId);
                    const checkoutMsg =
                        checkoutErr instanceof Error
                            ? checkoutErr.message
                            : 'Não foi possível abrir o checkout. Tente pelo botão de pagamento abaixo.';
                    showError(checkoutMsg);

                    if (confirmedPlan === 'listing_monthly') {
                        setListingPayDialogOpen(true);
                    }
                    if (confirmedPlan === 'consumption_or_license') {
                        const lic = rpcPayload?.consumption_license as {
                            charge_id?: string;
                        } | null;
                        if (lic?.charge_id) setPendingLicenseChargeId(lic.charge_id);
                        await refetchLicenseStatus();
                        setLicensePayDialogOpen(true);
                    }
                }
            }
        } catch (e: unknown) {
            dismissToast(toastId);
            const raw =
                e && typeof e === 'object' && 'message' in e && typeof e.message === 'string'
                    ? e.message
                    : e instanceof Error
                      ? e.message
                      : '';
            const msg =
                raw.includes('Este plano ainda não está disponível')
                    ? 'Este plano ainda não está disponível para gestores. Peça ao Admin Master para aplicar as migrations de plano consumo no Supabase, ou confirme o plano pelo painel admin.'
                    : raw.includes('Downgrade de plano') && !isAdminMaster
                      ? BILLING_DOWNGRADE_GESTOR_MESSAGE
                      : raw || 'Erro ao salvar plano.';
            showError(msg);
        } finally {
            setIsSubmitting(false);
        }
    };

    if (isLoading || isLoadingCatalog) {
        return (
            <Card className="bg-black border border-cyan-500/30 rounded-2xl p-8 text-center">
                <Loader2 className="h-8 w-8 animate-spin text-cyan-400 mx-auto" />
                <p className="text-gray-400 mt-4 text-sm">Carregando plano comercial...</p>
            </Card>
        );
    }

    return (
        <>
            <Card className="bg-black border border-cyan-500/30 rounded-2xl shadow-2xl shadow-cyan-500/10">
                <CardHeader>
                    <CardTitle className="text-cyan-400 text-xl flex items-center gap-2">
                        <CreditCard className="h-6 w-6" />
                        Plano e cobrança
                    </CardTitle>
                    <CardDescription className="text-gray-400">
                        Valores e percentuais exibidos abaixo vêm do cadastro oficial da EventFest em{' '}
                        <strong className="text-gray-300">Preços e comissões</strong> (mesmas regras do
                        administrador). Compare planos e escolha o ideal; upgrade exige aceite de contrato.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    {pricingSettings?.updated_at && (
                        <p className="text-xs text-gray-500">
                            Tabela de preços atualizada em{' '}
                            {format(new Date(pricingSettings.updated_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}.
                        </p>
                    )}
                    {!billingReady && (
                        <div className="flex gap-3 p-4 rounded-xl border border-amber-500/40 bg-amber-500/10 text-amber-200 text-sm">
                            <AlertTriangle className="h-5 w-5 shrink-0" />
                            <div>
                                <p className="font-medium">Confirmação necessária</p>
                                <p className="mt-1 text-amber-200/90">
                                    Confirme o plano e aceite o contrato para criar eventos. Empresas já cadastradas
                                    foram migradas para comissão sobre ingressos — basta confirmar abaixo.
                                </p>
                            </div>
                        </div>
                    )}

                    {billingReady && currentPlan && (
                        <div className="flex items-start gap-2 p-3 rounded-lg border border-green-500/30 bg-green-500/10 text-sm text-green-300">
                            <CheckCircle2 className="h-5 w-5 shrink-0" />
                            <div>
                                <p>
                                    Plano ativo:{' '}
                                    <strong>{getBillingPlanDefinition(currentPlan)?.label ?? currentPlan}</strong>
                                </p>
                                {billing?.billing_plan_accepted_at && (
                                    <p className="text-green-300/80 text-xs mt-1">
                                        Aceito em{' '}
                                        {format(new Date(billing.billing_plan_accepted_at), "dd/MM/yyyy 'às' HH:mm", {
                                            locale: ptBR,
                                        })}
                                    </p>
                                )}
                                {companyAllowsTicketSales(currentPlan) && (
                                    <p className="text-green-300/80 text-xs mt-2">
                                        Mínimo de ingressos por evento pago:{' '}
                                        <strong>{billing?.min_event_tickets ?? 10}</strong>
                                        {billing?.min_event_tickets_customized
                                            ? ' (valor definido para sua empresa)'
                                            : ' (padrão da plataforma)'}
                                    </p>
                                )}
                                {billing?.ticket_inactivity_blocked && (
                                    <p className="text-orange-300 text-xs mt-2">
                                        Pendência de inatividade comercial — criação e reativação de eventos
                                        bloqueadas até regularizar na lista de eventos.
                                    </p>
                                )}
                            </div>
                        </div>
                    )}

                    {billing?.billing_plan_locked_until &&
                        new Date(billing.billing_plan_locked_until) > new Date() && (
                            <p className="text-xs text-gray-500">
                                Próximo upgrade disponível após{' '}
                                {format(new Date(billing.billing_plan_locked_until), 'dd/MM/yyyy', { locale: ptBR })}.
                            </p>
                        )}

                    {companyAllowsTicketSales(currentPlan) && inactivityChargeStatus?.has_pending_charge && (
                        <div className="flex gap-3 p-4 rounded-xl border border-orange-500/40 bg-orange-500/10 text-orange-200 text-sm">
                            <AlertTriangle className="h-5 w-5 shrink-0" />
                            <div className="flex-1">
                                <p className="font-medium">Taxa de inatividade comercial pendente</p>
                                <p className="mt-1 text-orange-200/90">
                                    Inatividade em dois meses consecutivos — pague a taxa fixa da plataforma
                                    {inactivityChargeStatus.amount
                                        ? ` (R$ ${Number(inactivityChargeStatus.amount).toFixed(2).replace('.', ',')})`
                                        : ''}
                                    .
                                </p>
                                <Button
                                    type="button"
                                    size="sm"
                                    className={`${billingBtnSolid} mt-3`}
                                    onClick={() => setInactivityPayDialogOpen(true)}
                                >
                                    Pagar taxa de inatividade
                                </Button>
                            </div>
                        </div>
                    )}

                    {currentPlan === 'consumption_or_license' && licenseStatus?.blocks_consumption && (
                        <div className="flex gap-3 p-4 rounded-xl border border-amber-500/40 bg-amber-500/10 text-amber-200 text-sm">
                            <AlertTriangle className="h-5 w-5 shrink-0" />
                            <div className="flex-1">
                                <p className="font-medium">Licença mensal pendente</p>
                                <p className="mt-1 text-amber-200/90">
                                    O consumo com créditos EventFest (PDV, cardápio) só será liberado após pagar a
                                    licença de uso do sistema
                                    {licenseStatus.amount
                                        ? ` (R$ ${Number(licenseStatus.amount).toFixed(2).replace('.', ',')})`
                                        : ''}
                                    .
                                </p>
                                <Button
                                    type="button"
                                    size="sm"
                                    className={`${billingBtnSolid} mt-3`}
                                    onClick={() => setLicensePayDialogOpen(true)}
                                >
                                    Pagar licença agora
                                </Button>
                            </div>
                        </div>
                    )}

                    <div className="grid gap-4 md:grid-cols-2">
                        {BILLING_PLANS.map((plan) => {
                            const isCurrent = currentPlan === plan.code;
                            const canSelect = plan.selectableByGestor || isAdminMaster;
                            const isUpgrade =
                                currentPlan && isBillingPlanUpgrade(currentPlan, plan.code);
                            const isDowngradeBlocked =
                                !!currentPlan &&
                                !isAdminMaster &&
                                isBillingPlanDowngrade(currentPlan, plan.code);
                            const lockedUpgrade =
                                isUpgrade &&
                                billing?.billing_plan_locked_until &&
                                new Date(billing.billing_plan_locked_until) > new Date();

                            return (
                                <BillingPlanOptionCard
                                    key={plan.code}
                                    plan={plan}
                                    display={displays[plan.code]}
                                    isCurrent={isCurrent}
                                    billingReady={billingReady}
                                    canSelect={canSelect}
                                    isUpgrade={!!isUpgrade}
                                    isDowngradeBlocked={isDowngradeBlocked}
                                    lockedUpgrade={!!lockedUpgrade}
                                    isRecommended={recommendedPlan === plan.code}
                                    onAction={() => openPlanAction(plan.code)}
                                />
                            );
                        })}
                    </div>
                </CardContent>
            </Card>

            <Dialog
                open={dialogOpen}
                onOpenChange={(open) => {
                    setDialogOpen(open);
                    if (!open) {
                        setPendingPlan(null);
                        setContractAccepted(false);
                    }
                }}
            >
                <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto bg-black border-cyan-500/30 text-white">
                    <DialogHeader>
                        <DialogTitle className="text-cyan-400">
                            {pendingDefinition?.label ?? 'Contrato do plano'}
                        </DialogTitle>
                        <DialogDescription className="text-gray-400">
                            Leia e aceite o contrato vinculado a este plano.
                        </DialogDescription>
                    </DialogHeader>

                    {isLoadingContract ? (
                        <div className="py-8 text-center">
                            <Loader2 className="h-8 w-8 animate-spin text-cyan-400 mx-auto" />
                        </div>
                    ) : isContractError ? (
                        <p className="text-red-400 text-sm">
                            Erro ao carregar o contrato:{' '}
                            {contractError instanceof Error ? contractError.message : 'tente novamente.'}
                        </p>
                    ) : pendingContract ? (
                        <>
                            <p className="text-sm text-gray-400">
                                {pendingContract.title} (v{pendingContract.version})
                            </p>
                            <div
                                ref={scrollRef}
                                onScroll={onScroll}
                                className="max-h-[320px] overflow-y-auto overscroll-contain p-4 border border-cyan-500/20 rounded-lg"
                            >
                                <ContractHtmlBody content={pendingContract.content} variant="billing" />
                            </div>
                            <ContractScrollHint visible={!hasScrolledToEnd} />
                            <label
                                className={`flex items-start gap-3 ${hasScrolledToEnd ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}`}
                            >
                                <Checkbox
                                    checked={contractAccepted}
                                    disabled={!hasScrolledToEnd}
                                    onCheckedChange={(v) => {
                                        if (hasScrolledToEnd) setContractAccepted(v === true);
                                    }}
                                    className="mt-1 border-cyan-500/50 data-[state=checked]:bg-cyan-400 data-[state=checked]:text-black"
                                />
                                <span className="text-sm text-gray-300">
                                    Li e aceito os termos deste contrato e do plano selecionado.
                                </span>
                            </label>
                        </>
                    ) : (
                        <p className="text-red-400 text-sm">
                            Nenhum contrato cadastrado para este plano. Peça ao administrador para publicar o
                            contrato em Admin → Contratos.
                        </p>
                    )}

                    <DialogFooter className="gap-2 sm:gap-0">
                        <Button
                            type="button"
                            variant="outline"
                            className={billingBtnGhost}
                            onClick={() => setDialogOpen(false)}
                            disabled={isSubmitting}
                        >
                            Cancelar
                        </Button>
                        <Button
                            type="button"
                            className={billingBtnSolid}
                            disabled={isSubmitting || !pendingContract || !contractAccepted}
                            onClick={handleConfirm}
                        >
                            {isSubmitting ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                                'Confirmar e salvar'
                            )}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={listingPayDialogOpen} onOpenChange={setListingPayDialogOpen}>
                <DialogContent className="max-w-md bg-black border-cyan-500/30 text-white">
                    <DialogHeader>
                        <DialogTitle className="text-cyan-400">Mensalidade do plano vitrine</DialogTitle>
                        <DialogDescription className="text-gray-400">
                            Gere a cobrança do mês atual e pague pelo Mercado Pago, ou pague depois em
                            Relatórios → Mensalidade de divulgação.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter className="gap-2 flex-col sm:flex-row">
                        <Button
                            type="button"
                            variant="outline"
                            className={billingBtnGhost}
                            onClick={() => setListingPayDialogOpen(false)}
                        >
                            Pagar depois
                        </Button>
                        <Button
                            type="button"
                            className={billingBtnSolid}
                            disabled={listingPayLoading}
                            onClick={async () => {
                                setListingPayLoading(true);
                                const toastId = showLoading('Abrindo checkout...');
                                try {
                                    const { checkoutUrl } = await startListingMonthlyCheckout(companyId);
                                    dismissToast(toastId);
                                    setListingPayDialogOpen(false);
                                    window.location.href = checkoutUrl;
                                } catch (e: unknown) {
                                    dismissToast(toastId);
                                    showError(
                                        e instanceof Error ? e.message : 'Erro ao iniciar pagamento.',
                                    );
                                } finally {
                                    setListingPayLoading(false);
                                }
                            }}
                        >
                            {listingPayLoading ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                                'Pagar mensalidade agora'
                            )}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={licensePayDialogOpen} onOpenChange={setLicensePayDialogOpen}>
                <DialogContent className="max-w-md bg-black border-cyan-500/30 text-white">
                    <DialogHeader>
                        <DialogTitle className="text-cyan-400">Licença — consumo / créditos</DialogTitle>
                        <DialogDescription className="text-gray-400">
                            Pague a licença mensal (valor integral) para liberar consumo com créditos EventFest neste
                            plano.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter className="gap-2 flex-col sm:flex-row">
                        <Button
                            type="button"
                            variant="outline"
                            className={billingBtnGhost}
                            onClick={() => setLicensePayDialogOpen(false)}
                        >
                            Pagar depois
                        </Button>
                        <Button
                            type="button"
                            className={billingBtnSolid}
                            disabled={licensePayLoading}
                            onClick={async () => {
                                setLicensePayLoading(true);
                                const toastId = showLoading('Abrindo checkout...');
                                try {
                                    const { checkoutUrl } = await startConsumptionLicenseCheckout(
                                        companyId,
                                        pendingLicenseChargeId ?? licenseStatus?.charge_id ?? undefined,
                                    );
                                    dismissToast(toastId);
                                    setLicensePayDialogOpen(false);
                                    window.location.href = checkoutUrl;
                                } catch (e: unknown) {
                                    dismissToast(toastId);
                                    showError(
                                        e instanceof Error ? e.message : 'Erro ao iniciar pagamento.',
                                    );
                                } finally {
                                    setLicensePayLoading(false);
                                }
                            }}
                        >
                            {licensePayLoading ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                                'Pagar licença agora'
                            )}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={inactivityPayDialogOpen} onOpenChange={setInactivityPayDialogOpen}>
                <DialogContent className="max-w-md bg-black border-orange-500/30 text-white">
                    <DialogHeader>
                        <DialogTitle className="text-orange-400">Taxa de inatividade comercial</DialogTitle>
                        <DialogDescription className="text-gray-400">
                            Cobrança gerada após dois meses consecutivos sem venda de ingressos em eventos realizados.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter className="gap-2 flex-col sm:flex-row">
                        <Button
                            type="button"
                            variant="outline"
                            className={billingBtnGhost}
                            onClick={() => setInactivityPayDialogOpen(false)}
                        >
                            Pagar depois
                        </Button>
                        <Button
                            type="button"
                            className={billingBtnSolid}
                            disabled={inactivityPayLoading}
                            onClick={async () => {
                                setInactivityPayLoading(true);
                                const toastId = showLoading('Abrindo checkout...');
                                try {
                                    const { checkoutUrl } = await startTicketInactivityCheckout(
                                        companyId,
                                        inactivityChargeStatus?.charge_id,
                                    );
                                    dismissToast(toastId);
                                    setInactivityPayDialogOpen(false);
                                    void refetchInactivityCharge();
                                    window.location.href = checkoutUrl;
                                } catch (e: unknown) {
                                    dismissToast(toastId);
                                    showError(
                                        e instanceof Error ? e.message : 'Erro ao iniciar pagamento.',
                                    );
                                } finally {
                                    setInactivityPayLoading(false);
                                }
                            }}
                        >
                            {inactivityPayLoading ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                                'Pagar agora'
                            )}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
};

export default CompanyBillingPlanSection;
