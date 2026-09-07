import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Loader2, Printer, Shield } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { usePageAuth } from '@/hooks/use-page-auth';
import { useProfile } from '@/hooks/use-profile';
import { useManagerEvents } from '@/hooks/use-manager-events';
import { supabase } from '@/integrations/supabase/client';
import { showError } from '@/utils/toast';
import PrintableTicketBatchSheet, {
    type PrintBatchDensity,
    type PrintBatchTicketItem,
} from '@/components/PrintableTicketBatchSheet';

const ADMIN_MASTER = 1;

type TicketRow = PrintBatchTicketItem & {
    wristbandId: string;
    createdAt: string;
};

const AdminPrintTestWristbands: React.FC = () => {
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    const { userId, authPending } = usePageAuth();
    const { profile, isLoading: loadingProfile } = useProfile(userId);
    const isAdminMaster = profile?.tipo_usuario_id === ADMIN_MASTER;
    const { events, isLoading: loadingEvents } = useManagerEvents(userId, true);

    const preselectedEventId = searchParams.get('eventId') || '';

    const [eventId, setEventId] = useState(preselectedEventId);
    const [codeFilter, setCodeFilter] = useState('');
    const [density, setDensity] = useState<PrintBatchDensity>(8);
    const [tickets, setTickets] = useState<TicketRow[]>([]);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [loadingTickets, setLoadingTickets] = useState(false);
    const [showPrintPreview, setShowPrintPreview] = useState(false);

    useEffect(() => {
        if (authPending || loadingProfile) return;
        if (userId && profile && !isAdminMaster) {
            showError('Acesso exclusivo do Admin Master.');
            navigate('/manager/wristbands');
        }
    }, [authPending, loadingProfile, userId, profile, isAdminMaster, navigate]);

    useEffect(() => {
        if (preselectedEventId) setEventId(preselectedEventId);
    }, [preselectedEventId]);

    const selectedEvent = events.find((e) => e.id === eventId);

    const loadTickets = async (targetEventId: string) => {
        if (!targetEventId) {
            setTickets([]);
            setSelectedIds(new Set());
            return;
        }
        setLoadingTickets(true);
        setShowPrintPreview(false);
        try {
            const { data: wristbandRows, error: wErr } = await supabase
                .from('wristbands')
                .select('id, code, access_type, created_at')
                .eq('event_id', targetEventId)
                .eq('status', 'active')
                .order('created_at', { ascending: true });

            if (wErr) throw wErr;
            const ids = (wristbandRows ?? []).map((w) => w.id);
            if (ids.length === 0) {
                setTickets([]);
                setSelectedIds(new Set());
                return;
            }

            // PostgREST limita IN grande; carrega analytics em blocos.
            const analyticsRows: Array<{
                id: string;
                wristband_id: string;
                code_wristbands: string | null;
                status: string;
                event_type: string;
                created_at: string;
            }> = [];
            const chunkSize = 100;
            for (let i = 0; i < ids.length; i += chunkSize) {
                const chunk = ids.slice(i, i + chunkSize);
                const { data, error: aErr } = await supabase
                    .from('wristband_analytics')
                    .select('id, wristband_id, code_wristbands, status, event_type, created_at')
                    .in('wristband_id', chunk)
                    .eq('status', 'active')
                    .in('event_type', ['creation', 'purchase', 'free_registration'])
                    .order('created_at', { ascending: true });
                if (aErr) throw aErr;
                if (data?.length) analyticsRows.push(...data);
            }

            const byWristband = new Map((wristbandRows ?? []).map((w) => [w.id, w]));
            const rows: TicketRow[] = (analyticsRows ?? [])
                .map((a) => {
                    const w = byWristband.get(a.wristband_id);
                    if (!w) return null;
                    return {
                        scanValue: a.id,
                        code: a.code_wristbands || w.code,
                        accessType: w.access_type,
                        wristbandId: w.id,
                        createdAt: a.created_at,
                    };
                })
                .filter((r): r is TicketRow => r != null);

            setTickets(rows);
            setSelectedIds(new Set(rows.map((r) => r.scanValue)));
        } catch (e: unknown) {
            console.error('[AdminPrintTestWristbands]', e);
            showError(e instanceof Error ? e.message : 'Erro ao carregar ingressos.');
            setTickets([]);
            setSelectedIds(new Set());
        } finally {
            setLoadingTickets(false);
        }
    };

    useEffect(() => {
        if (!eventId || !isAdminMaster) return;
        void loadTickets(eventId);
    }, [eventId, isAdminMaster]);

    const filteredTickets = useMemo(() => {
        const term = codeFilter.trim().toUpperCase();
        if (!term) return tickets;
        return tickets.filter((t) => t.code.toUpperCase().includes(term));
    }, [tickets, codeFilter]);

    const selectedTickets = useMemo(
        () => filteredTickets.filter((t) => selectedIds.has(t.scanValue)),
        [filteredTickets, selectedIds],
    );

    const toggleOne = (id: string, checked: boolean) => {
        setSelectedIds((prev) => {
            const next = new Set(prev);
            if (checked) next.add(id);
            else next.delete(id);
            return next;
        });
        setShowPrintPreview(false);
    };

    const selectAllFiltered = (checked: boolean) => {
        setSelectedIds((prev) => {
            const next = new Set(prev);
            for (const t of filteredTickets) {
                if (checked) next.add(t.scanValue);
                else next.delete(t.scanValue);
            }
            return next;
        });
        setShowPrintPreview(false);
    };

    if (authPending || loadingProfile || (userId && !profile)) {
        return (
            <div className="max-w-5xl mx-auto text-center py-20">
                <Loader2 className="h-8 w-8 animate-spin text-yellow-500 mx-auto mb-4" />
                <p className="text-gray-400">Carregando...</p>
            </div>
        );
    }

    if (!isAdminMaster) return null;

    return (
        <div className="max-w-5xl mx-auto space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 print:hidden">
                <div>
                    <h1 className="text-2xl sm:text-3xl font-serif text-yellow-500 flex items-center gap-2">
                        <Printer className="h-7 w-7" />
                        Imprimir lote A4 (teste)
                    </h1>
                    <p className="text-gray-400 text-sm mt-1 flex items-center gap-1">
                        <Shield className="h-3.5 w-3.5 text-amber-400" />
                        Exclusivo Admin Master — vários QRs por folha
                    </p>
                </div>
                <Button
                    type="button"
                    variant="outline"
                    onClick={() => navigate('/manager/wristbands')}
                    className="bg-black/60 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 hover:text-yellow-400"
                >
                    <ArrowLeft className="h-4 w-4 mr-2" />
                    Voltar
                </Button>
            </div>

            <Card className="bg-black border-yellow-500/30 print:hidden">
                <CardHeader>
                    <CardTitle className="text-white text-lg">Selecionar ingressos</CardTitle>
                    <CardDescription className="text-gray-400">
                        Escolha o evento e quantos QRs vão em cada folha A4. Densidade maior = QR menor.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="md:col-span-2">
                            <label className="text-sm text-white mb-2 block">Evento *</label>
                            <Select
                                value={eventId || undefined}
                                onValueChange={(v) => {
                                    setEventId(v);
                                    setSearchParams(v ? { eventId: v } : {}, { replace: true });
                                }}
                                disabled={loadingEvents}
                            >
                                <SelectTrigger className="bg-black/60 border-yellow-500/30 text-white">
                                    <SelectValue placeholder="Selecione o evento" />
                                </SelectTrigger>
                                <SelectContent className="bg-black border-yellow-500/30 text-white">
                                    {events.map((ev) => (
                                        <SelectItem key={ev.id} value={ev.id}>
                                            {ev.company_name
                                                ? `${ev.title} — ${ev.company_name}`
                                                : ev.title}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div>
                            <label className="text-sm text-white mb-2 block">QRs por folha A4</label>
                            <Select
                                value={String(density)}
                                onValueChange={(v) => {
                                    setDensity(Number(v) as PrintBatchDensity);
                                    setShowPrintPreview(false);
                                }}
                            >
                                <SelectTrigger className="bg-black/60 border-yellow-500/30 text-white">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent className="bg-black border-yellow-500/30 text-white">
                                    <SelectItem value="6">6 (QR grande)</SelectItem>
                                    <SelectItem value="8">8 (recomendado)</SelectItem>
                                    <SelectItem value="12">12 (QR menor)</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    <div>
                        <label className="text-sm text-white mb-2 block">Filtrar código</label>
                        <Input
                            value={codeFilter}
                            onChange={(e) => setCodeFilter(e.target.value)}
                            placeholder="Ex.: TESTE001"
                            className="bg-black/60 border-yellow-500/30 text-white"
                        />
                    </div>

                    {!eventId ? (
                        <p className="text-sm text-gray-500">Selecione um evento para listar os QRs.</p>
                    ) : loadingTickets ? (
                        <div className="flex justify-center py-10">
                            <Loader2 className="h-8 w-8 animate-spin text-yellow-500" />
                        </div>
                    ) : filteredTickets.length === 0 ? (
                        <p className="text-sm text-gray-500">
                            Nenhum ingresso ativo encontrado. Gere QRs de teste primeiro.
                        </p>
                    ) : (
                        <>
                            <div className="flex flex-wrap items-center gap-3">
                                <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
                                    <Checkbox
                                        checked={
                                            filteredTickets.length > 0 &&
                                            filteredTickets.every((t) => selectedIds.has(t.scanValue))
                                        }
                                        onCheckedChange={(c) => selectAllFiltered(c === true)}
                                    />
                                    Selecionar filtrados ({filteredTickets.length})
                                </label>
                                <span className="text-xs text-gray-500">
                                    {selectedTickets.length} selecionado(s)
                                </span>
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    className="bg-black/60 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10"
                                    onClick={() => void loadTickets(eventId)}
                                >
                                    Atualizar lista
                                </Button>
                            </div>

                            <div className="max-h-64 overflow-y-auto rounded-xl border border-yellow-500/20 divide-y divide-yellow-500/10">
                                {filteredTickets.map((t) => (
                                    <label
                                        key={t.scanValue}
                                        className="flex items-center gap-3 px-3 py-2 text-sm cursor-pointer hover:bg-yellow-500/5"
                                    >
                                        <Checkbox
                                            checked={selectedIds.has(t.scanValue)}
                                            onCheckedChange={(c) => toggleOne(t.scanValue, c === true)}
                                        />
                                        <span className="font-mono text-yellow-500">{t.code}</span>
                                        <span className="text-gray-500 text-xs">{t.accessType}</span>
                                    </label>
                                ))}
                            </div>

                            <Button
                                type="button"
                                disabled={selectedTickets.length === 0}
                                className="bg-yellow-500 text-black hover:bg-yellow-600 disabled:opacity-50"
                                onClick={() => setShowPrintPreview(true)}
                            >
                                <Printer className="h-4 w-4 mr-2" />
                                Preparar impressão ({selectedTickets.length})
                            </Button>
                        </>
                    )}
                </CardContent>
            </Card>

            {showPrintPreview && selectedEvent && selectedTickets.length > 0 && (
                <Card className="bg-black border-yellow-500/30">
                    <CardHeader className="print:hidden">
                        <CardTitle className="text-white text-lg">Pré-visualização A4</CardTitle>
                        <CardDescription className="text-gray-400">
                            Use o botão Imprimir lote A4. No diálogo da impressora, escolha A4 e margens mínimas.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <PrintableTicketBatchSheet
                            eventName={selectedEvent.title}
                            eventDate={selectedEvent.date}
                            tickets={selectedTickets}
                            density={density}
                        />
                    </CardContent>
                </Card>
            )}
        </div>
    );
};

export default AdminPrintTestWristbands;
