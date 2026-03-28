import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, DollarSign, TrendingUp, Users, Loader2, AlertCircle, Download, Eye } from 'lucide-react';
import { useFinancialReports, FinancialReportData } from '@/hooks/use-financial-reports';
import { useManagerEvents } from '@/hooks/use-manager-events';
import { useProfile } from '@/hooks/use-profile';
import { supabase } from '@/integrations/supabase/client';
import { showError } from '@/utils/toast';
import { formatEventDateForDisplay } from '@/utils/format-event-date';

const ADMIN_MASTER_USER_TYPE_ID = 1;
const MANAGER_PRO_USER_TYPE_ID = 2;

const FinancialReports: React.FC = () => {
    const navigate = useNavigate();
    const [userId, setUserId] = useState<string | undefined>(undefined);
    const [selectedEventId, setSelectedEventId] = useState<string>('all');
    const [startDate, setStartDate] = useState<string>('');
    const [endDate, setEndDate] = useState<string>('');

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
    };

    const { data: reportData, isLoading: isLoadingReports, isError } = useFinancialReports(filters);

    // Calcular totais gerais
    const totals = reportData ? {
        totalVendas: reportData.reduce((sum, item) => sum + item.quantidade_vendas, 0),
        totalIngressos: reportData.reduce((sum, item) => sum + item.quantidade_ingressos_vendidos, 0),
        totalVendido: reportData.reduce((sum, item) => sum + item.valor_total_vendido, 0),
        totalOrganizador: reportData.reduce((sum, item) => sum + item.valor_liquido_organizador, 0),
        totalComissao: reportData.reduce((sum, item) => sum + item.comissao_total_sistema, 0),
    } : null;

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

