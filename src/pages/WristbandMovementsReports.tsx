import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Activity, Search } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useProfile } from '@/hooks/use-profile';
import { showError } from '@/utils/toast';

interface EventOption {
    id: string;
    title: string;
}

interface MovementRow {
    wristband_id: string;
    event_id: string;
    movement_type: 'entry' | 'exit';
    validated_at: string;
    wristbands: {
        code: string;
    } | null;
}

interface AggregatedMovement {
    wristband_id: string;
    code: string;
    total_entries: number;
    total_exits: number;
    last_movement_type: 'entry' | 'exit' | null;
    last_validated_at: string | null;
}

const fetchEventsForFilter = async (): Promise<EventOption[]> => {
    const { data, error } = await supabase
        .from('events')
        .select('id, title')
        .order('title', { ascending: true });

    if (error) {
        console.error('Erro ao carregar eventos para filtro de movimentação:', error);
        throw error;
    }

    return (data || []) as EventOption[];
};

const fetchWristbandMovements = async (eventId: string | null): Promise<MovementRow[]> => {
    if (!eventId) return [];

    const { data, error } = await supabase
        .from('wristband_movements')
        .select('wristband_id, event_id, movement_type, validated_at, wristbands(code)')
        .eq('event_id', eventId)
        .order('validated_at', { ascending: true });

    if (error) {
        console.error('Erro ao carregar movimentações de pulseiras:', error);
        throw error;
    }

    return (data || []) as MovementRow[];
};

const aggregateMovements = (rows: MovementRow[]): AggregatedMovement[] => {
    const map = new Map<string, AggregatedMovement>();

    for (const row of rows) {
        const existing = map.get(row.wristband_id);
        const isEntry = row.movement_type === 'entry';

        if (!existing) {
            map.set(row.wristband_id, {
                wristband_id: row.wristband_id,
                code: row.wristbands?.code || 'N/A',
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

    return Array.from(map.values()).sort((a, b) => a.code.localeCompare(b.code));
};

const WristbandMovementsReports: React.FC = () => {
    const navigate = useNavigate();
    const { profile } = useProfile();
    const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
    const [searchTerm, setSearchTerm] = useState('');

    // Acesso: mesmo critério dos outros relatórios (Admin Master ou Gestor PRO)
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

    const { data: eventsForFilter, isLoading: isLoadingEvents } = useQuery<EventOption[]>({
        queryKey: ['wristband_mov_events'],
        queryFn: fetchEventsForFilter,
    });

    const { data: movementRows, isLoading: isLoadingMovements, isError } = useQuery<MovementRow[]>({
        queryKey: ['wristband_movements', selectedEventId],
        queryFn: () => fetchWristbandMovements(selectedEventId),
        enabled: !!selectedEventId,
    });

    if (isError) {
        showError('Erro ao carregar movimentações de pulseiras.');
    }

    const aggregated = aggregateMovements(movementRows || []);
    const filtered = aggregated.filter(item => {
        if (!searchTerm.trim()) return true;
        const term = searchTerm.toLowerCase();
        return item.code.toLowerCase().includes(term);
    });

    const totalEntries = aggregated.reduce((sum, m) => sum + m.total_entries, 0);
    const totalExits = aggregated.reduce((sum, m) => sum + m.total_exits, 0);

    return (
        <div className="max-w-7xl mx-auto p-4 sm:p-6 lg:p-8">
            <div className="flex items-center justify-between mb-8">
                <h1 className="text-2xl sm:text-3xl font-serif text-yellow-500 flex items-center">
                    <Activity className="h-7 w-7 mr-3" />
                    Movimentação de Pulseiras
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
                        Selecione um evento e, opcionalmente, filtre por código da pulseira para analisar entradas e saídas.
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
                            <SelectContent className="bg-black border-yellow-500/30 text-white max-h-64">
                                <SelectItem value="none" className="hover:bg-yellow-500/10 cursor-pointer">
                                    Selecione um evento
                                </SelectItem>
                                {isLoadingEvents ? (
                                    <SelectItem value="loading" disabled>
                                        Carregando eventos...
                                    </SelectItem>
                                ) : (
                                    eventsForFilter?.map((event) => (
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
                            Cada leitura válida da pulseira gera uma linha em movimentações (entrada/saída).
                        </p>
                    </div>
                </CardContent>
            </Card>

            <Card className="bg-black border border-yellow-500/30 rounded-2xl shadow-2xl shadow-yellow-500/10 p-6">
                <CardHeader>
                    <CardTitle className="text-white text-xl">Detalhamento por pulseira</CardTitle>
                    <CardDescription className="text-gray-400">
                        Entradas, saídas e último status por pulseira/ingresso no evento selecionado.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    {!selectedEventId ? (
                        <p className="text-gray-400 text-sm">
                            Selecione um evento para visualizar as movimentações das pulseiras.
                        </p>
                    ) : isLoadingMovements ? (
                        <p className="text-gray-400 text-sm">Carregando movimentações...</p>
                    ) : filtered.length === 0 ? (
                        <p className="text-gray-400 text-sm">
                            Nenhuma movimentação encontrada para este evento com os filtros atuais.
                        </p>
                    ) : (
                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead className="text-gray-300">Código da Pulseira</TableHead>
                                        <TableHead className="text-gray-300 text-center">Entradas</TableHead>
                                        <TableHead className="text-gray-300 text-center">Saídas</TableHead>
                                        <TableHead className="text-gray-300 text-center">Último Movimento</TableHead>
                                        <TableHead className="text-gray-300 text-center">Data/Hora Última Leitura</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {filtered.map((item) => (
                                        <TableRow key={item.wristband_id}>
                                            <TableCell className="font-mono text-sm text-yellow-500">
                                                {item.code}
                                            </TableCell>
                                            <TableCell className="text-center text-gray-200">
                                                {item.total_entries}
                                            </TableCell>
                                            <TableCell className="text-center text-gray-200">
                                                {item.total_exits}
                                            </TableCell>
                                            <TableCell className="text-center">
                                                {item.last_movement_type === 'entry'
                                                    ? <span className="text-green-400 text-xs px-2 py-1 rounded-full bg-green-500/10">Dentro</span>
                                                    : item.last_movement_type === 'exit'
                                                        ? <span className="text-red-400 text-xs px-2 py-1 rounded-full bg-red-500/10">Fora</span>
                                                        : <span className="text-gray-400 text-xs">N/A</span>}
                                            </TableCell>
                                            <TableCell className="text-center text-gray-300 text-xs">
                                                {item.last_validated_at
                                                    ? new Date(item.last_validated_at).toLocaleString('pt-BR')
                                                    : '—'}
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

