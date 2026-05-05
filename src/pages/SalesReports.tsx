import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, BarChart, Download, DollarSign, Loader2, TrendingUp } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useProfile } from '@/hooks/use-profile';
import { useManagerEvents } from '@/hooks/use-manager-events';
import { useSalesReport } from '@/hooks/use-sales-report';
import { showSuccess, showError } from '@/utils/toast';

const ADMIN_MASTER_USER_TYPE_ID = 1;
const MANAGER_PRO_USER_TYPE_ID = 2;

const SalesReports: React.FC = () => {
    const navigate = useNavigate();
    const [userId, setUserId] = useState<string | undefined>(undefined);
    const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
    const [startDate, setStartDate] = useState<string>('');
    const [endDate, setEndDate] = useState<string>('');

    useEffect(() => {
        supabase.auth.getUser().then(({ data: { user } }) => setUserId(user?.id));
    }, []);

    const { profile, isLoading: isLoadingProfile } = useProfile(userId);
    const isAdminMaster = profile?.tipo_usuario_id === ADMIN_MASTER_USER_TYPE_ID;
    const canAccess =
        profile?.tipo_usuario_id === ADMIN_MASTER_USER_TYPE_ID ||
        profile?.tipo_usuario_id === MANAGER_PRO_USER_TYPE_ID;

    const { events, isLoading: isLoadingEvents } = useManagerEvents(userId, isAdminMaster, {
        enabled: !!userId && !isLoadingProfile && !!profile && Boolean(canAccess),
    });

    const filters = useMemo(
        () => ({
            eventId: selectedEventId,
            startDate: startDate || null,
            endDate: endDate || null,
        }),
        [selectedEventId, startDate, endDate],
    );

    const queryEnabled = Boolean(canAccess && (isAdminMaster || !!userId));

    const {
        data: salesReports = [],
        isLoading: isLoadingSales,
        isError: isSalesError,
    } = useSalesReport(userId, isAdminMaster, filters, queryEnabled);

    useEffect(() => {
        if (isSalesError) showError('Erro ao carregar relatório de vendas.');
    }, [isSalesError]);

    if (!userId || isLoadingProfile) {
        return (
            <div className="max-w-7xl mx-auto flex flex-col items-center justify-center py-24 text-gray-400">
                <Loader2 className="h-10 w-10 animate-spin text-yellow-500 mb-4" />
                <p>Carregando sessão...</p>
            </div>
        );
    }

    if (!profile) {
        return (
            <div className="max-w-7xl mx-auto text-center py-20 px-4">
                <h1 className="text-2xl font-serif text-yellow-500 mb-4">Perfil não encontrado</h1>
                <Button onClick={() => navigate('/manager/dashboard')} className="bg-yellow-500 text-black hover:bg-yellow-600">
                    Voltar ao Dashboard
                </Button>
            </div>
        );
    }

    if (!canAccess) {
        return (
            <div className="max-w-7xl mx-auto text-center py-20">
                <h1 className="text-3xl font-serif text-red-500 mb-4">Acesso Negado</h1>
                <p className="text-gray-400">Você não tem permissão para acessar esta página.</p>
                <Button onClick={() => navigate('/manager/dashboard')} className="mt-4 bg-yellow-500 text-black hover:bg-yellow-600">
                    Voltar para o Dashboard
                </Button>
            </div>
        );
    }

    const totalSalesValue = salesReports.reduce((acc, r) => acc + r.total_sales_value, 0);
    const totalTicketsSold = salesReports.reduce((acc, r) => acc + r.total_tickets_sold, 0);
    const overallAverageTicket =
        totalTicketsSold > 0 ? totalSalesValue / totalTicketsSold : 0;

    const handleExportCsv = () => {
        if (!salesReports || salesReports.length === 0) {
            showError('Nenhum dado para exportar.');
            return;
        }

        const headers = [
            'Evento',
            'Valor Total de Vendas',
            'Total de Ingressos Vendidos',
            'Preço Médio do Ingresso',
        ];
        const rows = salesReports.map((report) => [
            report.event_title,
            report.total_sales_value.toFixed(2).replace('.', ','),
            report.total_tickets_sold,
            report.average_ticket_price.toFixed(2).replace('.', ','),
        ]);

        const csvContent = [headers.join(';'), ...rows.map((row) => row.join(';'))].join('\n');

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.setAttribute('download', 'relatorio_vendas.csv');
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        showSuccess('Relatório exportado com sucesso!');
    };

    return (
        <div className="max-w-7xl mx-auto p-4 sm:p-6 lg:p-8">
            <div className="flex items-center justify-between mb-8">
                <h1 className="text-2xl sm:text-3xl font-serif text-yellow-500 flex items-center">
                    <BarChart className="h-7 w-7 mr-3" />
                    Relatório de Vendas
                </h1>
                <Button
                    onClick={() => navigate('/manager/reports')}
                    variant="outline"
                    className="bg-black/60 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 text-sm"
                >
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Voltar para Relatórios
                </Button>
            </div>

            <Card className="bg-black border border-yellow-500/30 rounded-2xl shadow-2xl shadow-yellow-500/10 p-6 mb-8">
                <CardHeader>
                    <CardTitle className="text-white text-xl">Filtros</CardTitle>
                    <CardDescription className="text-gray-400">
                        Dados a partir de recebíveis pagos (mesma base do relatório financeiro). Período usa a{' '}
                        <span className="text-gray-300">data de criação da compra</span>. Ingressos por venda = tamanho de{' '}
                        <span className="text-gray-300">wristband_analytics_ids</span>, ou 1 se o campo vier vazio.
                    </CardDescription>
                </CardHeader>
                <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div>
                        <label htmlFor="event-filter" className="block text-sm font-medium text-gray-400 mb-2">Filtrar por Evento</label>
                        <Select onValueChange={(value) => setSelectedEventId(value === 'all' ? null : value)} value={selectedEventId || 'all'}>
                            <SelectTrigger className="w-full bg-black/60 border-cyan-500/30 text-white focus:ring-cyan-400/40 h-10 [&_svg]:text-cyan-400">
                                <SelectValue className="text-white" placeholder="Todos os Eventos" />
                            </SelectTrigger>
                            <SelectContent className="bg-black border-cyan-500/30 text-white">
                                <SelectItem value="all" className="cursor-pointer">Todos os Eventos</SelectItem>
                                {isLoadingEvents ? (
                                    <SelectItem value="loading" disabled>Carregando eventos...</SelectItem>
                                ) : (
                                    events?.map((event) => (
                                        <SelectItem key={event.id} value={event.id} className="cursor-pointer">
                                            {event.title}
                                        </SelectItem>
                                    ))
                                )}
                            </SelectContent>
                        </Select>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-400 mb-2">Período (data da compra)</label>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            <Input
                                type="date"
                                value={startDate}
                                onChange={(e) => {
                                    const nextStart = e.target.value;
                                    setStartDate(nextStart);
                                    if (endDate && nextStart && nextStart > endDate) {
                                        setEndDate(nextStart);
                                    }
                                }}
                                className="w-full bg-black/60 border-yellow-500/30 text-white focus:ring-yellow-500 h-10"
                                aria-label="Data inicial"
                            />
                            <Input
                                type="date"
                                value={endDate}
                                min={startDate || undefined}
                                onChange={(e) => setEndDate(e.target.value)}
                                className="w-full bg-black/60 border-yellow-500/30 text-white focus:ring-yellow-500 h-10"
                                aria-label="Data final"
                            />
                        </div>
                    </div>

                    <div className="flex items-end">
                        <Button onClick={handleExportCsv} className="w-full bg-yellow-500 text-black hover:bg-yellow-600">
                            <Download className="mr-2 h-4 w-4" />
                            Exportar CSV
                        </Button>
                    </div>
                </CardContent>
            </Card>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                <Card className="bg-black border border-yellow-500/30 rounded-2xl shadow-2xl shadow-yellow-500/10">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium text-gray-400">Valor Total de Vendas</CardTitle>
                        <DollarSign className="h-4 w-4 text-yellow-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-white">
                            {totalSalesValue.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                        </div>
                        <p className="text-xs text-gray-500 mt-1">Soma do valor bruto das transações pagas.</p>
                    </CardContent>
                </Card>
                <Card className="bg-black border border-yellow-500/30 rounded-2xl shadow-2xl shadow-yellow-500/10">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium text-gray-400">Total de Ingressos Vendidos</CardTitle>
                        <BarChart className="h-4 w-4 text-yellow-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-white">{totalTicketsSold}</div>
                        <p className="text-xs text-gray-500 mt-1">Quantidade de ingressos nas compras pagas.</p>
                    </CardContent>
                </Card>
                <Card className="bg-black border border-yellow-500/30 rounded-2xl shadow-2xl shadow-yellow-500/10">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium text-gray-400">Preço Médio (ponderado)</CardTitle>
                        <TrendingUp className="h-4 w-4 text-yellow-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-white">
                            {overallAverageTicket.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                        </div>
                        <p className="text-xs text-gray-500 mt-1">Valor total ÷ quantidade de ingressos (filtros atuais).</p>
                    </CardContent>
                </Card>
            </div>

            <Card className="bg-black border border-yellow-500/30 rounded-2xl shadow-2xl shadow-yellow-500/10 p-6">
                <CardHeader>
                    <CardTitle className="text-white text-xl">Detalhes de Vendas por Evento</CardTitle>
                    <CardDescription className="text-gray-400">
                        Por evento: preço médio = valor total ÷ ingressos vendidos naquele evento.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    {(isLoadingSales) ? (
                        <div className="text-center py-8 text-gray-500 flex items-center justify-center">
                            <BarChart className="h-6 w-6 animate-pulse mr-2" /> Carregando dados de vendas...
                        </div>
                    ) : (salesReports && salesReports.length > 0) ? (
                        <div className="overflow-x-auto">
                            <Table className="min-w-full">
                                <TableHeader>
                                    <TableRow className="border-b border-yellow-500/20 text-sm hover:bg-black/40">
                                        <TableHead className="text-left text-gray-400 font-semibold py-3">Evento</TableHead>
                                        <TableHead className="text-right text-gray-400 font-semibold py-3">Valor Total Vendas</TableHead>
                                        <TableHead className="text-right text-gray-400 font-semibold py-3">Ingressos Vendidos</TableHead>
                                        <TableHead className="text-right text-gray-400 font-semibold py-3">Preço Médio Ingresso</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {salesReports.map((report) => (
                                        <TableRow key={report.event_id} className="border-b border-yellow-500/10 hover:bg-black/40 transition-colors text-sm">
                                            <TableCell className="py-3 text-white font-medium truncate max-w-[200px]">{report.event_title}</TableCell>
                                            <TableCell className="py-3 text-right text-yellow-500">{report.total_sales_value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</TableCell>
                                            <TableCell className="py-3 text-right text-white">{report.total_tickets_sold}</TableCell>
                                            <TableCell className="py-3 text-right text-white">{report.average_ticket_price.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    ) : (
                        <div className="text-center py-8 text-gray-500">
                            Nenhum dado de vendas encontrado para os filtros selecionados.
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
};

export default SalesReports;
