import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, Users, CalendarIcon, Search, Download } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { DateRange } from 'react-day-picker';
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useProfile } from '@/hooks/use-profile';
import { showSuccess, showError } from '@/utils/toast';

interface Event {
    id: string;
    title: string;
}

interface AudienceReportData {
    client_user_id: string;
    first_name: string;
    last_name: string;
    email: string;
    cpf: string | null;
    gender: string | null;
    birth_date: string | null;
    total_tickets_purchased: number;
    events_attended: string[]; // Nomes dos eventos
}

const fetchEventsForFilter = async (): Promise<Event[]> => {
    const { data, error } = await supabase
        .from('events')
        .select('id, title')
        .order('title', { ascending: true });
    if (error) throw error;
    return data;
};

const fetchAudienceReports = async (eventId: string | null, gender: string | null, minAge: number | null, maxAge: number | null, startDate: string | null, endDate: string | null): Promise<AudienceReportData[]> => {
    let query = supabase
        .from('audience_reports_view') // Assumindo uma VIEW no Supabase para dados de público agregados
        .select('*');

    if (eventId) {
        query = query.filter('events_attended', 'cs', `{${eventId}}`); // Filtra array de IDs de eventos
    }
    if (gender) {
        query = query.eq('gender', gender);
    }
    if (minAge) {
        query = query.gte('age', minAge);
    }
    if (maxAge) {
        query = query.lte('age', maxAge);
    }
    if (startDate) {
        query = query.gte('first_purchase_date', startDate);
    }
    if (endDate) {
        query = query.lte('last_purchase_date', endDate);
    }

    const { data, error } = await query;
    if (error) throw error;
    return data;
};

