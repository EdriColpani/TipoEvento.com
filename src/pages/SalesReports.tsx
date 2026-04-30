import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, BarChart, Download, DollarSign } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useProfile } from '@/hooks/use-profile';
import { showSuccess, showError } from '@/utils/toast';

interface Event {
    id: string;
    title: string;
}

interface SalesReportData {
    event_id: string;
    event_title: string;
    total_sales_value: number;
    total_tickets_sold: number;
    average_ticket_price: number;
}

const fetchEvents = async (): Promise<Event[]> => {
    const { data, error } = await supabase
        .from('events')
        .select('id, title')
        .order('title', { ascending: true });
    if (error) throw error;
    return data;
};

const fetchSalesReports = async (eventId: string | null, startDate: string | null, endDate: string | null): Promise<SalesReportData[]> => {
    let query = supabase
        .from('sales_reports_view') // Assumindo uma VIEW no Supabase para dados de vendas agregados
        .select('*');

    if (eventId) {
        query = query.eq('event_id', eventId);
    }
    if (startDate) {
        query = query.gte('sale_date', startDate);
    }
    if (endDate) {
        query = query.lte('sale_date', endDate);
    }

    const { data, error } = await query;
    if (error) throw error;
    return data;
};

const SalesReports: React.FC = () => {
    const navigate = useNavigate();
    const { profile } = useProfile();
    const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
    const [startDate, setStartDate] = useState<string>('');
    const [endDate, setEndDate] = useState<string>('');

    const { data: events, isLoading: isLoadingEvents } = useQuery<Event[]>({
        queryKey: ['sales_report_events'],
        queryFn: fetchEvents,
    });

    const formattedStartDate = startDate || null;
    const formattedEndDate = endDate || null;

    const { data: salesReports, isLoading: isLoadingSales } = useQuery<SalesReportData[]>({
        queryKey: ['sales_reports', selectedEventId, formattedStartDate, formattedEndDate],
        queryFn: () => fetchSalesReports(selectedEventId, formattedStartDate, formattedEndDate),
    });

    // Acesso restrito
    if (profile && profile.tipo_usuario_id !== 1 && profile.tipo_usuario_id !== 2) {
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

    const totalSalesValue = salesReports?.reduce((acc, report) => acc + report.total_sales_value, 0) || 0;
    const totalTicketsSold = salesReports?.reduce((acc, report) => acc + report.total_tickets_sold, 0) || 0;

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
        const rows = salesReports.map(report => [
            report.event_title,
            report.total_sales_value.toFixed(2).replace('.', ','),
            report.total_tickets_sold,
            report.average_ticket_price.toFixed(2).replace('.', ','),
        ]);

        const csvContent = [
            headers.join(';'),
            ...rows.map(row => row.join(';')),
        ].join('\n');

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
                    <CardDescription className="text-gray-400">Selecione o evento e/ou período para filtrar os dados.</CardDescription>
                </CardHeader>
                <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div>
                        <label htmlFor="event-filter" className="block text-sm font-medium text-gray-400 mb-2">Filtrar por Evento</label>
                        <Select onValueChange={(value) => setSelectedEventId(value === 'all' ? null : value)} value={selectedEventId || 'all'}>
                            <SelectTrigger className="w-full bg-black/60 border-yellow-500/30 text-white focus:ring-yellow-500 h-10">
                                <SelectValue className="text-white" placeholder="Todos os Eventos" />
                            </SelectTrigger>
                            <SelectContent className="bg-black border-yellow-500/30 text-white">
                                <SelectItem value="all" className="hover:bg-yellow-500/10 cursor-pointer">Todos os Eventos</SelectItem>
                                {isLoadingEvents ? (
                                    <SelectItem value="loading" disabled>Carregando eventos...</SelectItem>
                                ) : (
                                    events?.map(event => (
                                        <SelectItem key={event.id} value={event.id} className="hover:bg-yellow-500/10 cursor-pointer">
                                            {event.title}
                                        </SelectItem>
                                    ))
                                )}
                            </SelectContent>
                        </Select>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-400 mb-2">Período</label>
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

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                <Card className="bg-black border border-yellow-500/30 rounded-2xl shadow-2xl shadow-yellow-500/10">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium text-gray-400">Valor Total de Vendas</CardTitle>
                        <DollarSign className="h-4 w-4 text-yellow-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-white">{totalSalesValue.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</div>
                        <p className="text-xs text-gray-500 mt-1">Valor bruto de todas as vendas.</p>
                    </CardContent>
                </Card>
                <Card className="bg-black border border-yellow-500/30 rounded-2xl shadow-2xl shadow-yellow-500/10">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium text-gray-400">Total de Ingressos Vendidos</CardTitle>
                        <BarChart className="h-4 w-4 text-yellow-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-white">{totalTicketsSold}</div>
                        <p className="text-xs text-gray-500 mt-1">Quantidade total de ingressos que foram vendidos.</p>
                    </CardContent>
                </Card>
                {/* Outros cards de resumo podem ser adicionados aqui */}
            </div>

            <Card className="bg-black border border-yellow-500/30 rounded-2xl shadow-2xl shadow-yellow-500/10 p-6">
                <CardHeader>
                    <CardTitle className="text-white text-xl">Detalhes de Vendas por Evento</CardTitle>
                    <CardDescription className="text-gray-400">Visão detalhada das vendas agrupadas por evento.</CardDescription>
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

