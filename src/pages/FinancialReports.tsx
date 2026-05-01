import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, DollarSign, TrendingUp, Users, Loader2, AlertCircle, Download, Eye } from 'lucide-react';
import { useFinancialReports, FinancialReportData } from '@/hooks/use-financial-reports';
import { useManagerTransactions } from '@/hooks/use-manager-transactions';
import { useManagerEvents } from '@/hooks/use-manager-events';
import { useProfile } from '@/hooks/use-profile';
import { supabase } from '@/integrations/supabase/client';
import { showError, showSuccess } from '@/utils/toast';
import { formatEventDateForDisplay } from '@/utils/format-event-date';

const ADMIN_MASTER_USER_TYPE_ID = 1;
const MANAGER_PRO_USER_TYPE_ID = 2;

const FinancialReports: React.FC = () => {
    const navigate = useNavigate();
    const [userId, setUserId] = useState<string | undefined>(undefined);
    const [selectedEventId, setSelectedEventId] = useState<string>('all');
    const [startDate, setStartDate] = useState<string>('');
    const [endDate, setEndDate] = useState<string>('');
    const [transactionStatusFilter, setTransactionStatusFilter] = useState<'all' | 'pending' | 'paid' | 'failed'>('all');
    const [transactionPage, setTransactionPage] = useState(1);
    const [checkingTransactionId, setCheckingTransactionId] = useState<string | null>(null);

    useEffect(() => {
        supabase.auth.getUser().then(({ data: { user } }) => {
            setUserId(user?.id);
        });
    }, []);

    const { profile, isLoading: isLoadingProfile } = useProfile(userId);
    const isAdminMaster = profile?.tipo_usuario_id === ADMIN_MASTER_USER_TYPE_ID;
    const isManagerPro = profile?.tipo_usuario_id === MANAGER_PRO_USER_TYPE_ID;
    const canAccess = isAdminMaster || isManagerPro;

    const { events, isLoading: isLoadingEvents } = useManagerEvents(userId, isAdminMaster || false);

    const filters = {
        eventId: selectedEventId !== 'all' ? selectedEventId : undefined,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        status: transactionStatusFilter !== 'all' ? transactionStatusFilter : undefined,
    };

    const { data: reportData, isLoading: isLoadingReports, isError } = useFinancialReports(
        filters,
        userId,
        isAdminMaster || false,
    );
    const { transactions } = useManagerTransactions(userId, isAdminMaster || false, filters);

    // Calcular totais gerais
    const totals = reportData ? {
        totalVendas: reportData.reduce((sum, item) => sum + item.quantidade_vendas, 0),
        totalIngressos: reportData.reduce((sum, item) => sum + item.quantidade_ingressos_vendidos, 0),
        totalVendido: reportData.reduce((sum, item) => sum + item.valor_total_vendido, 0),
        totalOrganizador: reportData.reduce((sum, item) => sum + item.valor_liquido_organizador, 0),
        totalComissao: reportData.reduce((sum, item) => sum + item.comissao_total_sistema, 0),
    } : null;

    const transactionSummary = {
        pending: transactions.filter(t => t.status === 'pending').length,
        paid: transactions.filter(t => t.status === 'paid').length,
        failed: transactions.filter(t => t.status === 'failed').length,
    };
    const transactionPageSize = 15;
    const totalTransactionPages = Math.max(1, Math.ceil(transactions.length / transactionPageSize));
    const safeTransactionPage = Math.min(transactionPage, totalTransactionPages);
    const pagedTransactions = transactions.slice(
        (safeTransactionPage - 1) * transactionPageSize,
        safeTransactionPage * transactionPageSize,
    );
    const transactionTotals = transactions.reduce(
        (acc, t) => {
            const gross = Number(t.gross_amount ?? t.total_value ?? 0);
            const fee = Number(t.mp_fee_amount ?? 0);
            const netMp = Number(t.net_amount_after_mp ?? 0);
            const systemCommission = Number(t.system_commission_amount ?? 0);
            const organizerNet = Number(t.organizer_net_amount ?? 0);
            acc.gross += gross;
            acc.fee += fee;
            acc.netMp += netMp;
            acc.systemCommission += systemCommission;
            acc.organizerNet += organizerNet;
            return acc;
        },
        { gross: 0, fee: 0, netMp: 0, systemCommission: 0, organizerNet: 0 },
    );
    const transactionAvgFeePct = transactionTotals.gross > 0 ? (transactionTotals.fee / transactionTotals.gross) * 100 : 0;
    const transactionAvgSystemPct = transactionTotals.gross > 0 ? (transactionTotals.systemCommission / transactionTotals.gross) * 100 : 0;

    const formatCurrency = (value: number) => {
        return new Intl.NumberFormat('pt-BR', {
            style: 'currency',
            currency: 'BRL',
        }).format(value);
    };

    const formatDate = (dateString: string) => {
        if (!dateString) return 'N/A';
        return formatEventDateForDisplay(dateString) || 'N/A';
    };

    const getStatusLabel = (status: string, paymentStatus: string | null) => {
        if (paymentStatus === 'approved' && status !== 'paid') return 'Pago (aguardando emissão)';
        if (status === 'paid' || paymentStatus === 'approved' || paymentStatus === 'authorized') return 'Pago';
        if (status === 'failed' || paymentStatus === 'rejected' || paymentStatus === 'cancelled') return 'Falhou';
        if (paymentStatus === 'in_process') return 'Em processamento';
        return 'Pendente';
    };

    const getStatusClass = (status: string, paymentStatus: string | null) => {
        if (status === 'paid' || paymentStatus === 'approved' || paymentStatus === 'authorized') return 'bg-green-500/20 text-green-400 border-green-500/30';
        if (status === 'failed' || paymentStatus === 'rejected' || paymentStatus === 'cancelled') return 'bg-red-500/20 text-red-400 border-red-500/30';
        return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
    };

    const handleCheckTransactionStatus = async (transactionId: string) => {
        setCheckingTransactionId(transactionId);
        try {
            const { data, error } = await supabase.functions.invoke('check-payment-status', {
                body: { transactionId },
            });
            if (error) throw error;

            const paymentStatus = data?.paymentStatus || 'desconhecido';
            const detail = data?.paymentStatusDetail ? ` (${data.paymentStatusDetail})` : '';
            if (data?.requiresAttention) {
                showError(data?.processingResult || 'Pagamento aprovado no MP, mas integração local ainda não concluiu.');
            } else {
                showSuccess(`Consulta MP: ${paymentStatus}${detail}`);
            }
            setTransactionPage(1);
        } catch (err: any) {
            console.error('Erro ao verificar transação no MP:', err);
            showError(err?.message || 'Falha ao consultar status no Mercado Pago.');
        } finally {
            setCheckingTransactionId(null);
        }
    };

    const handleExport = () => {
        if (!reportData || reportData.length === 0) {
            showError("Não há dados para exportar.");
            return;
        }

        // Criar CSV
        const headers = ['Evento', 'Data', 'Vendas', 'Ingressos Vendidos', 'Valor Total', 'Valor Organizador', 'Comissão Sistema', '% Comissão'];
        const rows = reportData.map(item => [
            item.event_title,
            formatDate(item.event_date),
            item.quantidade_vendas.toString(),
            item.quantidade_ingressos_vendidos.toString(),
            formatCurrency(item.valor_total_vendido),
            formatCurrency(item.valor_liquido_organizador),
            formatCurrency(item.comissao_total_sistema),
            `${item.percentual_comissao_medio.toFixed(2)}%`,
        ]);

        const csvContent = [
            headers.join(','),
            ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
        ].join('\n');

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', `relatorio_financeiro_${new Date().toISOString().split('T')[0]}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    if (isLoadingProfile || userId === undefined) {
        return (
            <div className="max-w-7xl mx-auto text-center py-20">
                <Loader2 className="h-8 w-8 animate-spin text-yellow-500 mx-auto mb-4" />
                <p className="text-gray-400">Carregando...</p>
            </div>
        );
    }

    // Verificar permissões após carregar o perfil
    if (!isLoadingProfile && profile && !canAccess) {
        showError("Acesso negado. Apenas Administradores Master e Proprietários podem acessar este relatório.");
        navigate('/manager/dashboard');
        return null;
    }

    return (
        <div className="max-w-7xl mx-auto p-6">
            <div className="flex items-center justify-between mb-8">
                <h1 className="text-2xl sm:text-3xl font-serif text-yellow-500 flex items-center">
                    <DollarSign className="h-7 w-7 mr-3" />
                    Relatório Financeiro
                </h1>
                <div className="flex gap-2">
                    {reportData && reportData.length > 0 && (
                        <Button
                            onClick={handleExport}
                            variant="outline"
                            className="bg-black/60 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10"
                        >
                            <Download className="mr-2 h-4 w-4" />
                            Exportar CSV
                        </Button>
                    )}
                    <Button
                        onClick={() => navigate('/manager/reports')}
                        variant="outline"
                        className="bg-black/60 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10"
                    >
                        <ArrowLeft className="mr-2 h-4 w-4" />
                        Voltar
                    </Button>
                </div>
            </div>

            {/* Filtros */}
            <Card className="bg-black border border-yellow-500/30 rounded-2xl p-6 mb-6">
                <CardHeader className="p-0 mb-4">
                    <CardTitle className="text-white text-lg">Filtros</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div>
                            <label className="text-sm text-gray-400 mb-2 block">Evento</label>
                            <Select value={selectedEventId} onValueChange={setSelectedEventId}>
                                <SelectTrigger className="bg-black/60 border-yellow-500/30 text-white">
                                    <SelectValue placeholder="Todos os eventos" />
                                </SelectTrigger>
                                <SelectContent className="bg-black border-yellow-500/30 text-white">
                                    <SelectItem value="all">Todos os eventos</SelectItem>
                                    {isLoadingEvents ? (
                                        <SelectItem value="loading" disabled>Carregando...</SelectItem>
                                    ) : (
                                        events.map(event => (
                                            <SelectItem key={event.id} value={event.id}>
                                                {event.title}
                                            </SelectItem>
                                        ))
                                    )}
                                </SelectContent>
                            </Select>
                        </div>
                        <div>
                            <label className="text-sm text-gray-400 mb-2 block">Data Inicial</label>
                            <Input
                                type="date"
                                value={startDate}
                                onChange={(e) => setStartDate(e.target.value)}
                                className="bg-black/60 border-yellow-500/30 text-white"
                            />
                        </div>
                        <div>
                            <label className="text-sm text-gray-400 mb-2 block">Data Final</label>
                            <Input
                                type="date"
                                value={endDate}
                                onChange={(e) => setEndDate(e.target.value)}
                                className="bg-black/60 border-yellow-500/30 text-white"
                            />
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Cards de Resumo */}
            {totals && (
                <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-6">
                    <Card className="bg-black border border-yellow-500/30 rounded-xl p-4">
                        <CardContent className="p-0">
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-gray-400 text-sm">Total de Vendas</p>
                                    <p className="text-white text-2xl font-bold">{totals.totalVendas}</p>
                                </div>
                                <TrendingUp className="h-8 w-8 text-yellow-500" />
                            </div>
                        </CardContent>
                    </Card>
                    <Card className="bg-black border border-yellow-500/30 rounded-xl p-4">
                        <CardContent className="p-0">
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-gray-400 text-sm">Ingressos Vendidos</p>
                                    <p className="text-white text-2xl font-bold">{totals.totalIngressos}</p>
                                </div>
                                <Users className="h-8 w-8 text-yellow-500" />
                            </div>
                        </CardContent>
                    </Card>
                    <Card className="bg-black border border-yellow-500/30 rounded-xl p-4">
                        <CardContent className="p-0">
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-gray-400 text-sm">Valor Total Vendido</p>
                                    <p className="text-white text-2xl font-bold">{formatCurrency(totals.totalVendido)}</p>
                                </div>
                                <DollarSign className="h-8 w-8 text-yellow-500" />
                            </div>
                        </CardContent>
                    </Card>
                    <Card className="bg-black border border-yellow-500/30 rounded-xl p-4">
                        <CardContent className="p-0">
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-gray-400 text-sm">Valor Organizadores</p>
                                    <p className="text-white text-2xl font-bold">{formatCurrency(totals.totalOrganizador)}</p>
                                </div>
                                <DollarSign className="h-8 w-8 text-green-500" />
                            </div>
                        </CardContent>
                    </Card>
                    <Card className="bg-black border border-yellow-500/30 rounded-xl p-4">
                        <CardContent className="p-0">
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-gray-400 text-sm">Comissão Sistema</p>
                                    <p className="text-white text-2xl font-bold">{formatCurrency(totals.totalComissao)}</p>
                                </div>
                                <DollarSign className="h-8 w-8 text-yellow-500" />
                            </div>
                        </CardContent>
                    </Card>
                </div>
            )}

            <Card className="bg-black border border-yellow-500/30 rounded-2xl p-6 mb-6">
                <CardHeader className="p-0 mb-4">
                    <CardTitle className="text-white text-xl">Transações de Pagamento (Cliente/Gestor)</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                        <div className="bg-black/60 border border-yellow-500/20 rounded-lg p-4">
                            <p className="text-sm text-gray-400">Pendentes</p>
                            <p className="text-2xl text-yellow-400 font-bold">{transactionSummary.pending}</p>
                        </div>
                        <div className="bg-black/60 border border-yellow-500/20 rounded-lg p-4">
                            <p className="text-sm text-gray-400">Pagas</p>
                            <p className="text-2xl text-green-400 font-bold">{transactionSummary.paid}</p>
                        </div>
                        <div className="bg-black/60 border border-yellow-500/20 rounded-lg p-4">
                            <p className="text-sm text-gray-400">Falhas</p>
                            <p className="text-2xl text-red-400 font-bold">{transactionSummary.failed}</p>
                        </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 mb-4">
                        <Button variant={transactionStatusFilter === 'all' ? 'default' : 'outline'} size="sm" onClick={() => { setTransactionStatusFilter('all'); setTransactionPage(1); }} className={transactionStatusFilter === 'all' ? 'bg-yellow-500 text-black hover:bg-yellow-600' : 'bg-black/60 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10'}>Todos</Button>
                        <Button variant={transactionStatusFilter === 'pending' ? 'default' : 'outline'} size="sm" onClick={() => { setTransactionStatusFilter('pending'); setTransactionPage(1); }} className={transactionStatusFilter === 'pending' ? 'bg-yellow-500 text-black hover:bg-yellow-600' : 'bg-black/60 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10'}>Pendentes</Button>
                        <Button variant={transactionStatusFilter === 'paid' ? 'default' : 'outline'} size="sm" onClick={() => { setTransactionStatusFilter('paid'); setTransactionPage(1); }} className={transactionStatusFilter === 'paid' ? 'bg-yellow-500 text-black hover:bg-yellow-600' : 'bg-black/60 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10'}>Pagas</Button>
                        <Button variant={transactionStatusFilter === 'failed' ? 'default' : 'outline'} size="sm" onClick={() => { setTransactionStatusFilter('failed'); setTransactionPage(1); }} className={transactionStatusFilter === 'failed' ? 'bg-yellow-500 text-black hover:bg-yellow-600' : 'bg-black/60 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10'}>Falhas</Button>
                    </div>

                    <div className="overflow-x-auto">
                        <Table>
                            <TableHeader>
                                <TableRow className="border-yellow-500/20">
                                    <TableHead className="text-yellow-500">Compra</TableHead>
                                    <TableHead className="text-yellow-500">Evento</TableHead>
                                    <TableHead className="text-yellow-500">Status</TableHead>
                                    <TableHead className="text-yellow-500 text-right">Bruto</TableHead>
                                    <TableHead className="text-yellow-500 text-right">Taxa MP</TableHead>
                                    <TableHead className="text-yellow-500 text-right">% Taxa MP</TableHead>
                                    <TableHead className="text-yellow-500 text-right">% Sistema</TableHead>
                                    <TableHead className="text-yellow-500 text-right">Líquido MP</TableHead>
                                    <TableHead className="text-yellow-500 text-right">Líquido Organizador</TableHead>
                                    <TableHead className="text-yellow-500">Detalhe MP</TableHead>
                                    <TableHead className="text-yellow-500">Data</TableHead>
                                    <TableHead className="text-yellow-500">Ação</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {pagedTransactions.map((transaction) => (
                                    <TableRow key={transaction.id} className="border-yellow-500/10">
                                        <TableCell className="text-white">#{transaction.id.slice(0, 8)}...</TableCell>
                                        <TableCell className="text-white">{transaction.events?.title || 'Evento'}</TableCell>
                                        <TableCell>
                                            <span className={`px-2.5 py-1 rounded-full text-xs font-semibold border ${getStatusClass(transaction.status, transaction.payment_status)}`}>
                                                {getStatusLabel(transaction.status, transaction.payment_status)}
                                            </span>
                                        </TableCell>
                                        <TableCell className="text-white text-right">{formatCurrency(transaction.gross_amount || transaction.total_value || 0)}</TableCell>
                                        <TableCell className="text-white text-right">{formatCurrency(transaction.mp_fee_amount || 0)}</TableCell>
                                        <TableCell className="text-white text-right">
                                            {transaction.mp_fee_percentage !== null && transaction.mp_fee_percentage !== undefined
                                                ? `${transaction.mp_fee_percentage.toFixed(2)}%`
                                                : '-'}
                                        </TableCell>
                                        <TableCell className="text-white text-right">
                                            {transaction.system_commission_percentage !== null && transaction.system_commission_percentage !== undefined
                                                ? `${transaction.system_commission_percentage.toFixed(2)}%`
                                                : '-'}
                                        </TableCell>
                                        <TableCell className="text-white text-right">{formatCurrency(transaction.net_amount_after_mp || 0)}</TableCell>
                                        <TableCell className="text-green-400 text-right">{formatCurrency(transaction.organizer_net_amount || 0)}</TableCell>
                                        <TableCell className="text-gray-400">{transaction.mp_status_detail || '-'}</TableCell>
                                        <TableCell className="text-gray-400">{new Date(transaction.created_at).toLocaleString('pt-BR')}</TableCell>
                                        <TableCell>
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={() => handleCheckTransactionStatus(transaction.id)}
                                                disabled={checkingTransactionId === transaction.id}
                                                className="bg-black/60 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10"
                                            >
                                                {checkingTransactionId === transaction.id ? (
                                                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                                ) : null}
                                                Verificar
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                ))}
                                {transactions.length > 0 && (
                                    <TableRow className="border-yellow-500/30 bg-yellow-500/5">
                                        <TableCell className="text-yellow-500 font-semibold" colSpan={3}>Total Geral (filtro atual)</TableCell>
                                        <TableCell className="text-yellow-500 text-right font-semibold">{formatCurrency(transactionTotals.gross)}</TableCell>
                                        <TableCell className="text-yellow-500 text-right font-semibold">{formatCurrency(transactionTotals.fee)}</TableCell>
                                        <TableCell className="text-yellow-500 text-right font-semibold">{transactionAvgFeePct.toFixed(2)}%</TableCell>
                                        <TableCell className="text-yellow-500 text-right font-semibold">{transactionAvgSystemPct.toFixed(2)}%</TableCell>
                                        <TableCell className="text-yellow-500 text-right font-semibold">{formatCurrency(transactionTotals.netMp)}</TableCell>
                                        <TableCell className="text-yellow-500 text-right font-semibold">{formatCurrency(transactionTotals.organizerNet)}</TableCell>
                                        <TableCell className="text-yellow-500" colSpan={3}>-</TableCell>
                                    </TableRow>
                                )}
                            </TableBody>
                        </Table>
                    </div>
                    {totalTransactionPages > 1 && (
                        <div className="flex items-center justify-end gap-2 mt-4">
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setTransactionPage((p) => Math.max(1, p - 1))}
                                disabled={safeTransactionPage <= 1}
                                className="bg-black/60 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10"
                            >
                                Anterior
                            </Button>
                            <span className="text-sm text-gray-400">
                                Página {safeTransactionPage} de {totalTransactionPages}
                            </span>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setTransactionPage((p) => Math.min(totalTransactionPages, p + 1))}
                                disabled={safeTransactionPage >= totalTransactionPages}
                                className="bg-black/60 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10"
                            >
                                Próxima
                            </Button>
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Tabela de Dados */}
            <Card className="bg-black border border-yellow-500/30 rounded-2xl p-6">
                <CardHeader className="p-0 mb-4">
                    <CardTitle className="text-white text-xl">Detalhamento por Evento</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                    {isLoadingReports ? (
                        <div className="text-center py-10">
                            <Loader2 className="h-8 w-8 animate-spin text-yellow-500 mx-auto mb-4" />
                            <p className="text-gray-400">Carregando dados...</p>
                        </div>
                    ) : isError ? (
                        <div className="text-center py-10">
                            <AlertCircle className="h-8 w-8 text-red-500 mx-auto mb-4" />
                            <p className="text-red-500">Erro ao carregar relatório. Tente novamente.</p>
                        </div>
                    ) : !reportData || reportData.length === 0 ? (
                        <div className="text-center py-10">
                            <AlertCircle className="h-8 w-8 text-gray-500 mx-auto mb-4" />
                            <p className="text-gray-400">Nenhum dado encontrado para os filtros selecionados.</p>
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow className="border-yellow-500/30">
                                        <TableHead className="text-yellow-500">Evento</TableHead>
                                        <TableHead className="text-yellow-500">Data</TableHead>
                                        <TableHead className="text-yellow-500 text-right">Vendas</TableHead>
                                        <TableHead className="text-yellow-500 text-right">Ingressos</TableHead>
                                        <TableHead className="text-yellow-500 text-right">Valor Total</TableHead>
                                        <TableHead className="text-yellow-500 text-right">Valor Organizador</TableHead>
                                        <TableHead className="text-yellow-500 text-right">Comissão Sistema</TableHead>
                                        <TableHead className="text-yellow-500">% Comissão</TableHead>
                                        <TableHead className="text-yellow-500">Ações</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {reportData.map((item) => (
                                        <TableRow key={item.event_id} className="border-yellow-500/10 hover:bg-yellow-500/5">
                                            <TableCell className="text-white font-medium">{item.event_title}</TableCell>
                                            <TableCell className="text-gray-400">{formatDate(item.event_date)}</TableCell>
                                            <TableCell className="text-white text-right">{item.quantidade_vendas}</TableCell>
                                            <TableCell className="text-white text-right">{item.quantidade_ingressos_vendidos}</TableCell>
                                            <TableCell className="text-white text-right font-semibold">{formatCurrency(item.valor_total_vendido)}</TableCell>
                                            <TableCell className="text-green-400 text-right">{formatCurrency(item.valor_liquido_organizador)}</TableCell>
                                            <TableCell className="text-yellow-400 text-right">{formatCurrency(item.comissao_total_sistema)}</TableCell>
                                            <TableCell className="text-gray-400 text-right">{item.percentual_comissao_medio.toFixed(2)}%</TableCell>
                                            <TableCell>
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={() => {
                                                        navigate(`/manager/reports/financial/${item.event_id}/${encodeURIComponent(item.event_title)}`);
                                                    }}
                                                    className="bg-black/60 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10"
                                                >
                                                    <Eye className="mr-2 h-4 w-4" />
                                                    Ver Detalhes
                                                </Button>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                    {reportData.length > 0 && totals && (
                                        <TableRow className="border-yellow-500/30 bg-yellow-500/5">
                                            <TableCell className="text-yellow-500 font-semibold">Total Geral</TableCell>
                                            <TableCell className="text-yellow-500">-</TableCell>
                                            <TableCell className="text-yellow-500 text-right font-semibold">{totals.totalVendas}</TableCell>
                                            <TableCell className="text-yellow-500 text-right font-semibold">{totals.totalIngressos}</TableCell>
                                            <TableCell className="text-yellow-500 text-right font-semibold">{formatCurrency(totals.totalVendido)}</TableCell>
                                            <TableCell className="text-yellow-500 text-right font-semibold">{formatCurrency(totals.totalOrganizador)}</TableCell>
                                            <TableCell className="text-yellow-500 text-right font-semibold">{formatCurrency(totals.totalComissao)}</TableCell>
                                            <TableCell className="text-yellow-500 text-right font-semibold">
                                                {totals.totalVendido > 0 ? `${((totals.totalComissao / totals.totalVendido) * 100).toFixed(2)}%` : '0.00%'}
                                            </TableCell>
                                            <TableCell className="text-yellow-500">-</TableCell>
                                        </TableRow>
                                    )}
                                </TableBody>
                            </Table>
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
};

export default FinancialReports;

