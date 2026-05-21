import React, { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
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
import { Loader2, CreditCard, ArrowUpCircle, CheckCircle2, AlertTriangle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { showError, showSuccess, showLoading, dismissToast } from '@/utils/toast';
import { normalizeContractContentForDisplay } from '@/utils/contractContent';
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
import {
    billingBadgeCurrent,
    billingBtnGhost,
    billingBtnOutline,
    billingBtnSolid,
    billingCardCurrent,
    billingCardDefault,
} from '@/constants/billing-ui';
import { startListingMonthlyCheckout } from '@/utils/listing-monthly-checkout';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface CompanyBillingPlanSectionProps {
    companyId: string;
    isAdminMaster?: boolean;
}

const CompanyBillingPlanSection: React.FC<CompanyBillingPlanSectionProps> = ({
    companyId,
    isAdminMaster = false,
}) => {
    const { billing, isLoading, invalidate } = useCompanyBilling(companyId);
    const invalidatePlanFeatures = useInvalidateCompanyPlanFeatures();
    const [dialogOpen, setDialogOpen] = useState(false);
    const [pendingPlan, setPendingPlan] = useState<BillingPlanCode | null>(null);
    const [contractAccepted, setContractAccepted] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [listingPayDialogOpen, setListingPayDialogOpen] = useState(false);
    const [listingPayLoading, setListingPayLoading] = useState(false);

    const pendingDefinition = pendingPlan ? getBillingPlanDefinition(pendingPlan) : undefined;

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

    const processedContent = useMemo(() => {
        if (!pendingContract?.content) return '';
        return normalizeContractContentForDisplay(pendingContract.content);
    }, [pendingContract]);

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

            const { data, error } = await supabase.rpc(rpcName, {
                p_company_id: companyId,
                ...(isUpgrade
                    ? { p_new_plan: pendingPlan, p_contract_id: pendingContract.id }
                    : { p_plan: pendingPlan, p_contract_id: pendingContract.id }),
            });

            if (error) throw error;
            if (data && typeof data === 'object' && 'success' in data && !data.success) {
                throw new Error('Não foi possível salvar o plano.');
            }

            dismissToast(toastId);
            const confirmedPlan = pendingPlan;
            showSuccess(isUpgrade ? 'Plano atualizado com sucesso!' : 'Plano confirmado com sucesso!');
            setDialogOpen(false);
            setPendingPlan(null);
            invalidate();
            invalidatePlanFeatures(companyId);

            if (confirmedPlan === 'listing_monthly' && !isAdminMaster) {
                await supabase.rpc('ensure_listing_monthly_charge', { p_company_id: companyId });
                setListingPayDialogOpen(true);
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
                raw.includes('Downgrade de plano') && !isAdminMaster
                    ? BILLING_DOWNGRADE_GESTOR_MESSAGE
                    : raw || 'Erro ao salvar plano.';
            showError(msg);
        } finally {
            setIsSubmitting(false);
        }
    };

    if (isLoading) {
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
                        Escolha como sua empresa utiliza a plataforma. Upgrade é feito aqui com aceite de contrato.
                        Para reduzir o plano, entre em contato com a EventFest — a alteração é registrada pelo
                        administrador da plataforma.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
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

                    <div className="grid gap-3">
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
                                <div
                                    key={plan.code}
                                    className={`p-4 rounded-xl border ${
                                        isCurrent ? billingCardCurrent : billingCardDefault
                                    }`}
                                >
                                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                                        <div>
                                            <p className="text-white font-medium">{plan.label}</p>
                                            <p className="text-gray-400 text-sm mt-1">{plan.description}</p>
                                            {isDowngradeBlocked && (
                                                <p className="text-amber-200/90 text-xs mt-2 leading-relaxed max-w-xl">
                                                    {BILLING_DOWNGRADE_GESTOR_MESSAGE}
                                                </p>
                                            )}
                                            {!canSelect && (
                                                <span className="inline-block mt-2 text-xs text-gray-500">
                                                    Em breve
                                                </span>
                                            )}
                                        </div>
                                        <div className="flex flex-wrap gap-2">
                                            {isCurrent && (
                                                <span className={billingBadgeCurrent}>Atual</span>
                                            )}
                                            {isCurrent && !billingReady && canSelect && (
                                                <Button
                                                    type="button"
                                                    size="sm"
                                                    className={billingBtnSolid}
                                                    onClick={() => openPlanAction(plan.code)}
                                                >
                                                    Confirmar contrato
                                                </Button>
                                            )}
                                            {canSelect && !isCurrent && !isDowngradeBlocked && (
                                                <Button
                                                    type="button"
                                                    size="sm"
                                                    disabled={!!lockedUpgrade}
                                                    className={
                                                        isUpgrade || billingReady
                                                            ? billingBtnGhost
                                                            : billingBtnOutline
                                                    }
                                                    onClick={() => openPlanAction(plan.code)}
                                                >
                                                    {isUpgrade ? (
                                                        <>
                                                            <ArrowUpCircle className="h-4 w-4 mr-1" />
                                                            Upgrade
                                                        </>
                                                    ) : billingReady ? (
                                                        'Alterar'
                                                    ) : (
                                                        'Confirmar plano'
                                                    )}
                                                </Button>
                                            )}
                                            {isDowngradeBlocked && (
                                                <Button
                                                    type="button"
                                                    size="sm"
                                                    variant="outline"
                                                    className={`${billingBtnGhost} max-w-[11rem] text-left h-auto py-2 whitespace-normal`}
                                                    onClick={() => showError(BILLING_DOWNGRADE_GESTOR_MESSAGE)}
                                                >
                                                    Solicitar redução
                                                </Button>
                                            )}
                                        </div>
                                    </div>
                                </div>
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
                                className="prose prose-invert max-w-none max-h-[320px] overflow-y-auto overscroll-contain p-4 border border-cyan-500/20 rounded-lg text-sm"
                                dangerouslySetInnerHTML={{ __html: processedContent }}
                            />
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
        </>
    );
};

export default CompanyBillingPlanSection;
