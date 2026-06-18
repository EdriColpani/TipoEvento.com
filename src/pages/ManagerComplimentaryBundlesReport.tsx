import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
    ArrowLeft,
    ChevronDown,
    ChevronRight,
    Download,
    Gift,
    Loader2,
    Search,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
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
import { supabase } from '@/integrations/supabase/client';
import { useProfile } from '@/hooks/use-profile';
import { showError, showSuccess } from '@/utils/toast';
import { parseEventLocalDay } from '@/utils/format-event-date';

const ADMIN_MASTER = 1;
const MANAGER_PRO = 2;

type ReportSeat = {
    seat_number: number;
    status: string;
    redeemed_at: string | null;
    redeemer_name: string | null;
    redeemer_email: string | null;
    ticket_code: string | null;
    analytics_id: string | null;
};

type ReportRow = {
    bundle_id: string;
    event_id: string;
    event_title: string;
    event_date: string | null;
    batch_name: string;
    recipient_name: string;
    recipient_email: string | null;
    quantity: number;
    redeemed_count: number;
    available_count: number;
    status: string;
    expires_at: string;
    created_at: string;
    holder_claimed: boolean;
    holder_claimed_at: string | null;
    email_sent_at: string | null;
    notes: string | null;
    seats: ReportSeat[];
};

type ReportSummary = {
    total_bundles: number;
    active_bundles: number;
    total_seats: number;
    redeemed_seats: number;
    pending_seats: number;
};

type EventFilter = { id: string; title: string };

const STATUS_LABELS: Record<string, string> = {
    active: 'Ativo',
    expired: 'Expirado',
    cancelled: 'Cancelado',
    fully_redeemed: 'Totalmente resgatado',
};

const SEAT_STATUS_LABELS: Record<string, string> = {
    available: 'Disponível',
    redeemed: 'Resgatado',
    cancelled: 'Cancelado',
};

async function fetchReportEvents(): Promise<EventFilter[]> {
    const { data, error } = await supabase.rpc('list_manager_complimentary_report_events');
    if (error) throw error;
    const payload = data as { ok?: boolean; events?: EventFilter[]; error?: string };
    if (!payload?.ok) throw new Error(payload?.error ?? 'Erro ao carregar eventos.');
    return payload.events ?? [];
}

async function fetchReport(input: {
    eventId: string | null;
    status: string | null;
    search: string;
}): Promise<{ summary: ReportSummary; rows: ReportRow[] }> {
    const { data, error } = await supabase.rpc('get_manager_complimentary_bundles_report', {
        p_event_id: input.eventId,
        p_status: input.status,
        p_search: input.search.trim() || null,
    });
    if (error) throw error;
    const payload = data as {
        ok?: boolean;
        error?: string;
        summary?: ReportSummary;
        rows?: ReportRow[];
    };
    if (!payload?.ok) {
        throw new Error(payload?.error ?? 'Erro ao carregar relatório.');
    }
    return {
        summary: payload.summary ?? {
            total_bundles: 0,
            active_bundles: 0,
            total_seats: 0,
            redeemed_seats: 0,
            pending_seats: 0,
        },
        rows: payload.rows ?? [],
    };
}

const formatDate = (value: string | null | undefined) => {
    if (!value) return '—';
    const d = value.includes('T') ? new Date(value) : parseEventLocalDay(value);
    if (!d) return '—';
    return d.toLocaleDateString('pt-BR');
};

const formatDateTime = (value: string | null | undefined) => {
    if (!value) return '—';
    return new Date(value).toLocaleString('pt-BR');
};

