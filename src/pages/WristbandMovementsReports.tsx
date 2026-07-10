import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Activity, Search, Loader2 } from 'lucide-react';
import { usePageAuth } from '@/hooks/use-page-auth';
import { useUserRole } from '@/hooks/use-user-role';
import { useManagerEvents } from '@/hooks/use-manager-events';
import { normalizeTipoUsuarioId } from '@/utils/fetch-profile-tipo';
import { restGet } from '@/utils/supabase-rest';
import { showError } from '@/utils/toast';

const ADMIN_MASTER_USER_TYPE_ID = 1;
const MANAGER_PRO_USER_TYPE_ID = 2;

interface MovementRow {
    wristband_id: string;
    event_id: string;
    movement_type: 'entry' | 'exit';
    validated_at: string;
    wristbands: {
        code: string;
    } | null;
}

interface MovementStats {
    total_entries: number;
    total_exits: number;
    last_movement_type: 'entry' | 'exit' | null;
    last_validated_at: string | null;
}

interface SoldAssignmentRow {
    analytics_id: string;
    wristband_id: string;
    code_wristbands: string | null;
    batch_code: string;
    ingresso_status: string;
    event_type: string;
}

interface ReportTableRow {
    rowKey: string;
    analytics_id: string | null;
    wristband_id: string;
    individual_code: string;
    batch_code: string;
    ingresso_status: string | null;
    event_type: string | null;
    total_entries: number;
    total_exits: number;
    last_movement_type: 'entry' | 'exit' | null;
    last_validated_at: string | null;
}

const fetchWristbandMovements = async (eventId: string): Promise<MovementRow[]> => {
    const data = await restGet<MovementRow[]>(
        `wristband_movements?select=wristband_id,event_id,movement_type,validated_at,wristbands(code)&event_id=eq.${encodeURIComponent(eventId)}&order=validated_at.asc`,
        15_000,
    );
    return data || [];
};

const movementStatsByWristbandId = (rows: MovementRow[]): Map<string, MovementStats> => {
    const map = new Map<string, MovementStats>();

    for (const row of rows) {
        const isEntry = row.movement_type === 'entry';
        const existing = map.get(row.wristband_id);

        if (!existing) {
            map.set(row.wristband_id, {
                total_entries: isEntry ? 1 : 0,
                total_exits: isEntry ? 0 : 1,
                last_movement_type: row.movement_type,
                last_validated_at: row.validated_at,
            });
        } else {
            existing.total_entries += isEntry ? 1 : 0;
            existing.total_exits += isEntry ? 0 : 1;
            existing.last_movement_type = row.movement_type;
            existing.last_validated_at = row.validated_at;
        }
    }

    return map;
};

const fetchSoldAssignmentsForEvent = async (eventId: string): Promise<SoldAssignmentRow[]> => {
    const bands = await restGet<Array<{ id: string; code: string }>>(
        `wristbands?select=id,code&event_id=eq.${encodeURIComponent(eventId)}`,
        12_000,
    );

    const wristbandIds = (bands || []).map((w) => w.id);
    const batchCodeById = new Map((bands || []).map((w) => [w.id, w.code]));

    if (wristbandIds.length === 0) return [];

    const inList = wristbandIds.map((id) => encodeURIComponent(id)).join(',');
    const analyticsRows = await restGet<Array<{
        id: string;
        wristband_id: string;
        code_wristbands: string | null;
        status: string;
        event_type: string;
    }>>(
        `wristband_analytics?select=id,wristband_id,code_wristbands,status,event_type&wristband_id=in.(${inList})&client_user_id=not.is.null`,
        15_000,
    );

    return (analyticsRows || []).map((row) => ({
        analytics_id: row.id,
        wristband_id: row.wristband_id,
        code_wristbands: row.code_wristbands,
        batch_code: batchCodeById.get(row.wristband_id) || 'N/A',
        ingresso_status: row.status,
        event_type: row.event_type,
    }));
};

const buildReportRows = (
    sold: SoldAssignmentRow[],
    movementRows: MovementRow[],
): ReportTableRow[] => {
    const statsMap = movementStatsByWristbandId(movementRows);
    const soldWristbandIds = new Set(sold.map((s) => s.wristband_id));

    const fromSold: ReportTableRow[] = sold.map((s) => {
        const st = statsMap.get(s.wristband_id);
        const individual = (s.code_wristbands && s.code_wristbands.trim()) || s.batch_code;
        return {
            rowKey: s.analytics_id,
            analytics_id: s.analytics_id,
            wristband_id: s.wristband_id,
            individual_code: individual,
            batch_code: s.batch_code,
            ingresso_status: s.ingresso_status,
            event_type: s.event_type,
            total_entries: st?.total_entries ?? 0,
            total_exits: st?.total_exits ?? 0,
            last_movement_type: st?.last_movement_type ?? null,
            last_validated_at: st?.last_validated_at ?? null,
        };
    });

    const orphanRows: ReportTableRow[] = [];
    for (const [wbId, st] of statsMap) {
        if (!soldWristbandIds.has(wbId)) {
            const mv = movementRows.find((r) => r.wristband_id === wbId);
            const batchCode = mv?.wristbands?.code || 'N/A';
            orphanRows.push({
                rowKey: `mv-${wbId}`,
                analytics_id: null,
                wristband_id: wbId,
                individual_code: batchCode,
                batch_code: batchCode,
                ingresso_status: null,
                event_type: null,
                total_entries: st.total_entries,
                total_exits: st.total_exits,
                last_movement_type: st.last_movement_type,
                last_validated_at: st.last_validated_at,
            });
        }
    }

    return [...fromSold, ...orphanRows].sort((a, b) =>
        a.individual_code.localeCompare(b.individual_code, 'pt-BR'),
    );
};

