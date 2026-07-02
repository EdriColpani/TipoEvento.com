import React, { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2, History } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { showError, showSuccess, showLoading, dismissToast } from '@/utils/toast';
import { adminBtnOutline, billingBtnSolid } from '@/constants/billing-ui';
import {
    BILLING_PLANS,
    BILLING_CHANGE_TYPE_LABELS,
    BillingPlanCode,
    getBillingPlanDefinition,
    getBillingPlanLabel,
    isCompanyBillingReady,
} from '@/constants/billing-plans';
import { getContractTypesForBillingPlan } from '@/constants/event-contracts';
import {
    AdminCompanyBillingRow,
    useCompanyBillingHistory,
} from '@/hooks/use-admin-companies-billing';
import { useSystemBillingSettings, saveCompanyMinEventTickets } from '@/hooks/use-system-billing-settings';
import { adminClearCompanyTicketInactivity } from '@/hooks/use-company-ticket-inactivity';
import { DEFAULT_LISTING_MONTHLY_FEE } from '@/utils/company-billing-rules';
import {
    formatCurrencyBrInput,
    isValidCurrencyBr,
    parseCurrencyBr,
    sanitizeCurrencyBrInput,
} from '@/utils/currency-input';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface EventContractRow {
    id: string;
    version: string;
    title: string;
    contract_type: string;
    is_active: boolean;
}

async function fetchContractsByType(contractType: string): Promise<EventContractRow[]> {
    const { data, error } = await supabase
        .from('event_contracts')
        .select('id, version, title, contract_type, is_active')
        .eq('contract_type', contractType)
        .order('updated_at', { ascending: false });

    if (error) throw new Error(error.message);
    return (data ?? []) as EventContractRow[];
}

async function fetchContractsForPlan(plan: BillingPlanCode): Promise<EventContractRow[]> {
    const types = getContractTypesForBillingPlan(plan);
    const batches = await Promise.all(types.map((t) => fetchContractsByType(t)));
    const merged = batches.flat();
    const seen = new Set<string>();
    return merged.filter((c) => {
        if (seen.has(c.id)) return false;
        seen.add(c.id);
        return true;
    });
}

interface AdminCompanyBillingEditDialogProps {
    company: AdminCompanyBillingRow | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSaved: () => void;
}

const KEEP_CONTRACT_VALUE = '__keep_contract__';