const ManagerComplimentaryBundlesReport: React.FC = () => {
    const navigate = useNavigate();
    const [userId, setUserId] = useState<string | undefined>();
    const [selectedEventId, setSelectedEventId] = useState<string>('all');
    const [selectedStatus, setSelectedStatus] = useState<string>('all');
    const [searchTerm, setSearchTerm] = useState('');
    const [expandedBundleId, setExpandedBundleId] = useState<string | null>(null);

    useEffect(() => {
        void supabase.auth.getUser().then(({ data: { user } }) => setUserId(user?.id));
    }, []);

    const { profile, isLoading: loadingProfile } = useProfile(userId);
    const isAdminMaster = profile?.tipo_usuario_id === ADMIN_MASTER;
    const isManagerPro = profile?.tipo_usuario_id === MANAGER_PRO;

    const eventsQuery = useQuery({
        queryKey: ['complimentaryReportEvents'],
        queryFn: fetchReportEvents,
        enabled: isManagerPro && !isAdminMaster,
    });

    const reportQuery = useQuery({
        queryKey: ['complimentaryReport', selectedEventId, selectedStatus, searchTerm],
        queryFn: () =>
            fetchReport({
                eventId: selectedEventId === 'all' ? null : selectedEventId,
                status: selectedStatus === 'all' ? null : selectedStatus,
                search: searchTerm,
            }),
        enabled: isManagerPro && !isAdminMaster,
    });

    const flatExportRows = useMemo(() => {
        const lines: Array<Record<string, string>> = [];
        for (const bundle of reportQuery.data?.rows ?? []) {
            for (const seat of bundle.seats ?? []) {
                lines.push({
                    evento: bundle.event_title,
                    lote: bundle.batch_name,
                    destinatario: bundle.recipient_name,
                    email_destinatario: bundle.recipient_email ?? '',
                    status_pacote: STATUS_LABELS[bundle.status] ?? bundle.status,
                    ingresso_numero: String(seat.seat_number),
                    status_ingresso: SEAT_STATUS_LABELS[seat.status] ?? seat.status,
                    resgatado_por: seat.redeemer_name ?? '',
                    email_resgatante: seat.redeemer_email ?? '',
                    codigo_ingresso: seat.ticket_code ?? '',
                    resgatado_em: seat.redeemed_at ? formatDateTime(seat.redeemed_at) : '',
                    criado_em: formatDateTime(bundle.created_at),
                    expira_em: formatDateTime(bundle.expires_at),
                });
            }
        }
        return lines;
    }, [reportQuery.data?.rows]);

    const handleExportCsv = () => {
        if (flatExportRows.length === 0) {
            showError('Nenhum dado para exportar.');
            return;
        }
        const headers = Object.keys(flatExportRows[0]);
        const csv = [
            headers.join(';'),
            ...flatExportRows.map((row) =>
                headers.map((h) => `"${(row[h] ?? '').replace(/"/g, '""')}"`).join(';'),
            ),
        ].join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'relatorio_pacotes_cortesia.csv';
        link.click();
        URL.revokeObjectURL(url);
        showSuccess('CSV exportado.');
    };

    if (loadingProfile) {
        return (
            <div className="py-20 text-center">
                <Loader2 className="h-8 w-8 animate-spin text-yellow-500 mx-auto" />
            </div>
        );
    }

    if (!isManagerPro || isAdminMaster) {
        return (
            <div className="max-w-3xl mx-auto text-center py-20 px-4">
                <h1 className="text-2xl font-serif text-red-400 mb-3">Acesso restrito</h1>
                <p className="text-gray-400 text-sm mb-6">
                    Este relatório é exclusivo do gestor. Admin Master não possui acesso a esta tela.
                </p>
                <Button variant="outline" onClick={() => navigate('/manager/reports')}>
                    Voltar aos relatórios
                </Button>
            </div>
        );
    }

    const summary = reportQuery.data?.summary;

    return (
        <div className="max-w-7xl mx-auto space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl sm:text-3xl font-serif text-yellow-500 flex items-center gap-2">
                        <Gift className="h-7 w-7" />
                        Pacotes cortesia
                    </h1>
                    <p className="text-gray-400 text-sm mt-1">
                        Acompanhamento de pacotes enviados, resgates por ingresso e destinatários.
                    </p>
                </div>
                <div className="flex flex-wrap gap-2">
                    <Button
                        variant="outline"
                        className="border-yellow-500/30 text-yellow-500"
                        onClick={() => navigate('/manager/reports')}
                    >
                        <ArrowLeft className="h-4 w-4 mr-2" />
                        Relatórios
                    </Button>
                    <Button
                        className="bg-yellow-500 text-black hover:bg-yellow-600"
                        onClick={handleExportCsv}
                        disabled={flatExportRows.length === 0}
                    >
                        <Download className="h-4 w-4 mr-2" />
                        Exportar CSV
                    </Button>
                </div>
            </div>

            {summary && (
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                    {[
                        { label: 'Pacotes', value: summary.total_bundles },
                        { label: 'Ativos', value: summary.active_bundles },
                        { label: 'Ingressos no total', value: summary.total_seats },
                        { label: 'Resgatados', value: summary.redeemed_seats },
                        { label: 'Pendentes', value: summary.pending_seats },
                    ].map((item) => (
                        <Card key={item.label} className="bg-black border border-yellow-500/20">
                            <CardContent className="p-4">
                                <p className="text-xs text-gray-500">{item.label}</p>
                                <p className="text-xl font-semibold text-white tabular-nums">
                                    {item.value.toLocaleString('pt-BR')}
                                </p>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            )}

            <Card className="bg-black border border-yellow-500/30">
                <CardHeader>
                    <CardTitle className="text-white text-lg">Filtros</CardTitle>
                </CardHeader>
                <CardContent className="grid md:grid-cols-3 gap-4">
                    <div>
                        <Select value={selectedEventId} onValueChange={setSelectedEventId}>
                            <SelectTrigger className="bg-black/60 border-yellow-500/30">
                                <SelectValue placeholder="Evento" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">Todos os eventos</SelectItem>
                                {(eventsQuery.data ?? []).map((ev) => (
                                    <SelectItem key={ev.id} value={ev.id}>
                                        {ev.title}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div>
                        <Select value={selectedStatus} onValueChange={setSelectedStatus}>
                            <SelectTrigger className="bg-black/60 border-yellow-500/30">
                                <SelectValue placeholder="Status" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">Todos os status</SelectItem>
                                <SelectItem value="active">Ativo</SelectItem>
                                <SelectItem value="fully_redeemed">Totalmente resgatado</SelectItem>
                                <SelectItem value="expired">Expirado</SelectItem>
                                <SelectItem value="cancelled">Cancelado</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-yellow-500/60" />
                        <Input
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            placeholder="Buscar destinatário ou evento…"
                            className="pl-9 bg-black/60 border-yellow-500/30"
                        />
                    </div>
                </CardContent>
            </Card>

            <Card className="bg-black border border-yellow-500/20">
                <CardHeader>
                    <CardTitle className="text-white">Detalhamento</CardTitle>
                    <CardDescription className="text-gray-400">
                        Clique em um pacote para ver cada ingresso e quem resgatou.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    {reportQuery.isLoading ? (
                        <div className="py-12 text-center">
                            <Loader2 className="h-7 w-7 animate-spin text-yellow-500 mx-auto" />
                        </div>
                    ) : (reportQuery.data?.rows ?? []).length === 0 ? (
                        <p className="text-gray-500 text-sm py-8 text-center">
                            Nenhum pacote cortesia encontrado com os filtros atuais.
                        </p>
                    ) : (
                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow className="border-yellow-500/20">
                                        <TableHead className="w-8" />
                                        <TableHead>Evento</TableHead>
                                        <TableHead>Destinatário</TableHead>
                                        <TableHead>Lote</TableHead>
                                        <TableHead className="text-center">Ingressos</TableHead>
                                        <TableHead>Status</TableHead>
                                        <TableHead>Validade</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {(reportQuery.data?.rows ?? []).map((row) => {
                                        const expanded = expandedBundleId === row.bundle_id;
                                        return (
                                            <React.Fragment key={row.bundle_id}>
                                                <TableRow
                                                    className="border-yellow-500/10 cursor-pointer hover:bg-black/40"
                                                    onClick={() =>
                                                        setExpandedBundleId(expanded ? null : row.bundle_id)
                                                    }
                                                >
                                                    <TableCell>
                                                        {expanded ? (
                                                            <ChevronDown className="h-4 w-4 text-yellow-500" />
                                                        ) : (
                                                            <ChevronRight className="h-4 w-4 text-gray-500" />
                                                        )}
                                                    </TableCell>
                                                    <TableCell>
                                                        <div className="text-white text-sm">{row.event_title}</div>
                                                        <div className="text-xs text-gray-500">
                                                            {formatDate(row.event_date)}
                                                        </div>
                                                    </TableCell>
                                                    <TableCell>
                                                        <div className="text-sm text-gray-200">{row.recipient_name}</div>
                                                        <div className="text-xs text-gray-500">
                                                            {row.recipient_email ?? '—'}
                                                        </div>
                                                        {row.holder_claimed && (
                                                            <div className="text-[10px] text-cyan-400 mt-0.5">
                                                                Destinatário acessou
                                                            </div>
                                                        )}
                                                    </TableCell>
                                                    <TableCell className="text-yellow-500/90">{row.batch_name}</TableCell>
                                                    <TableCell className="text-center tabular-nums text-sm">
                                                        {row.redeemed_count}/{row.quantity}
                                                    </TableCell>
                                                    <TableCell>
                                                        <span className="text-xs px-2 py-1 rounded-full bg-yellow-500/10 text-yellow-400">
                                                            {STATUS_LABELS[row.status] ?? row.status}
                                                        </span>
                                                    </TableCell>
                                                    <TableCell className="text-xs text-gray-400">
                                                        {formatDateTime(row.expires_at)}
                                                    </TableCell>
                                                </TableRow>
                                                {expanded && (
                                                    <TableRow className="border-yellow-500/10 bg-black/30">
                                                        <TableCell colSpan={7} className="p-0">
                                                            <div className="p-4 space-y-2">
                                                                <div className="flex flex-wrap gap-3 text-xs text-gray-500 mb-3">
                                                                    <span>Criado: {formatDateTime(row.created_at)}</span>
                                                                    {row.email_sent_at && (
                                                                        <span>E-mail: {formatDateTime(row.email_sent_at)}</span>
                                                                    )}
                                                                    {row.notes && <span>Obs.: {row.notes}</span>}
                                                                </div>
                                                                <Table>
                                                                    <TableHeader>
                                                                        <TableRow className="border-yellow-500/10">
                                                                            <TableHead className="text-xs">Nº</TableHead>
                                                                            <TableHead className="text-xs">Status</TableHead>
                                                                            <TableHead className="text-xs">Resgatante</TableHead>
                                                                            <TableHead className="text-xs">Código</TableHead>
                                                                            <TableHead className="text-xs">Resgatado em</TableHead>
                                                                        </TableRow>
                                                                    </TableHeader>
                                                                    <TableBody>
                                                                        {(row.seats ?? []).map((seat) => (
                                                                            <TableRow
                                                                                key={seat.seat_number}
                                                                                className="border-yellow-500/5"
                                                                            >
                                                                                <TableCell className="text-xs">
                                                                                    {seat.seat_number}
                                                                                </TableCell>
                                                                                <TableCell className="text-xs">
                                                                                    {SEAT_STATUS_LABELS[seat.status] ??
                                                                                        seat.status}
                                                                                </TableCell>
                                                                                <TableCell className="text-xs">
                                                                                    <div>{seat.redeemer_name ?? '—'}</div>
                                                                                    <div className="text-gray-500">
                                                                                        {seat.redeemer_email ?? ''}
                                                                                    </div>
                                                                                </TableCell>
                                                                                <TableCell className="text-xs font-mono text-yellow-500/80">
                                                                                    {seat.ticket_code ?? '—'}
                                                                                </TableCell>
                                                                                <TableCell className="text-xs text-gray-400">
                                                                                    {formatDateTime(seat.redeemed_at)}
                                                                                </TableCell>
                                                                            </TableRow>
                                                                        ))}
                                                                    </TableBody>
                                                                </Table>
                                                                <Button
                                                                    size="sm"
                                                                    variant="outline"
                                                                    className="border-cyan-500/30 text-cyan-300"
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        navigate(
                                                                            `/manager/events/${row.event_id}/cortesias`,
                                                                        );
                                                                    }}
                                                                >
                                                                    Gerenciar pacotes deste evento
                                                                </Button>
                                                            </div>
                                                        </TableCell>
                                                    </TableRow>
                                                )}
                                            </React.Fragment>
                                        );
                                    })}
                                </TableBody>
                            </Table>
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
};

export default ManagerComplimentaryBundlesReport;