const AudienceReports: React.FC = () => {
    const navigate = useNavigate();
    const { profile } = useProfile();
    const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
    const [selectedGender, setSelectedGender] = useState<string | null>(null);
    const [minAge, setMinAge] = useState<string>('');
    const [maxAge, setMaxAge] = useState<string>('');
    const [dateRange, setDateRange] = useState<DateRange | undefined>({
        from: undefined,
        to: undefined,
    });

    const { data: eventsForFilter, isLoading: isLoadingEventsForFilter } = useQuery<Event[]>({
        queryKey: ['audience_report_events'],
        queryFn: fetchEventsForFilter,
    });

    const formattedStartDate = dateRange?.from ? format(dateRange.from, 'yyyy-MM-dd') : null;
    const formattedEndDate = dateRange?.to ? format(dateRange.to, 'yyyy-MM-dd') : null;

    const numericMinAge = minAge ? parseInt(minAge, 10) : null;
    const numericMaxAge = maxAge ? parseInt(maxAge, 10) : null;

    const { data: audienceReports, isLoading: isLoadingAudienceReports } = useQuery<AudienceReportData[]>({
        queryKey: ['audience_reports', selectedEventId, selectedGender, numericMinAge, numericMaxAge, formattedStartDate, formattedEndDate],
        queryFn: () => fetchAudienceReports(selectedEventId, selectedGender, numericMinAge, numericMaxAge, formattedStartDate, formattedEndDate),
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

    const handleExportCsv = () => {
        if (!audienceReports || audienceReports.length === 0) {
            showError('Nenhum dado para exportar.');
            return;
        }

        const headers = [
            'Nome',
            'Email',
            'CPF',
            'Gênero',
            'Data de Nascimento',
            'Total de Ingressos Comprados',
            'Eventos Participados',
        ];
        const rows = audienceReports.map(report => [
            `${report.first_name} ${report.last_name}`,
            report.email,
            report.cpf || 'N/A',
            report.gender || 'N/A',
            report.birth_date ? format(new Date(report.birth_date), 'dd/MM/yyyy', { locale: ptBR }) : 'N/A',
            report.total_tickets_purchased,
            report.events_attended.join(', '),
        ]);

        const csvContent = [
            headers.join(';'),
            ...rows.map(row => row.join(';'))
        ].join('\n');

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.setAttribute('download', 'relatorio_publico.csv');
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        showSuccess('Relatório exportado com sucesso!');
    };

    return (
        <div className="max-w-7xl mx-auto p-4 sm:p-6 lg:p-8">
            <div className="flex items-center justify-between mb-8">
                <h1 className="text-2xl sm:text-3xl font-serif text-yellow-500 flex items-center">
                    <Users className="h-7 w-7 mr-3" />
                    Relatório de Público
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
                    <CardDescription className="text-gray-400">Selecione o evento, demografia e/ou período de compra para filtrar os dados.</CardDescription>
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
                                    eventsForFilter?.map(event => (
                                        <SelectItem key={event.id} value={event.id} className="hover:bg-yellow-500/10 cursor-pointer">
                                            {event.title}
                                        </SelectItem>
                                    ))
                                )}
                            </SelectContent>
                        </Select>
                    </div>

                    <div>
                        <label htmlFor="gender-filter" className="block text-sm font-medium text-gray-400 mb-2">Filtrar por Gênero</label>
                        <Select onValueChange={(value) => setSelectedGender(value === 'all' ? null : value)} value={selectedGender || 'all'}>
                            <SelectTrigger className="w-full bg-black/60 border-yellow-500/30 text-white focus:ring-yellow-500 h-10">
                                <SelectValue className="text-white" placeholder="Todos os Gêneros" />
                            </SelectTrigger>
                            <SelectContent className="bg-black border-yellow-500/30 text-white">
                                <SelectItem value="all" className="hover:bg-yellow-500/10 cursor-pointer">Todos os Gêneros</SelectItem>
                                <SelectItem value="Masculino" className="hover:bg-yellow-500/10 cursor-pointer">Masculino</SelectItem>
                                <SelectItem value="Feminino" className="hover:bg-yellow-500/10 cursor-pointer">Feminino</SelectItem>
                                <SelectItem value="Outro" className="hover:bg-yellow-500/10 cursor-pointer">Outro</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    <div>
                        <label htmlFor="min-age" className="block text-sm font-medium text-gray-400 mb-2">Idade Mínima</label>
                        <Input 
                            id="min-age" 
                            type="number" 
                            placeholder="Min" 
                            value={minAge} 
                            onChange={(e) => setMinAge(e.target.value)}
                            className="bg-black/60 border-yellow-500/30 text-white placeholder-gray-500 focus:border-yellow-500"
                        />
                    </div>
                    <div>
                        <label htmlFor="max-age" className="block text-sm font-medium text-gray-400 mb-2">Idade Máxima</label>
                        <Input 
                            id="max-age" 
                            type="number" 
                            placeholder="Max" 
                            value={maxAge} 
                            onChange={(e) => setMaxAge(e.target.value)}
                            className="bg-black/60 border-yellow-500/30 text-white placeholder-gray-500 focus:border-yellow-500"
                        />
                    </div>

                    <div className="grid gap-2 col-span-2">
                        <label className="block text-sm font-medium text-gray-400 mb-2">Período de Compra</label>
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

                    <div className="flex items-end col-span-full md:col-span-1">
                        <Button onClick={handleExportCsv} className="w-full bg-yellow-500 text-black hover:bg-yellow-600">
                            <Download className="mr-2 h-4 w-4" />
                            Exportar CSV
                        </Button>
                    </div>
                </CardContent>
            </Card>

            <Card className="bg-black border border-yellow-500/30 rounded-2xl shadow-2xl shadow-yellow-500/10 p-6">
                <CardHeader>
                    <CardTitle className="text-white text-xl">Detalhes do Público</CardTitle>
                    <CardDescription className="text-gray-400">Visão detalhada dos clientes que compraram ingressos.</CardDescription>
                </CardHeader>
                <CardContent>
                    {(isLoadingAudienceReports) ? (
                        <div className="text-center py-8 text-gray-500 flex items-center justify-center">
                            <Users className="h-6 w-6 animate-pulse mr-2" /> Carregando dados do público...
                        </div>
                    ) : (audienceReports && audienceReports.length > 0) ? (
                        <div className="overflow-x-auto">
                            <Table className="min-w-full">
                                <TableHeader>
                                    <TableRow className="border-b border-yellow-500/20 text-sm hover:bg-black/40">
                                        <TableHead className="text-left text-gray-400 font-semibold py-3">Nome Completo</TableHead>
                                        <TableHead className="text-left text-gray-400 font-semibold py-3">Email</TableHead>
                                        <TableHead className="text-left text-gray-400 font-semibold py-3">CPF</TableHead>
                                        <TableHead className="text-center text-gray-400 font-semibold py-3">Gênero</TableHead>
                                        <TableHead className="text-center text-gray-400 font-semibold py-3">Data Nasc.</TableHead>
                                        <TableHead className="text-right text-gray-400 font-semibold py-3">Ingressos Comprados</TableHead>
                                        <TableHead className="text-left text-gray-400 font-semibold py-3">Eventos</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {audienceReports.map((report) => (
                                        <TableRow key={report.client_user_id} className="border-b border-yellow-500/10 hover:bg-black/40 transition-colors text-sm">
                                            <TableCell className="py-3 text-white font-medium truncate max-w-[150px]">{`${report.first_name} ${report.last_name}`}</TableCell>
                                            <TableCell className="py-3 text-yellow-500 font-medium truncate max-w-[150px]">{report.email}</TableCell>
                                            <TableCell className="py-3 text-white truncate max-w-[100px]">{report.cpf || 'N/A'}</TableCell>
                                            <TableCell className="py-3 text-center text-white">{report.gender || 'N/A'}</TableCell>
                                            <TableCell className="py-3 text-center text-white">{report.birth_date ? format(new Date(report.birth_date), 'dd/MM/yyyy', { locale: ptBR }) : 'N/A'}</TableCell>
                                            <TableCell className="py-3 text-right text-yellow-500">{report.total_tickets_purchased}</TableCell>
                                            <TableCell className="py-3 text-white truncate max-w-[200px]">{report.events_attended.join(', ')}</TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    ) : (
                        <div className="text-center py-8 text-gray-500">
                            Nenhum dado de público encontrado para os filtros selecionados.
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
};

export default AudienceReports;
