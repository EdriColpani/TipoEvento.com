import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { CalendarDays, Loader2, Plus, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { useAdminCompaniesBilling } from '@/hooks/use-admin-companies-billing';
import {
    ConsumptionLicenseChargeStatus,
    useConsumptionLicenseCharges,
} from '@/hooks/use-consumption-license-charges';
import { useSystemBillingSettings } from '@/hooks/use-system-billing-settings';
import {
    formatCurrencyBrInput,
    isValidCurrencyBr,
    parseCurrencyBr,
    sanitizeCurrencyBrInput,
} from '@/utils/currency-input';
import { callRpcRest } from '@/utils/supabase-rest-rpc';
import { showError, showSuccess, showLoading, dismissToast } from '@/utils/toast';
import {
    billingAccentText,
    billingBtnGhost,
    billingBtnMutedSm,
    billingBtnSolid,
    billingBtnSuccessSm,
    billingDialogSurface,
    billingInput,
    billingPanelBorder,
    billingSpinner,
    billingTableHead,
} from '@/constants/billing-ui';

const STATUS_LABELS: Record<ConsumptionLicenseChargeStatus, string> = {
    pending: 'Pendente',
    paid: 'Pago',
    cancelled: 'Cancelado',
};

function formatMoney(value: number): string {
    return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatReferenceMonth(isoDate: string): string {
    try {
        return format(parseISO(isoDate), "MMMM 'de' yyyy", { locale: ptBR });
    } catch {
        return isoDate;
    }
}

const AdminConsumptionLicenseBillingPanel: React.FC = () => {
    const navigate = useNavigate();
    const [statusFilter, setStatusFilter] = useState<'all' | ConsumptionLicenseChargeStatus>('all');
    const [createOpen, setCreateOpen] = useState(false);
    const [newCompanyId, setNewCompanyId] = useState('');
    const [newMonth, setNewMonth] = useState(() => format(new Date(), 'yyyy-MM'));
    const [newAmount, setNewAmount] = useState('');
    const [newNotes, setNewNotes] = useState('');
    const [isSaving, setIsSaving] = useState(false);
    const [isBatchRunning, setIsBatchRunning] = useState(false);

    const { companies } = useAdminCompaniesBilling(true);
    const { consumptionLicenseDefaultFee } = useSystemBillingSettings(true);

    useEffect(() => {
        if (createOpen && !newAmount) {
            setNewAmount(formatCurrencyBrInput(consumptionLicenseDefaultFee));
        }
    }, [createOpen, consumptionLicenseDefaultFee, newAmount]);

    const licenseCompanies = useMemo(
        () => companies.filter((c) => c.billing_plan === 'consumption_or_license'),
        [companies],
    );

    const { charges, isLoading, isError, invalidate } = useConsumptionLicenseCharges(true);

    const filteredCharges = useMemo(() => {
        if (statusFilter === 'all') return charges;
        return charges.filter((c) => c.status === statusFilter);
    }, [charges, statusFilter]);

    const totals = useMemo(() => {
        const pending = charges.filter((c) => c.status === 'pending');
        const paid = charges.filter((c) => c.status === 'paid');
        return {
            pendingCount: pending.length,
            pendingAmount: pending.reduce((s, c) => s + c.amount, 0),
            paidAmount: paid.reduce((s, c) => s + c.amount, 0),
        };
    }, [charges]);

    const handleCreateCharge = async () => {
        if (!newCompanyId) {
            showError('Selecione uma empresa.');
            return;
        }
        if (!isValidCurrencyBr(newAmount)) {
            showError('Informe um valor válido (ex.: 99,99).');
            return;
        }
        const amount = parseCurrencyBr(newAmount);
        const referenceMonth = `${newMonth}-01`;
        setIsSaving(true);
        const toastId = showLoading('Gerando cobrança...');
        try {
            await callRpcRest('admin_create_consumption_license_charge', {
                p_company_id: newCompanyId,
                p_reference_month: referenceMonth,
                p_amount: amount,
                p_notes: newNotes.trim() || null,
            }, 15_000);
            dismissToast(toastId);
            showSuccess('Cobrança registrada.');
            setCreateOpen(false);
            setNewNotes('');
            invalidate();
        } catch (e: unknown) {
            dismissToast(toastId);
            showError(e instanceof Error ? e.message : 'Erro ao gerar cobrança.');
        } finally {
            setIsSaving(false);
        }
    };

    const handleSetStatus = async (chargeId: string, status: ConsumptionLicenseChargeStatus) => {
        const toastId = showLoading('Atualizando status...');
        try {
            await callRpcRest('admin_set_consumption_license_charge_status', {
                p_charge_id: chargeId,
                p_status: status,
                p_notes: null,
            }, 12_000);
            dismissToast(toastId);
            showSuccess(`Status alterado para ${STATUS_LABELS[status]}.`);
            invalidate();
        } catch (e: unknown) {
            dismissToast(toastId);
            showError(e instanceof Error ? e.message : 'Erro ao atualizar status.');
        }
    };

    const handleBatchGenerate = async () => {
        setIsBatchRunning(true);
        const toastId = showLoading('Gerando licenças do mês...');
        try {
            const payload = await callRpcRest<{
                charges_created_or_updated?: number;
                skipped_already_paid?: number;
            }>('admin_generate_monthly_consumption_license_charges', {
                p_reference_month: `${format(new Date(), 'yyyy-MM')}-01`,
            }, 20_000);
            dismissToast(toastId);
            showSuccess(
                `Lote concluído: ${payload.charges_created_or_updated ?? 0} cobrança(s) gerada(s)/atualizada(s), ${payload.skipped_already_paid ?? 0} já paga(s).`,
            );
            invalidate();
        } catch (e: unknown) {
            dismissToast(toastId);
            showError(e instanceof Error ? e.message : 'Erro ao gerar lote mensal.');
        } finally {
            setIsBatchRunning(false);
        }
    };

    return (
        <>
            <div className="flex flex-wrap gap-2 mb-6">
                <p className="text-gray-400 text-sm flex-1 min-w-[16rem]">
                    Licença mensal do plano consumo/licença ({licenseCompanies.length} empresa(s)).
                    Valor padrão em{' '}
                    <button
                        type="button"
                        onClick={() => navigate('/admin/settings/pricing?tab=consumption-license')}
                        className="text-cyan-400 underline hover:text-cyan-300"
                    >
                        Preços e comissões → Consumo / licença
                    </button>
                    .
                </p>
                <Button
                    type="button"
                    variant="outline"
                    className={billingBtnGhost}
                    disabled={isBatchRunning || licenseCompanies.length === 0}
                    onClick={handleBatchGenerate}
                >
                    {isBatchRunning ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                        <>
                            <RefreshCw className="mr-2 h-4 w-4" />
                            Gerar mês corrente
                        </>
                    )}
                </Button>
                <Button
                    type="button"
                    onClick={() => setCreateOpen(true)}
                    className={billingBtnSolid}
                    disabled={licenseCompanies.length === 0}
                >
                    <Plus className="mr-2 h-4 w-4" />
                    Nova cobrança
                </Button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                <Card className={`bg-black border ${billingPanelBorder}`}>
                    <CardHeader className="pb-2">
                        <CardDescription className="text-gray-400">Pendentes</CardDescription>
                        <CardTitle className="text-white text-xl">{totals.pendingCount}</CardTitle>
                    </CardHeader>
                    <CardContent className={`${billingAccentText} font-semibold`}>
                        {formatMoney(totals.pendingAmount)}
                    </CardContent>
                </Card>
                <Card className={`bg-black border ${billingPanelBorder}`}>
                    <CardHeader className="pb-2">
                        <CardDescription className="text-gray-400">Total recebido</CardDescription>
                        <CardTitle className="text-green-400 text-xl">{formatMoney(totals.paidAmount)}</CardTitle>
                    </CardHeader>
                </Card>
                <Card className={`bg-black border ${billingPanelBorder}`}>
                    <CardHeader className="pb-2">
                        <CardDescription className="text-gray-400">Filtro</CardDescription>
                        <Select
                            value={statusFilter}
                            onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}
                        >
                            <SelectTrigger className={`${billingInput} mt-1`}>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent className={`bg-black ${billingPanelBorder} text-white`}>
                                <SelectItem value="all">Todos</SelectItem>
                                <SelectItem value="pending">Pendentes</SelectItem>
                                <SelectItem value="paid">Pagos</SelectItem>
                                <SelectItem value="cancelled">Cancelados</SelectItem>
                            </SelectContent>
                        </Select>
                    </CardHeader>
                </Card>
            </div>

            <Card className={`bg-black border ${billingPanelBorder} rounded-2xl`}>
                <CardHeader>
                    <CardTitle className="text-white flex items-center gap-2">
                        <CalendarDays className={`h-5 w-5 ${billingAccentText}`} />
                        Cobranças de licença
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    {isLoading ? (
                        <div className="text-center py-12">
                            <Loader2 className={`h-8 w-8 animate-spin ${billingSpinner} mx-auto`} />
                        </div>
                    ) : isError ? (
                        <p className="text-red-400 text-center py-8">Erro ao carregar cobranças.</p>
                    ) : filteredCharges.length === 0 ? (
                        <p className="text-gray-400 text-center py-8">Nenhuma cobrança encontrada.</p>
                    ) : (
                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow className="border-cyan-500/20">
                                        <TableHead className={billingTableHead}>Empresa</TableHead>
                                        <TableHead className={billingTableHead}>Mês ref.</TableHead>
                                        <TableHead className={billingTableHead}>Valor</TableHead>
                                        <TableHead className={billingTableHead}>Status</TableHead>
                                        <TableHead className={`${billingTableHead} text-right`}>Ações</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {filteredCharges.map((charge) => (
                                        <TableRow key={charge.id} className="border-cyan-500/10">
                                            <TableCell className="text-white">
                                                {charge.company_name ?? charge.company_id}
                                            </TableCell>
                                            <TableCell className="text-gray-300 capitalize">
                                                {formatReferenceMonth(charge.reference_month)}
                                            </TableCell>
                                            <TableCell className="text-white">
                                                {formatMoney(charge.amount)}
                                            </TableCell>
                                            <TableCell>
                                                <span
                                                    className={
                                                        charge.status === 'paid'
                                                            ? 'text-green-400'
                                                            : charge.status === 'cancelled'
                                                              ? 'text-gray-500'
                                                              : 'text-amber-400'
                                                    }
                                                >
                                                    {STATUS_LABELS[charge.status]}
                                                </span>
                                            </TableCell>
                                            <TableCell className="text-right space-x-2">
                                                {charge.status === 'pending' && (
                                                    <>
                                                        <Button
                                                            type="button"
                                                            size="sm"
                                                            className={billingBtnSuccessSm}
                                                            onClick={() => handleSetStatus(charge.id, 'paid')}
                                                        >
                                                            Marcar pago
                                                        </Button>
                                                        <Button
                                                            type="button"
                                                            size="sm"
                                                            className={billingBtnMutedSm}
                                                            onClick={() =>
                                                                handleSetStatus(charge.id, 'cancelled')
                                                            }
                                                        >
                                                            Cancelar
                                                        </Button>
                                                    </>
                                                )}
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    )}
                </CardContent>
            </Card>

            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
                <DialogContent className={`${billingDialogSurface} max-w-md`}>
                    <DialogHeader>
                        <DialogTitle className={billingAccentText}>Nova cobrança de licença</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <Label>Empresa (plano consumo/licença)</Label>
                            <Select value={newCompanyId} onValueChange={setNewCompanyId}>
                                <SelectTrigger className={billingInput}>
                                    <SelectValue placeholder="Selecione..." />
                                </SelectTrigger>
                                <SelectContent className={`bg-black ${billingPanelBorder} text-white`}>
                                    {licenseCompanies.map((c) => (
                                        <SelectItem key={c.id} value={c.id}>
                                            {c.trade_name || c.corporate_name || c.cnpj}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label>Mês de referência</Label>
                            <Input
                                type="month"
                                value={newMonth}
                                onChange={(e) => setNewMonth(e.target.value)}
                                className={billingInput}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Valor (R$)</Label>
                            <Input
                                type="text"
                                inputMode="decimal"
                                placeholder="0,00"
                                value={newAmount}
                                onChange={(e) => setNewAmount(sanitizeCurrencyBrInput(e.target.value))}
                                className={billingInput}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Observações (opcional)</Label>
                            <Input
                                value={newNotes}
                                onChange={(e) => setNewNotes(e.target.value)}
                                className={billingInput}
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button type="button" className={billingBtnGhost} onClick={() => setCreateOpen(false)}>
                            Cancelar
                        </Button>
                        <Button
                            type="button"
                            className={billingBtnSolid}
                            disabled={isSaving}
                            onClick={handleCreateCharge}
                        >
                            {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Gerar cobrança'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
};

export default AdminConsumptionLicenseBillingPanel;
