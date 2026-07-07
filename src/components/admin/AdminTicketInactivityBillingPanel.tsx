import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { CalendarDays, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
    TicketInactivityChargeStatus,
    useTicketInactivityCharges,
} from '@/hooks/use-ticket-inactivity-charges';
import { callRpcRest } from '@/utils/supabase-rest-rpc';
import { showError, showSuccess, showLoading, dismissToast } from '@/utils/toast';
import {
    billingAccentText,
    billingBtnMutedSm,
    billingBtnSuccessSm,
    billingPanelBorder,
    billingSpinner,
    billingTableHead,
} from '@/constants/billing-ui';

const STATUS_LABELS: Record<TicketInactivityChargeStatus, string> = {
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

const AdminTicketInactivityBillingPanel: React.FC = () => {
    const navigate = useNavigate();
    const [statusFilter, setStatusFilter] = useState<'all' | TicketInactivityChargeStatus>('all');

    const { companies } = useAdminCompaniesBilling(true);
    const ticketPlanCompanies = useMemo(
        () =>
            companies.filter(
                (c) => c.billing_plan === 'ticket_commission' || c.billing_plan === 'ticket_plus_consumption',
            ),
        [companies],
    );

    const { charges, isLoading, isError, invalidate } = useTicketInactivityCharges(true);

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

    const handleSetStatus = async (chargeId: string, status: TicketInactivityChargeStatus) => {
        const toastId = showLoading('Atualizando status...');
        try {
            await callRpcRest('admin_set_ticket_inactivity_charge_status', {
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

    return (
        <>
            <p className="text-gray-400 text-sm mb-4">
                Taxas de inatividade comercial ({ticketPlanCompanies.length} empresa(s) em planos com venda de
                ingressos). Regras e taxa global em{' '}
                <button
                    type="button"
                    onClick={() => navigate('/admin/settings/pricing?tab=tickets')}
                    className="text-cyan-400 underline hover:text-cyan-300"
                >
                    Preços e comissões → Cobrança de ingressos
                </button>
                . Cobranças são geradas automaticamente após 2 meses consecutivos de inatividade.
            </p>

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
                        <CardTitle className="text-white text-xl">{charges.filter((c) => c.status === 'paid').length}</CardTitle>
                    </CardHeader>
                    <CardContent className="text-green-400 font-semibold">{formatMoney(totals.paidAmount)}</CardContent>
                </Card>
                <Card className={`bg-black border ${billingPanelBorder}`}>
                    <CardHeader className="pb-2">
                        <CardDescription className="text-gray-400">Filtro</CardDescription>
                        <CardTitle className="text-white text-lg flex items-center gap-2">
                            <CalendarDays className="h-5 w-5 text-cyan-400" />
                            Status
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <Select
                            value={statusFilter}
                            onValueChange={(v) => setStatusFilter(v as 'all' | TicketInactivityChargeStatus)}
                        >
                            <SelectTrigger className="bg-black border-cyan-500/30 text-white">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">Todos</SelectItem>
                                <SelectItem value="pending">Pendentes</SelectItem>
                                <SelectItem value="paid">Pagos</SelectItem>
                                <SelectItem value="cancelled">Cancelados</SelectItem>
                            </SelectContent>
                        </Select>
                    </CardContent>
                </Card>
            </div>

            <Card className={`bg-black border ${billingPanelBorder}`}>
                <CardHeader>
                    <CardTitle className={`${billingAccentText} text-lg`}>Cobranças de inatividade</CardTitle>
                    <CardDescription className="text-gray-400">
                        {filteredCharges.length} registro(s) exibido(s)
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    {isLoading ? (
                        <div className="text-center py-12">
                            <Loader2 className={`h-8 w-8 animate-spin ${billingSpinner} mx-auto`} />
                        </div>
                    ) : isError ? (
                        <p className="text-red-400 text-sm">Erro ao carregar cobranças.</p>
                    ) : filteredCharges.length === 0 ? (
                        <p className="text-gray-500 text-sm">Nenhuma cobrança encontrada.</p>
                    ) : (
                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow className="border-cyan-500/20">
                                        <TableHead className={billingTableHead}>Mês ref.</TableHead>
                                        <TableHead className={billingTableHead}>Empresa</TableHead>
                                        <TableHead className={billingTableHead}>Valor</TableHead>
                                        <TableHead className={billingTableHead}>Status</TableHead>
                                        <TableHead className={billingTableHead}>Pago em</TableHead>
                                        <TableHead className={billingTableHead}>Ações</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {filteredCharges.map((charge) => (
                                        <TableRow key={charge.id} className="border-cyan-500/10">
                                            <TableCell className="text-gray-300 text-sm">
                                                {formatReferenceMonth(charge.reference_month)}
                                            </TableCell>
                                            <TableCell className="text-gray-300 text-sm">
                                                <div>{charge.company_name ?? charge.company_id}</div>
                                                {charge.company_cnpj ? (
                                                    <div className="text-xs text-gray-500">{charge.company_cnpj}</div>
                                                ) : null}
                                            </TableCell>
                                            <TableCell className="text-cyan-300 font-medium">
                                                {formatMoney(charge.amount)}
                                            </TableCell>
                                            <TableCell className="text-gray-300 text-sm">
                                                {STATUS_LABELS[charge.status]}
                                            </TableCell>
                                            <TableCell className="text-gray-400 text-xs whitespace-nowrap">
                                                {charge.paid_at
                                                    ? format(new Date(charge.paid_at), 'dd/MM/yyyy HH:mm', {
                                                          locale: ptBR,
                                                      })
                                                    : '—'}
                                            </TableCell>
                                            <TableCell>
                                                <div className="flex flex-wrap gap-1">
                                                    {charge.status === 'pending' && (
                                                        <>
                                                            <Button
                                                                type="button"
                                                                size="sm"
                                                                className={billingBtnSuccessSm}
                                                                onClick={() => void handleSetStatus(charge.id, 'paid')}
                                                            >
                                                                Marcar pago
                                                            </Button>
                                                            <Button
                                                                type="button"
                                                                size="sm"
                                                                className={billingBtnMutedSm}
                                                                onClick={() =>
                                                                    void handleSetStatus(charge.id, 'cancelled')
                                                                }
                                                            >
                                                                Cancelar
                                                            </Button>
                                                        </>
                                                    )}
                                                    {charge.status === 'cancelled' && (
                                                        <Button
                                                            type="button"
                                                            size="sm"
                                                            className={billingBtnMutedSm}
                                                            onClick={() => void handleSetStatus(charge.id, 'pending')}
                                                        >
                                                            Reabrir
                                                        </Button>
                                                    )}
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    )}
                </CardContent>
            </Card>
        </>
    );
};

export default AdminTicketInactivityBillingPanel;
