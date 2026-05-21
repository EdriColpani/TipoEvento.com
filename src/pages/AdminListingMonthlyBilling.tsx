import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { ArrowLeft, CalendarDays, Loader2, Plus, Receipt } from 'lucide-react';
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
import { useProfile } from '@/hooks/use-profile';
import { supabase } from '@/integrations/supabase/client';
import { useAdminCompaniesBilling } from '@/hooks/use-admin-companies-billing';
import {
    ListingChargeStatus,
    useListingMonthlyCharges,
} from '@/hooks/use-listing-monthly-charges';
import { useSystemBillingSettings } from '@/hooks/use-system-billing-settings';
import {
    formatCurrencyBrInput,
    isValidCurrencyBr,
    parseCurrencyBr,
    sanitizeCurrencyBrInput,
} from '@/utils/currency-input';
import { showError, showSuccess, showLoading, dismissToast } from '@/utils/toast';
import {
    billingAccentText,
    billingBtnBack,
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

const ADMIN_MASTER_USER_TYPE_ID = 1;

const STATUS_LABELS: Record<ListingChargeStatus, string> = {
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

const AdminListingMonthlyBilling: React.FC = () => {
    const navigate = useNavigate();
    const [userId, setUserId] = useState<string | undefined>();
    const [statusFilter, setStatusFilter] = useState<'all' | ListingChargeStatus>('all');
    const [createOpen, setCreateOpen] = useState(false);
    const [newCompanyId, setNewCompanyId] = useState('');
    const [newMonth, setNewMonth] = useState(() => format(new Date(), 'yyyy-MM'));
    const [newAmount, setNewAmount] = useState('');
    const [newNotes, setNewNotes] = useState('');
    const [isSaving, setIsSaving] = useState(false);

    React.useEffect(() => {
        supabase.auth.getUser().then(({ data: { user } }) => setUserId(user?.id));
    }, []);

    const { profile, isLoading: loadingProfile } = useProfile(userId);
    const isAdminMaster = profile?.tipo_usuario_id === ADMIN_MASTER_USER_TYPE_ID;

    const { companies } = useAdminCompaniesBilling(isAdminMaster);
    const { listingMonthlyDefaultFee } = useSystemBillingSettings(isAdminMaster);

    useEffect(() => {
        if (createOpen && !newAmount) {
            setNewAmount(formatCurrencyBrInput(listingMonthlyDefaultFee));
        }
    }, [createOpen, listingMonthlyDefaultFee, newAmount]);
    const listingCompanies = useMemo(
        () => companies.filter((c) => c.billing_plan === 'listing_monthly'),
        [companies],
    );

    const { charges, isLoading, isError, invalidate } = useListingMonthlyCharges(isAdminMaster);

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
            showError('Informe um valor válido (ex.: 299,99).');
            return;
        }
        const amount = parseCurrencyBr(newAmount);

        const referenceMonth = `${newMonth}-01`;
        setIsSaving(true);
        const toastId = showLoading('Gerando cobrança...');
        try {
            const { data, error } = await supabase.rpc('admin_create_listing_monthly_charge', {
                p_company_id: newCompanyId,
                p_reference_month: referenceMonth,
                p_amount: amount,
                p_notes: newNotes.trim() || null,
            });
            if (error) throw error;
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

    const handleSetStatus = async (chargeId: string, status: ListingChargeStatus) => {
        const toastId = showLoading('Atualizando status...');
        try {
            const { error } = await supabase.rpc('admin_set_listing_charge_status', {
                p_charge_id: chargeId,
                p_status: status,
                p_notes: null,
            });
            if (error) throw error;
            dismissToast(toastId);
            showSuccess(`Status alterado para ${STATUS_LABELS[status]}.`);
            invalidate();
        } catch (e: unknown) {
            dismissToast(toastId);
            showError(e instanceof Error ? e.message : 'Erro ao atualizar status.');
        }
    };

    if (loadingProfile || !userId) {
        return (
            <div className="max-w-7xl mx-auto text-center py-20">
                <Loader2 className={`h-10 w-10 animate-spin ${billingSpinner} mx-auto mb-4`} />
                <p className="text-gray-400">Carregando...</p>
            </div>
        );
    }

    if (!isAdminMaster) {
        return (
            <div className="max-w-7xl mx-auto text-center py-20 text-red-400">
                Acesso restrito ao Admin Master.
            </div>
        );
    }

    return (
        <div className="max-w-7xl mx-auto">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-8 gap-4">
                <div>
                    <h1 className={`text-2xl sm:text-3xl font-serif ${billingAccentText} flex items-center gap-3`}>
                        <Receipt className="h-8 w-8" />
                        Faturas mensais
                    </h1>
                    <p className="text-gray-400 text-sm mt-2">
                        Lançamento e controle de cobranças do plano vitrine ({listingCompanies.length} empresa(s)).
                        Mensalidade padrão em{' '}
                        <button
                            type="button"
                            onClick={() => navigate('/admin/settings/pricing?tab=listing')}
                            className="text-cyan-400 underline hover:text-cyan-300"
                        >
                            Preços e comissões → Divulgação
                        </button>
                        .
                    </p>
                </div>
                <div className="flex flex-wrap gap-2">
                    <Button type="button" onClick={() => navigate('/admin/dashboard')} className={billingBtnBack}>
                        <ArrowLeft className="mr-2 h-4 w-4" />
                        Voltar
                    </Button>
                    <Button
                        type="button"
                        onClick={() => setCreateOpen(true)}
                        className={billingBtnSolid}
                        disabled={listingCompanies.length === 0}
                    >
                        <Plus className="mr-2 h-4 w-4" />
                        Nova cobrança
                    </Button>
                </div>
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
                        Cobranças mensais
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
                                                            onClick={() =>
                                                                handleSetStatus(charge.id, 'paid')
                                                            }
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
                        <DialogTitle className={billingAccentText}>Nova cobrança mensal</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <Label>Empresa (plano vitrine)</Label>
                            <Select value={newCompanyId} onValueChange={setNewCompanyId}>
                                <SelectTrigger className={billingInput}>
                                    <SelectValue placeholder="Selecione..." />
                                </SelectTrigger>
                                <SelectContent className={`bg-black ${billingPanelBorder} text-white`}>
                                    {listingCompanies.map((c) => (
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
        </div>
    );
};

export default AdminListingMonthlyBilling;