const AdminCompanyBillingEditDialog: React.FC<AdminCompanyBillingEditDialogProps> = ({
    company,
    open,
    onOpenChange,
    onSaved,
}) => {
    const [selectedPlan, setSelectedPlan] = useState<BillingPlanCode>('ticket_commission');
    const [contractId, setContractId] = useState<string>(KEEP_CONTRACT_VALUE);
    const [requireReacceptance, setRequireReacceptance] = useState(false);
    const [listingMonthlyFee, setListingMonthlyFee] = useState('');
    const [consumptionLicenseFee, setConsumptionLicenseFee] = useState('');
    const [minEventTickets, setMinEventTickets] = useState('10');
    const [isSaving, setIsSaving] = useState(false);

    const planDef = getBillingPlanDefinition(selectedPlan);
    const { data: contracts = [], isLoading: loadingContracts } = useQuery({
        queryKey: ['adminContractsForPlan', selectedPlan],
        queryFn: () => fetchContractsForPlan(selectedPlan),
        enabled: open && !!planDef,
    });

    const { data: history = [], isLoading: loadingHistory } = useCompanyBillingHistory(
        company?.id ?? null,
        open,
    );
    const { listingMonthlyDefaultFee, consumptionLicenseDefaultFee, settings: billingSettings } =
        useSystemBillingSettings(open);

    useEffect(() => {
        if (!company || !open) return;
        setSelectedPlan(company.billing_plan ?? 'ticket_commission');
        setContractId(company.billing_contract_id ?? KEEP_CONTRACT_VALUE);
        setRequireReacceptance(company.requires_billing_reacceptance);
        setListingMonthlyFee(
            formatCurrencyBrInput(
                company.listing_monthly_fee ??
                    listingMonthlyDefaultFee ??
                    DEFAULT_LISTING_MONTHLY_FEE,
            ),
        );
        setConsumptionLicenseFee(
            formatCurrencyBrInput(
                company.consumption_license_fee ?? consumptionLicenseDefaultFee ?? 99.99,
            ),
        );
        setMinEventTickets(String(company.min_event_tickets ?? 10));
    }, [company, open, listingMonthlyDefaultFee, consumptionLicenseDefaultFee]);

    useEffect(() => {
        if (!open || contracts.length === 0) return;
        const stillValid = contracts.some((c) => c.id === contractId);
        if (!stillValid && contractId !== KEEP_CONTRACT_VALUE) {
            const preferred = contracts.find((c) => c.is_active) ?? contracts[0];
            setContractId(preferred?.id ?? KEEP_CONTRACT_VALUE);
        }
    }, [contracts, contractId, open]);

    const companyDisplayName = useMemo(() => {
        if (!company) return '';
        return company.trade_name || company.corporate_name || company.cnpj || company.id;
    }, [company]);

    const handleSave = async () => {
        if (!company) return;

        setIsSaving(true);
        const toastId = showLoading('Salvando plano da empresa...');

        try {
            const planChanged = company.billing_plan !== selectedPlan;
            const contractProvided =
                contractId !== KEEP_CONTRACT_VALUE && contractId.trim() !== '';

            if (planChanged || contractProvided) {
                const { error: rpcError } = await supabase.rpc('admin_set_company_billing_plan', {
                    p_company_id: company.id,
                    p_plan: selectedPlan,
                    p_contract_id: contractProvided ? contractId : null,
                });
                if (rpcError) throw rpcError;
            }

            const shouldRequireReaccept =
                requireReacceptance ||
                (planChanged && !contractProvided);

            const feeValue =
                selectedPlan === 'listing_monthly' ? parseCurrencyBr(listingMonthlyFee) : null;
            if (selectedPlan === 'listing_monthly' && !isValidCurrencyBr(listingMonthlyFee)) {
                throw new Error('Informe uma mensalidade válida (ex.: 299,99).');
            }

            const licenseFeeValue =
                selectedPlan === 'consumption_or_license'
                    ? parseCurrencyBr(consumptionLicenseFee)
                    : null;
            if (
                selectedPlan === 'consumption_or_license' &&
                !isValidCurrencyBr(consumptionLicenseFee)
            ) {
                throw new Error('Informe uma licença mensal válida (ex.: 99,99).');
            }

            const companyPatch: Record<string, unknown> = {
                requires_billing_reacceptance: shouldRequireReaccept,
            };
            if (selectedPlan === 'listing_monthly') {
                companyPatch.listing_monthly_fee = feeValue;
            }
            if (selectedPlan === 'consumption_or_license') {
                companyPatch.consumption_license_fee = licenseFeeValue;
            }

            if (
                shouldRequireReaccept !== company.requires_billing_reacceptance ||
                planChanged ||
                selectedPlan === 'listing_monthly' ||
                selectedPlan === 'consumption_or_license'
            ) {
                const { error: flagError } = await supabase
                    .from('companies')
                    .update(companyPatch)
                    .eq('id', company.id);
                if (flagError) throw flagError;
            }

            const minParsed = Number.parseInt(minEventTickets, 10);
            if (!Number.isFinite(minParsed) || minParsed < 1 || minParsed > 100000) {
                throw new Error('Mínimo de ingressos da empresa deve ser entre 1 e 100.000.');
            }
            const minChanged =
                minParsed !== company.min_event_tickets ||
                !company.min_event_tickets_customized;
            if (minChanged) {
                await saveCompanyMinEventTickets(company.id, { minTickets: minParsed });
            }

            dismissToast(toastId);
            showSuccess('Plano da empresa atualizado.');
            onSaved();
            onOpenChange(false);
        } catch (e: unknown) {
            dismissToast(toastId);
            showError(e instanceof Error ? e.message : 'Erro ao salvar plano.');
        } finally {
            setIsSaving(false);
        }
    };

    if (!company) return null;

    const billingReady = isCompanyBillingReady({
        billing_plan: company.billing_plan,
        billing_plan_accepted_at: company.billing_plan_accepted_at,
        billing_contract_id: company.billing_contract_id,
        billing_plan_locked_until: company.billing_plan_locked_until,
        requires_billing_reacceptance: company.requires_billing_reacceptance,
    });

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto bg-black border-yellow-500/30 text-white">
                <DialogHeader>
                    <DialogTitle className="text-yellow-500">Plano comercial — {companyDisplayName}</DialogTitle>
                    <DialogDescription className="text-gray-400">
                        Alteração administrativa (inclui downgrade). O gestor não pode reduzir o plano sozinho.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 text-sm">
                    <div className="grid grid-cols-2 gap-3 p-3 rounded-lg bg-black/50 border border-yellow-500/20">
                        <div>
                            <span className="text-gray-500">Status</span>
                            <p className={billingReady ? 'text-green-400' : 'text-amber-400'}>
                                {billingReady ? 'Plano confirmado' : 'Aguardando confirmação do gestor'}
                            </p>
                        </div>
                        <div>
                            <span className="text-gray-500">Plano atual</span>
                            <p className="text-white">{getBillingPlanLabel(company.billing_plan)}</p>
                        </div>
                    </div>

                    {company.ticket_inactivity_blocked && (
                        <div className="p-3 rounded-lg border border-orange-500/30 bg-orange-500/10 space-y-2">
                            <p className="text-orange-200 text-sm">
                                Empresa com <strong>bloqueio por inatividade</strong> de vendas de ingressos.
                            </p>
                            <Button
                                type="button"
                                size="sm"
                                className="bg-transparent border border-orange-500/40 text-orange-300 hover:bg-orange-500/10"
                                disabled={isSaving}
                                onClick={() =>
                                    void (async () => {
                                        try {
                                            await adminClearCompanyTicketInactivity(company.id);
                                            showSuccess('Bloqueio de inatividade removido.');
                                            onSaved();
                                        } catch (e: unknown) {
                                            showError(e instanceof Error ? e.message : 'Erro ao liberar.');
                                        }
                                    })()
                                }
                            >
                                Liberar inatividade (Admin)
                            </Button>
                        </div>
                    )}

                    <div className="space-y-2 p-3 rounded-lg border border-cyan-500/25 bg-cyan-500/5">
                        <Label className="text-white">Mínimo de ingressos (esta empresa)</Label>
                        <Input
                            type="number"
                            min={1}
                            max={100000}
                            value={minEventTickets}
                            onChange={(e) => setMinEventTickets(e.target.value)}
                            className="bg-black/60 border-yellow-500/30 text-white max-w-xs"
                        />
                        <p className="text-xs text-gray-500">
                            Padrão global atual: {billingSettings?.min_event_tickets_default ?? 10}.
                            {company.min_event_tickets_customized
                                ? ' Valor personalizado — não muda quando o global for alterado.'
                                : ' Segue o global quando este campo não for personalizado.'}
                        </p>
                        <Button
                            type="button"
                            size="sm"
                            className={adminBtnOutline}
                            disabled={isSaving}
                            onClick={() =>
                                void (async () => {
                                    try {
                                        await saveCompanyMinEventTickets(company.id, {
                                            restoreGlobalDefault: true,
                                        });
                                        setMinEventTickets(
                                            String(billingSettings?.min_event_tickets_default ?? 10),
                                        );
                                        showSuccess('Mínimo restaurado para o padrão global.');
                                        onSaved();
                                    } catch (e: unknown) {
                                        showError(e instanceof Error ? e.message : 'Erro ao restaurar.');
                                    }
                                })()
                            }
                        >
                            Restaurar padrão global
                        </Button>
                    </div>

                    <div className="space-y-2">
                        <Label className="text-white">Novo plano</Label>
                        <Select
                            value={selectedPlan}
                            onValueChange={(v) => setSelectedPlan(v as BillingPlanCode)}
                        >
                            <SelectTrigger className="bg-black/60 border-yellow-500/30 text-white">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent className="bg-black border-yellow-500/30 text-white">
                                {BILLING_PLANS.map((p) => (
                                    <SelectItem key={p.code} value={p.code} className="hover:bg-yellow-500/10">
                                        {p.label}
                                        {!p.selectableByGestor ? ' (só admin)' : ''}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <p className="text-xs text-gray-500">{planDef?.description}</p>
                    </div>

                    {selectedPlan === 'listing_monthly' && (
                        <div className="space-y-2">
                            <Label className="text-white">Mensalidade padrão (R$)</Label>
                            <Input
                                type="text"
                                inputMode="decimal"
                                placeholder="0,00"
                                value={listingMonthlyFee}
                                onChange={(e) =>
                                    setListingMonthlyFee(sanitizeCurrencyBrInput(e.target.value))
                                }
                                className="bg-black/60 border-yellow-500/30 text-white"
                            />
                            <p className="text-xs text-gray-500">
                                Usado ao gerar cobranças mensais (admin pode ajustar por fatura).
                            </p>
                        </div>
                    )}

                    {selectedPlan === 'consumption_or_license' && (
                        <div className="space-y-2">
                            <Label className="text-white">Licença mensal (R$)</Label>
                            <Input
                                type="text"
                                inputMode="decimal"
                                placeholder="0,00"
                                value={consumptionLicenseFee}
                                onChange={(e) =>
                                    setConsumptionLicenseFee(sanitizeCurrencyBrInput(e.target.value))
                                }
                                className="bg-black/60 border-yellow-500/30 text-white"
                            />
                            <p className="text-xs text-gray-500">
                                Override da licença padrão (R$ 99,99). Cobrança integral no upgrade e recorrência
                                mensal.
                            </p>
                        </div>
                    )}

                    <div className="space-y-2">
                        <Label className="text-white">Contrato vinculado (opcional)</Label>
                        {loadingContracts ? (
                            <Loader2 className="h-5 w-5 animate-spin text-yellow-500" />
                        ) : contracts.length === 0 ? (
                            <p className="text-amber-400 text-xs">
                                Nenhum contrato para o serviço &quot;{getBillingPlanLabel(selectedPlan)}&quot;. Cadastre em Admin → Contratos.
                            </p>
                        ) : (
                            <Select value={contractId} onValueChange={setContractId}>
                                <SelectTrigger className="bg-black/60 border-yellow-500/30 text-white">
                                    <SelectValue placeholder="Manter contrato atual" />
                                </SelectTrigger>
                                <SelectContent className="bg-black border-yellow-500/30 text-white">
                                    <SelectItem value={KEEP_CONTRACT_VALUE} className="hover:bg-yellow-500/10">
                                        Não alterar contrato
                                    </SelectItem>
                                    {contracts.map((c) => (
                                        <SelectItem key={c.id} value={c.id} className="hover:bg-yellow-500/10">
                                            {c.title} (v{c.version}){c.is_active ? ' — ativo' : ''}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        )}
                    </div>

                    <label className="flex items-start gap-3 cursor-pointer">
                        <Checkbox
                            checked={requireReacceptance}
                            onCheckedChange={(v) => setRequireReacceptance(v === true)}
                            className="mt-0.5 border-yellow-500/50 data-[state=checked]:bg-yellow-500 data-[state=checked]:text-black"
                        />
                        <span className="text-gray-300">
                            Exigir que o gestor aceite novamente o contrato no Perfil da Empresa
                        </span>
                    </label>
                </div>

                <div className="border-t border-yellow-500/20 pt-4">
                    <h4 className="text-yellow-500 text-sm font-medium flex items-center gap-2 mb-3">
                        <History className="h-4 w-4" />
                        Histórico de alterações
                    </h4>
                    {loadingHistory ? (
                        <Loader2 className="h-5 w-5 animate-spin text-yellow-500" />
                    ) : history.length === 0 ? (
                        <p className="text-gray-500 text-xs">Nenhum registro ainda.</p>
                    ) : (
                        <ul className="space-y-2 max-h-40 overflow-y-auto text-xs">
                            {history.map((h) => (
                                <li
                                    key={h.id}
                                    className="p-2 rounded bg-black/40 border border-yellow-500/10 text-gray-300"
                                >
                                    <span className="text-yellow-500/90">
                                        {BILLING_CHANGE_TYPE_LABELS[h.change_type] ?? h.change_type}
                                    </span>
                                    {' — '}
                                    {getBillingPlanLabel(h.from_plan)} → {getBillingPlanLabel(h.to_plan)}
                                    <span className="block text-gray-500 mt-0.5">
                                        {format(new Date(h.created_at), "dd/MM/yyyy HH:mm", { locale: ptBR })}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>

                <DialogFooter className="gap-2 sm:gap-0">
                    <Button
                        type="button"
                        className={adminBtnOutline}
                        onClick={() => onOpenChange(false)}
                        disabled={isSaving}
                    >
                        Cancelar
                    </Button>
                    <Button
                        type="button"
                        className={billingBtnSolid}
                        onClick={handleSave}
                        disabled={isSaving}
                    >
                        {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Salvar alterações'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

export default AdminCompanyBillingEditDialog;