const fetchMovementReportBundle = async (eventId: string): Promise<ReportTableRow[]> => {
    const [movementRows, sold] = await Promise.all([
        fetchWristbandMovements(eventId),
        fetchSoldAssignmentsForEvent(eventId),
    ]);
    return buildReportRows(sold, movementRows);
};

const ingressoStatusLabel = (status: string | null): string => {
    if (!status) return '—';
    const map: Record<string, string> = {
        active: 'Ativo',
        pending: 'Pendente',
        used: 'Utilizado',
        lost: 'Perdido',
        cancelled: 'Cancelado',
    };
    return map[status] || status;
};

const WristbandMovementsReports: React.FC = () => {
    const navigate = useNavigate();
    const { userId, authPending, sessionReady, bootExpired } = usePageAuth();
    const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
    const [searchTerm, setSearchTerm] = useState('');

    const { tipoUsuarioId, isLoading: isLoadingRole, isFetched: roleFetched } = useUserRole(userId);
    const tipo = normalizeTipoUsuarioId(tipoUsuarioId);
    const isAdminMaster = tipo === ADMIN_MASTER_USER_TYPE_ID;
    const canAccess = isAdminMaster || tipo === MANAGER_PRO_USER_TYPE_ID;
    const queriesEnabled = Boolean(userId && roleFetched && canAccess);

    const { events: eventsForFilter, isLoading: isLoadingEvents } = useManagerEvents(
        userId,
        isAdminMaster,
        { enabled: queriesEnabled },
    );

    const {
        data: reportBundle,
        isLoading: isLoadingMovements,
        isError,
    } = useQuery({
        queryKey: ['wristband_movements_report', selectedEventId],
        queryFn: () => fetchMovementReportBundle(selectedEventId!),
        enabled: queriesEnabled && !!selectedEventId,
        staleTime: 30_000,
        retry: 1,
        refetchOnWindowFocus: false,
    });

    useEffect(() => {
        if (isError) showError('Erro ao carregar movimentações de ingressos.');
    }, [isError]);

    useEffect(() => {
        if (roleFetched && userId && tipo != null && !canAccess) {
            showError('Acesso negado. Você não tem permissão para acessar esta página.');
            navigate('/manager/dashboard', { replace: true });
        }
    }, [roleFetched, userId, tipo, canAccess, navigate]);

    if (authPending || (isLoadingRole && !roleFetched)) {
        return (
            <div className="max-w-7xl mx-auto flex flex-col items-center justify-center py-24 text-gray-400">
                <Loader2 className="h-10 w-10 animate-spin text-yellow-500 mb-4" />
                <p>Carregando sessão...</p>
            </div>
        );
    }

    if (!userId && (sessionReady || bootExpired)) {
        return (
            <div className="max-w-7xl mx-auto text-center py-20 px-4">
                <h1 className="text-2xl font-serif text-yellow-500 mb-4">Sessão expirada</h1>
                <Button onClick={() => navigate('/login')} className="bg-yellow-500 text-black hover:bg-yellow-600">
                    Ir para login
                </Button>
            </div>
        );
    }

    if (roleFetched && tipo != null && !canAccess) {
        return null;
    }

    const reportRows = reportBundle ?? [];
    const filtered = reportRows.filter((item) => {
        if (!searchTerm.trim()) return true;
        const term = searchTerm.toLowerCase();
        return (
            item.individual_code.toLowerCase().includes(term) ||
            item.batch_code.toLowerCase().includes(term) ||
            (item.ingresso_status && ingressoStatusLabel(item.ingresso_status).toLowerCase().includes(term))
        );
    });

    const totalEntries = filtered.reduce((sum, m) => sum + m.total_entries, 0);
    const totalExits = filtered.reduce((sum, m) => sum + m.total_exits, 0);

    return (
        <div className="max-w-7xl mx-auto p-4 sm:p-6 lg:p-8">
            <div className="flex items-center justify-between mb-8">
                <h1 className="text-2xl sm:text-3xl font-serif text-yellow-500 flex items-center">
                    <Activity className="h-7 w-7 mr-3" />
                    Movimentação de Ingressos
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
                        Lista ingressos já atribuídos a compradores neste evento. Entradas e saídas só aparecem após leitura no
                        validador (portão); antes disso os totais ficam em zero.
                    </CardDescription>
                </CardHeader>
                <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div>
                        <label className="block text-sm font-medium text-gray-400 mb-2">Evento</label>
                        <Select
                            onValueChange={(value) => setSelectedEventId(value === 'none' ? null : value)}
                            value={selectedEventId || 'none'}
                        >
                            <SelectTrigger className="w-full bg-black/60 border-yellow-500/30 text-white focus:ring-yellow-500 h-10">
                                <SelectValue placeholder="Selecione um evento" />
                            </SelectTrigger>
                            <SelectContent className="bg-black border border-yellow-500/30 text-white max-h-64">
                                <SelectItem value="none" className="hover:bg-yellow-500/10 cursor-pointer">
                                    Selecione um evento
                                </SelectItem>
                                {isLoadingEvents ? (
                                    <SelectItem value="loading" disabled>
                                        Carregando eventos...
                                    </SelectItem>
                                ) : eventsForFilter.length === 0 ? (
                                    <SelectItem value="empty" disabled>
                                        Nenhum evento encontrado
                                    </SelectItem>
                                ) : (
                                    eventsForFilter.map((event) => (
                                        <SelectItem
                                            key={event.id}
                                            value={event.id}
                                            className="hover:bg-yellow-500/10 cursor-pointer"
                                        >
                                            {event.title}
                                        </SelectItem>
                                    ))
                                )}
                            </SelectContent>
                        </Select>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-400 mb-2">Buscar por código</label>
                        <div className="relative">
                            <input
                                type="text"
                                placeholder="Ex: CHAVA-001"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="w-full bg-black/60 border border-yellow-500/30 rounded-xl px-4 py-2 text-white placeholder-gray-400 text-sm focus:border-yellow-500 focus:outline-none focus:ring-2 focus:ring-yellow-500/20"
                            />
                            <Search className="h-4 w-4 text-yellow-500 absolute right-3 top-1/2 -translate-y-1/2" />
                        </div>
                    </div>
                    <div className="flex flex-col justify-center space-y-1">
                        <p className="text-sm text-gray-300">
                            <span className="font-semibold text-yellow-500">Total entradas:</span> {totalEntries}
                        </p>
                        <p className="text-sm text-gray-300">
                            <span className="font-semibold text-yellow-500">Total saídas:</span> {totalExits}
                        </p>
                        <p className="text-xs text-gray-500">
                            O sistema lista primeiro os ingressos já vinculados a um comprador; as leituras do validador no portão
                            incrementam entradas e saídas.
                        </p>
                    </div>
                </CardContent>
            </Card>

            <Card className="bg-black border border-yellow-500/30 rounded-2xl shadow-2xl shadow-yellow-500/10 p-6">
                <CardHeader>
                    <CardTitle className="text-white text-xl">Detalhes</CardTitle>
                </CardHeader>
                <CardContent>
                    {!selectedEventId ? (
                        <div className="text-center py-8 text-gray-500">Selecione um evento para ver a movimentação.</div>
                    ) : isLoadingMovements ? (
                        <div className="text-center py-8 text-gray-500 flex items-center justify-center">
                            <Loader2 className="h-6 w-6 animate-spin text-yellow-500 mr-2" /> Carregando...
                        </div>
                    ) : isError ? (
                        <div className="text-center py-8 text-red-400">Erro ao carregar. Tente novamente.</div>
                    ) : filtered.length === 0 ? (
                        <div className="text-center py-8 text-gray-500">Nenhum ingresso encontrado para este evento.</div>
                    ) : (
                        <div className="overflow-x-auto">
                            <Table className="min-w-full">
                                <TableHeader>
                                    <TableRow className="border-b border-yellow-500/20">
                                        <TableHead className="text-gray-400">Código</TableHead>
                                        <TableHead className="text-gray-400">Lote</TableHead>
                                        <TableHead className="text-gray-400">Status</TableHead>
                                        <TableHead className="text-right text-gray-400">Entradas</TableHead>
                                        <TableHead className="text-right text-gray-400">Saídas</TableHead>
                                        <TableHead className="text-gray-400">Último movimento</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {filtered.map((item) => (
                                        <TableRow key={item.rowKey} className="border-b border-yellow-500/10">
                                            <TableCell className="text-white font-medium">{item.individual_code}</TableCell>
                                            <TableCell className="text-gray-300">{item.batch_code}</TableCell>
                                            <TableCell className="text-gray-300">{ingressoStatusLabel(item.ingresso_status)}</TableCell>
                                            <TableCell className="text-right text-white">{item.total_entries}</TableCell>
                                            <TableCell className="text-right text-white">{item.total_exits}</TableCell>
                                            <TableCell className="text-gray-400 text-sm">
                                                {item.last_validated_at
                                                    ? new Date(item.last_validated_at).toLocaleString('pt-BR')
                                                    : '—'}
                                                {item.last_movement_type
                                                    ? ` (${item.last_movement_type === 'entry' ? 'entrada' : 'saída'})`
                                                    : ''}
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

export default WristbandMovementsReports;
