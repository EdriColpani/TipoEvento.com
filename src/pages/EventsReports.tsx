import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, FileText, CalendarIcon, Download, Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { DateRange } from 'react-day-picker';
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import { supabase } from '@/integrations/supabase/client';
import { useProfile } from '@/hooks/use-profile';
import { useManagerEvents } from '@/hooks/use-manager-events';
import { useEventsReport } from '@/hooks/use-events-report';
import { showSuccess, showError } from '@/utils/toast';
import { formatEventDateForDisplay } from '@/utils/format-event-date';

const ADMIN_MASTER_USER_TYPE_ID = 1;
const MANAGER_PRO_USER_TYPE_ID = 2;

const EventReports: React.FC = () => {
    const navigate = useNavigate();
    const [userId, setUserId] = useState<string | undefined>(undefined);
    const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
    const [selectedStatus, setSelectedStatus] = useState<string | null>(null);
    const [dateRange, setDateRange] = useState<DateRange | undefined>({
        from: undefined,
        to: undefined,
    });

    useEffect(() => {
        supabase.auth.getUser().then(({ data: { user } }) => setUserId(user?.id));
    }, []);

    const { profile, isLoading: isLoadingProfile } = useProfile(userId);
    const isAdminMaster = profile?.tipo_usuario_id === ADMIN_MASTER_USER_TYPE_ID;
    const canAccess =
        profile?.tipo_usuario_id === ADMIN_MASTER_USER_TYPE_ID ||
        profile?.tipo_usuario_id === MANAGER_PRO_USER_TYPE_ID;

    const { events: eventsForFilter, isLoading: isLoadingEventsForFilter } = useManagerEvents(
        userId,
        isAdminMaster,
        { enabled: !!userId && !isLoadingProfile && !!profile && Boolean(canAccess) },
    );

    const formattedStartDate = dateRange?.from ? format(dateRange.from, 'yyyy-MM-dd') : null;
    const formattedEndDate = dateRange?.to ? format(dateRange.to, 'yyyy-MM-dd') : null;

    const reportFilters = useMemo(
        () => ({
            eventId: selectedEventId,
            status: selectedStatus,
            startDate: formattedStartDate,
            endDate: formattedEndDate,
        }),
        [selectedEventId, selectedStatus, formattedStartDate, formattedEndDate],
    );

    const {
        data: eventReports = [],
        isLoading: isLoadingEventReports,
        isError: isReportError,
    } = useEventsReport(userId, isAdminMaster, reportFilters, Boolean(canAccess));

    useEffect(() => {
        if (isReportError) showError('Erro ao carregar relatório de eventos.');
    }, [isReportError]);

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
                <p className="text-gray-400 mb-6">Não foi possível carregar seu perfil.</p>
                <Button onClick={() => navigate('/manager/dashboard')} className="bg-yellow-500 text-black hover:bg-yellow-600">
                    Voltar ao Dashboard
                </Button>
            </div>
        );
    }

    if (profile.tipo_usuario_id !== ADMIN_MASTER_USER_TYPE_ID && profile.tipo_usuario_id !== MANAGER_PRO_USER_TYPE_ID) {
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

    const handleExportCsv = () => {
        if (!eventReports || eventReports.length === 0) {
            showError('Nenhum dado para exportar.');
            return;
        }

        const headers = [
            'Evento',
            'Status',
            'Data Início',
            'Data Fim',
            'Local',
            'Empresa',
            'Total de Pulseiras Geradas',
            'Total de Pulseiras Vendidas',
            'Percentual de Ocupação',
        ];
        const rows = eventReports.map((report) => [
            report.event_title,
            report.status,
            formatEventDateForDisplay(report.start_date) || report.start_date,
            report.end_date ? formatEventDateForDisplay(report.end_date) || report.end_date : '—',
            report.location,
            report.company_name,
            report.total_wristbands_generated,
            report.total_wristbands_sold,
            report.occupancy_percentage.toFixed(2) + '%',
        ]);

        const csvContent = [headers.join(';'), ...rows.map((row) => row.join(';'))].join('\n');

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.setAttribute('download', 'relatorio_eventos.csv');
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        showSuccess('Relatório exportado com sucesso!');
    };

    return (
        <div className="max-w-7xl mx-auto p-4 sm:p-6 lg:p-8">
            <div className="flex items-center justify-between mb-8">
                <h1 className="text-2xl sm:text-3xl font-serif text-yellow-500 flex items-center">
                    <FileText className="h-7 w-7 mr-3" />
                    Relatório de Eventos
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
                        Lista só os eventos que você pode gerir (como na tela de eventos). “Geradas” = ingressos individuais criados nos
                        lotes; “Vendidas” = já atribuídas a um comprador.
                    </CardDescription>
                </CardHeader>
                <CardContent className="grid grid-cols-1 md:grid-cols-4 gap-6">
                    <div>
                        <label htmlFor="event-filter" className="block text-sm font-medium text-gray-400 mb-2">Filtrar por Evento</label>
                        <Select onValueChange={(value) => setSelectedEventId(value === 'all' ? null : value)} value={selectedEventId || 'all'}>
                            <SelectTrigger className="w-full bg-black/60 border-yellow-500/30 text-white focus:ring-yellow-500 h-10">
                                <SelectValue className="text-white" placeholder="Todos os Eventos" />
                            </SelectTrigger>
                            <SelectContent className="bg-black border-yellow-500/30 text-white">
                                <SelectItem value="all" className="hover:bg-yellow-500/10 cursor-pointer">Todos os Eventos</SelectItem>
                                {isLoadingEventsForFilter ? (
                                    <SelectItem value="loading" disabled>Carregando eventos...</SelectItem>
                                ) : (
                                    eventsForFilter?.map((event) => (
                                        <SelectItem key={event.id} value={event.id} className="hover:bg-yellow-500/10 cursor-pointer">
                                            {event.title}
                                        </SelectItem>
                                    ))
                                )}
                            </SelectContent>
                        </Select>
                    </div>

                    <div>
                        <label htmlFor="status-filter" className="block text-sm font-medium text-gray-400 mb-2">Filtrar por Status</label>
                        <Select onValueChange={(value) => setSelectedStatus(value === 'all' ? null : value)} value={selectedStatus || 'all'}>
                            <SelectTrigger className="w-full bg-black/60 border-yellow-500/30 text-white focus:ring-yellow-500 h-10">
                                <SelectValue className="text-white" placeholder="Todos os Status" />
                            </SelectTrigger>
                            <SelectContent className="bg-black border-yellow-500/30 text-white">
                                <SelectItem value="all" className="hover:bg-yellow-500/10 cursor-pointer">Todos os Status</SelectItem>
                                <SelectItem value="pending" className="hover:bg-yellow-500/10 cursor-pointer">Pendente</SelectItem>
                                <SelectItem value="active" className="hover:bg-yellow-500/10 cursor-pointer">Publicado</SelectItem>
                                <SelectItem value="inactive" className="hover:bg-yellow-500/10 cursor-pointer">Desativado</SelectItem>
                                <SelectItem value="finished" className="hover:bg-yellow-500/10 cursor-pointer">Finalizado (data passada)</SelectItem>
                                <SelectItem value="cancelled" className="hover:bg-yellow-500/10 cursor-pointer">Cancelado</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="grid gap-2">
                        <label className="block text-sm font-medium text-gray-400 mb-2">Período (data do evento)</label>
                        <Popover>
                            <PopoverTrigger asChild>
                                <Button
                                    id="date"
                                    variant={"outline"}
                                    className={cn(
                                        "w-full justify-start text-left font-normal bg-black/60 border-yellow-500/30 text-white hover:bg-yellow-500/10",
                                        !dateRange?.from && "text-muted-foreground"
                                    )}
                                >
                                    <CalendarIcon className="mr-2 h-4 w-4 text-yellow-500" />
                                    {dateRange?.from ? (
                                        dateRange.to ? (
                                            <>{format(dateRange.from, "dd/MM/yyyy", { locale: ptBR })} - {format(dateRange.to, "dd/MM/yyyy", { locale: ptBR })}</>
                                        ) : (
                                            format(dateRange.from, "dd/MM/yyyy", { locale: ptBR })
                                        )
                                    ) : (
                                        <span className="text-gray-500">Selecione um período</span>
                                    )}
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0 bg-black border-yellow-500/30 text-white" align="start">
                                <Calendar
                                    initialFocus
                                    mode="range"
                                    defaultMonth={dateRange?.from}
                                    selected={dateRange}
                                    onSelect={setDateRange}
                                    numberOfMonths={2}
                                    locale={ptBR}
                                    className="bg-black text-white"
                                />
                            </PopoverContent>
                        </Popover>
                    </div>

                    <div className="flex items-end">
                        <Button onClick={handleExportCsv} className="w-full bg-yellow-500 text-black hover:bg-yellow-600">
                            <Download className="mr-2 h-4 w-4" />
                            Exportar CSV
                        </Button>
                    </div>
                </CardContent>
            </Card>

            <Card className="bg-black border border-yellow-500/30 rounded-2xl shadow-2xl shadow-yellow-500/10 p-6">
                <CardHeader>
                    <CardTitle className="text-white text-xl">Detalhes dos Eventos</CardTitle>
                    <CardDescription className="text-gray-400">
                        Visão por evento: ocupação = vendidas ÷ geradas (ingressos individuais nos lotes).
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    {(isLoadingEventReports) ? (
                        <div className="text-center py-8 text-gray-500 flex items-center justify-center">
                            <FileText className="h-6 w-6 animate-pulse mr-2" /> Carregando dados de eventos...
                        </div>
                    ) : (eventReports && eventReports.length > 0) ? (
                        <div className="overflow-x-auto">
                            <Table className="min-w-full">
                                <TableHeader>
                                    <TableRow className="border-b border-yellow-500/20 text-sm hover:bg-black/40">
                                        <TableHead className="text-left text-gray-400 font-semibold py-3">Evento</TableHead>
                                        <TableHead className="text-left text-gray-400 font-semibold py-3">Empresa</TableHead>
                                        <TableHead className="text-center text-gray-400 font-semibold py-3">Status</TableHead>
                                        <TableHead className="text-center text-gray-400 font-semibold py-3">Início</TableHead>
                                        <TableHead className="text-center text-gray-400 font-semibold py-3">Fim</TableHead>
                                        <TableHead className="text-left text-gray-400 font-semibold py-3">Local</TableHead>
                                        <TableHead className="text-right text-gray-400 font-semibold py-3">Pulseiras Geradas</TableHead>
                                        <TableHead className="text-right text-gray-400 font-semibold py-3">Pulseiras Vendidas</TableHead>
                                        <TableHead className="text-right text-gray-400 font-semibold py-3">% Ocupação</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {eventReports.map((report) => (
                                        <TableRow key={report.event_id} className="border-b border-yellow-500/10 hover:bg-black/40 transition-colors text-sm">
                                            <TableCell className="py-3 text-white font-medium truncate max-w-[150px]">{report.event_title}</TableCell>
                                            <TableCell className="py-3 text-white font-medium truncate max-w-[150px]">{report.company_name}</TableCell>
                                            <TableCell className="py-3 text-center text-yellow-500">{report.status}</TableCell>
                                            <TableCell className="py-3 text-center text-white">{formatEventDateForDisplay(report.start_date) || '—'}</TableCell>
                                            <TableCell className="py-3 text-center text-white">{report.end_date ? formatEventDateForDisplay(report.end_date) || '—' : '—'}</TableCell>
                                            <TableCell className="py-3 text-white truncate max-w-[150px]">{report.location}</TableCell>
                                            <TableCell className="py-3 text-right text-white">{report.total_wristbands_generated}</TableCell>
                                            <TableCell className="py-3 text-right text-white">{report.total_wristbands_sold}</TableCell>
                                            <TableCell className="py-3 text-right text-yellow-500">{(report.occupancy_percentage ?? 0).toFixed(2)}%</TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    ) : (
                        <div className="text-center py-8 text-gray-500">
                            Nenhum dado de eventos encontrado para os filtros selecionados.
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
};

export default EventReports;
