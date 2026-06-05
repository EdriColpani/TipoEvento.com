import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ArrowLeft, Download, Loader2, Ticket } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useProfile } from '@/hooks/use-profile';
import { useAdminCompaniesTicketInventoryReport } from '@/hooks/use-admin-companies-ticket-inventory-report';
import { showError, showSuccess } from '@/utils/toast';
import { formatEventDateForDisplay } from '@/utils/format-event-date';

const ADMIN_MASTER_USER_TYPE_ID = 1;

const AdminCompaniesTicketInventoryReport: React.FC = () => {
    const navigate = useNavigate();
    const [userId, setUserId] = useState<string | undefined>();
    const [selectedCompanyId, setSelectedCompanyId] = useState<string>('all');
    const [searchTerm, setSearchTerm] = useState('');

    useEffect(() => {
        supabase.auth.getUser().then(({ data: { user } }) => setUserId(user?.id));
    }, []);

    const { profile, isLoading: isLoadingProfile } = useProfile(userId);
    const isAdminMaster = profile?.tipo_usuario_id === ADMIN_MASTER_USER_TYPE_ID;

    const { data: allCompanies = [], isLoading, isError } = useAdminCompaniesTicketInventoryReport(
        null,
        Boolean(isAdminMaster),
    );

    const companies = useMemo(() => {
        if (selectedCompanyId === 'all') return allCompanies;
        return allCompanies.filter((c) => c.company_id === selectedCompanyId);
    }, [allCompanies, selectedCompanyId]);

    const visibleCompanies = useMemo(() => {
        const term = searchTerm.trim().toLowerCase();
        if (!term) return companies;
        return companies.filter((c) => {
            const name = `${c.company_name} ${c.corporate_name ?? ''}`.toLowerCase();
            return name.includes(term);
        });
    }, [companies, searchTerm]);

    const grandTotals = useMemo(
        () =>
            visibleCompanies.reduce(
                (acc, c) => ({
                    tickets_created: acc.tickets_created + (c.totals?.tickets_created ?? 0),
                    tickets_sold: acc.tickets_sold + (c.totals?.tickets_sold ?? 0),
                    tickets_available: acc.tickets_available + (c.totals?.tickets_available ?? 0),
                }),
                { tickets_created: 0, tickets_sold: 0, tickets_available: 0 },
            ),
        [visibleCompanies],
    );

    useEffect(() => {
        if (isError) showError('Erro ao carregar relatório de estoque de ingressos.');
    }, [isError]);

    const handleExportCsv = () => {
        if (visibleCompanies.length === 0) {
            showError('Nenhum dado para exportar.');
            return;
        }

        const header = [
            'Empresa',
            'Plano',
            'Evento',
            'Data',
            'Status',
            'Ingressos criados',
            'Ingressos vendidos',
            'A vender',
        ];
        const rows: string[][] = [];

        for (const company of visibleCompanies) {
            if (company.events.length === 0) {
                rows.push([
                    company.company_name,
                    company.billing_plan ?? '',
                    '—',
                    '—',
                    '—',
                    String(company.totals?.tickets_created ?? 0),
                    String(company.totals?.tickets_sold ?? 0),
                    String(company.totals?.tickets_available ?? 0),
                ]);
                continue;
            }
            for (const ev of company.events) {
                let status = 'Publicado';
                if (ev.is_draft) status = 'Rascunho';
                else if (!ev.is_active) status = 'Desativado';
                rows.push([
                    company.company_name,
                    company.billing_plan ?? '',
                    ev.event_title,
                    ev.event_date ? formatEventDateForDisplay(ev.event_date) : '—',
                    status,
                    String(ev.tickets_created),
                    String(ev.tickets_sold),
                    String(ev.tickets_available),
                ]);
            }
        }

        const csv = [header, ...rows]
            .map((line) => line.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(';'))
            .join('\n');

        const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `estoque-ingressos-empresas-${new Date().toISOString().slice(0, 10)}.csv`;
        link.click();
        URL.revokeObjectURL(url);
        showSuccess('CSV exportado.');
    };

    if (!userId || isLoadingProfile) {
        return (
            <div className="max-w-7xl mx-auto flex flex-col items-center justify-center py-24 text-gray-400">
                <Loader2 className="h-10 w-10 animate-spin text-yellow-500 mb-4" />
                <p>Carregando sessão...</p>
            </div>
        );
    }

    if (!isAdminMaster) {
        return (
            <div className="max-w-7xl mx-auto text-center py-20">
                <h1 className="text-3xl font-serif text-red-500 mb-4">Acesso negado</h1>
                <p className="text-gray-400">Este relatório é exclusivo do Admin Master.</p>
                <Button
                    onClick={() => navigate('/manager/reports')}
                    className="mt-4 bg-yellow-500 text-black hover:bg-yellow-600"
                >
                    Voltar aos relatórios
                </Button>
            </div>
        );
    }

    const loading = isLoading;

    return (
        <div className="max-w-7xl mx-auto space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <h1 className="text-2xl sm:text-3xl font-serif text-yellow-500 flex items-center gap-3">
                        <Ticket className="h-7 w-7" />
                        Estoque de ingressos por empresa
                    </h1>
                    <p className="text-gray-400 text-sm mt-2">
                        Visão consolidada: ingressos criados, vendidos e ainda disponíveis para venda, por evento.
                    </p>
                </div>
                <div className="flex flex-wrap gap-2">
                    <Button
                        variant="outline"
                        className="bg-black/60 border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10"
                        onClick={() => navigate('/manager/reports')}
                    >
                        <ArrowLeft className="mr-2 h-4 w-4" />
                        Voltar
                    </Button>
                    <Button
                        className="bg-yellow-500 text-black hover:bg-yellow-600"
                        onClick={handleExportCsv}
                        disabled={loading || visibleCompanies.length === 0}
                    >
                        <Download className="mr-2 h-4 w-4" />
                        Exportar CSV
                    </Button>
                </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <Card className="bg-black border-yellow-500/30">
                    <CardHeader className="pb-2">
                        <CardDescription className="text-gray-400">Total criados</CardDescription>
                        <CardTitle className="text-white text-2xl">{grandTotals.tickets_created}</CardTitle>
                    </CardHeader>
                </Card>
                <Card className="bg-black border-yellow-500/30">
                    <CardHeader className="pb-2">
                        <CardDescription className="text-gray-400">Total vendidos</CardDescription>
                        <CardTitle className="text-white text-2xl">{grandTotals.tickets_sold}</CardTitle>
                    </CardHeader>
                </Card>
                <Card className="bg-black border-yellow-500/30">
                    <CardHeader className="pb-2">
                        <CardDescription className="text-gray-400">Total a vender</CardDescription>
                        <CardTitle className="text-white text-2xl">{grandTotals.tickets_available}</CardTitle>
                    </CardHeader>
                </Card>
            </div>

            <Card className="bg-black border-yellow-500/30">
                <CardContent className="pt-6 flex flex-col sm:flex-row gap-4">
                    <Input
                        placeholder="Buscar empresa..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="bg-black/60 border-yellow-500/30 text-white max-w-md"
                    />
                    <Select value={selectedCompanyId} onValueChange={setSelectedCompanyId}>
                        <SelectTrigger className="bg-black/60 border-yellow-500/30 text-white max-w-md">
                            <SelectValue placeholder="Filtrar empresa" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">Todas as empresas</SelectItem>
                            {allCompanies.map((c) => (
                                <SelectItem key={c.company_id} value={c.company_id}>
                                    {c.company_name}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </CardContent>
            </Card>

            {loading ? (
                <div className="text-center py-16 text-gray-400">
                    <Loader2 className="h-8 w-8 animate-spin text-yellow-500 mx-auto mb-3" />
                    Carregando relatório...
                </div>
            ) : visibleCompanies.length === 0 ? (
                <p className="text-gray-400 text-center py-12">Nenhuma empresa encontrada.</p>
            ) : (
                visibleCompanies.map((company) => (
                    <Card key={company.company_id} className="bg-black border-yellow-500/30 overflow-hidden">
                        <CardHeader className="border-b border-yellow-500/20 bg-yellow-500/5">
                            <CardTitle className="text-yellow-500 text-lg">{company.company_name}</CardTitle>
                            <CardDescription className="text-gray-400">
                                Plano: {company.billing_plan ?? '—'} · Totais: {company.totals?.tickets_created ?? 0}{' '}
                                criados · {company.totals?.tickets_sold ?? 0} vendidos ·{' '}
                                {company.totals?.tickets_available ?? 0} a vender
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="p-0">
                            {company.events.length === 0 ? (
                                <p className="text-gray-500 text-sm p-6">Nenhum evento cadastrado.</p>
                            ) : (
                                <div className="overflow-x-auto">
                                    <Table>
                                        <TableHeader>
                                            <TableRow className="border-yellow-500/20 hover:bg-transparent">
                                                <TableHead className="text-gray-400">Evento</TableHead>
                                                <TableHead className="text-gray-400">Data</TableHead>
                                                <TableHead className="text-gray-400">Status</TableHead>
                                                <TableHead className="text-gray-400 text-right">Criados</TableHead>
                                                <TableHead className="text-gray-400 text-right">Vendidos</TableHead>
                                                <TableHead className="text-gray-400 text-right">A vender</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {company.events.map((ev) => {
                                                let status = 'Publicado';
                                                let statusClass = 'text-green-400';
                                                if (ev.is_draft) {
                                                    status = 'Rascunho';
                                                    statusClass = 'text-gray-400';
                                                } else if (!ev.is_active) {
                                                    status = 'Desativado';
                                                    statusClass = 'text-orange-300';
                                                }
                                                return (
                                                    <TableRow
                                                        key={ev.event_id}
                                                        className="border-yellow-500/10"
                                                    >
                                                        <TableCell className="text-white font-medium">
                                                            {ev.event_title}
                                                        </TableCell>
                                                        <TableCell className="text-gray-300">
                                                            {ev.event_date
                                                                ? formatEventDateForDisplay(ev.event_date)
                                                                : '—'}
                                                        </TableCell>
                                                        <TableCell className={statusClass}>{status}</TableCell>
                                                        <TableCell className="text-right text-gray-200">
                                                            {ev.tickets_created}
                                                        </TableCell>
                                                        <TableCell className="text-right text-gray-200">
                                                            {ev.tickets_sold}
                                                        </TableCell>
                                                        <TableCell className="text-right text-cyan-300">
                                                            {ev.tickets_available}
                                                        </TableCell>
                                                    </TableRow>
                                                );
                                            })}
                                        </TableBody>
                                    </Table>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                ))
            )}
        </div>
    );
};

export default AdminCompaniesTicketInventoryReport;
