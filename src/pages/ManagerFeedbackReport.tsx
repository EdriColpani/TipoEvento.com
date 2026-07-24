import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Download, Loader2, MessageSquareHeart, Search, Star } from 'lucide-react';
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
import {
    FeedbackFilterChip,
    FeedbackOpinionCard,
} from '@/components/manager/FeedbackOpinionCard';
import { usePageAuth } from '@/hooks/use-page-auth';
import { useProfile } from '@/hooks/use-profile';
import { useManagerFeedbackReport } from '@/hooks/use-manager-feedback-report';
import { EVENT_REVIEW_TAGS } from '@/utils/event-review';
import { formatEventDateForDisplay } from '@/utils/format-event-date';
import {
    DEFAULT_FEEDBACK_FILTERS,
    FEEDBACK_TAG_LABELS,
    filterFeedbackItems,
    summarizeFilteredFeedback,
    type FeedbackCommentFilter,
    type FeedbackRatingFilter,
    type FeedbackReportFilters,
} from '@/utils/manager-feedback-filters';
import { showError, showSuccess } from '@/utils/toast';

const ADMIN_MASTER = 1;
const MANAGER_PRO = 2;

function formatWhen(iso: string) {
    try {
        return new Date(iso).toLocaleString('pt-BR', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    } catch {
        return iso;
    }
}

const ManagerFeedbackReport: React.FC = () => {
    const navigate = useNavigate();
    const { userId, authPending } = usePageAuth();
    const { profile, isLoading: loadingProfile } = useProfile(userId);
    const isAdminMaster = profile?.tipo_usuario_id === ADMIN_MASTER;
    const isManagerPro = profile?.tipo_usuario_id === MANAGER_PRO;
    const canAccess = isManagerPro && !isAdminMaster;

    const { data, isLoading, isError, error, refetch, isFetching } =
        useManagerFeedbackReport(canAccess);
    const [filters, setFilters] = useState<FeedbackReportFilters>(DEFAULT_FEEDBACK_FILTERS);

    const filtered = useMemo(
        () => filterFeedbackItems(data?.items ?? [], filters),
        [data?.items, filters],
    );
    const summary = useMemo(() => summarizeFilteredFeedback(filtered), [filtered]);

    const handleExportCsv = () => {
        if (filtered.length === 0) {
            showError('Nenhum dado para exportar.');
            return;
        }
        const headers = ['evento', 'data_evento', 'nota', 'temas', 'comentario', 'atualizado_em'];
        const rows = filtered.map((item) => ({
            evento: item.event_title,
            data_evento: item.event_date ? formatEventDateForDisplay(item.event_date) : '',
            nota: String(item.rating),
            temas: item.tags.map((t) => FEEDBACK_TAG_LABELS[t] ?? t).join(', '),
            comentario: item.comment?.trim() ?? '',
            atualizado_em: formatWhen(item.updated_at || item.created_at),
        }));
        const csv = [
            headers.join(';'),
            ...rows.map((row) =>
                headers
                    .map((h) => `"${(row[h as keyof typeof row] ?? '').replace(/"/g, '""')}"`)
                    .join(';'),
            ),
        ].join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'relatorio_feedback_eventos.csv';
        link.click();
        URL.revokeObjectURL(url);
        showSuccess('CSV exportado.');
    };

    if (authPending || (userId && loadingProfile)) {
        return (
            <div className="py-20 text-center">
                <Loader2 className="h-8 w-8 animate-spin text-yellow-500 mx-auto" />
            </div>
        );
    }

    if (!canAccess) {
        return (
            <div className="max-w-3xl mx-auto text-center py-20 px-4">
                <h1 className="text-2xl font-serif text-red-400 mb-3">Acesso restrito</h1>
                <p className="text-gray-400 text-sm mb-6">
                    Este relatório é exclusivo do gestor. Admin Master não possui acesso a esta tela.
                </p>
                <Button
                    variant="outline"
                    className="bg-black/60 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 hover:text-yellow-400"
                    onClick={() => navigate('/manager/reports')}
                >
                    Voltar aos relatórios
                </Button>
            </div>
        );
    }

    return (
        <div className="max-w-7xl mx-auto space-y-6 p-4 sm:p-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl sm:text-3xl font-serif text-yellow-500 flex items-center gap-2">
                        <MessageSquareHeart className="h-7 w-7" />
                        Feedback dos clientes
                    </h1>
                    <p className="text-gray-400 text-sm mt-1">
                        Avaliações dos seus eventos (nota, temas e opiniões). Exclusivo do gestor.
                    </p>
                </div>
                <div className="flex flex-wrap gap-2">
                    <Button
                        variant="outline"
                        className="bg-black/60 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 hover:text-yellow-400"
                        onClick={() => navigate('/manager/reports')}
                    >
                        <ArrowLeft className="h-4 w-4 mr-2" />
                        Relatórios
                    </Button>
                    <Button
                        variant="outline"
                        className="bg-black/60 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 hover:text-yellow-400"
                        onClick={() => refetch()}
                        disabled={isFetching}
                    >
                        {isFetching ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                        Atualizar
                    </Button>
                    <Button
                        className="bg-yellow-500 text-black hover:bg-yellow-600 disabled:opacity-50"
                        onClick={handleExportCsv}
                        disabled={filtered.length === 0}
                    >
                        <Download className="h-4 w-4 mr-2" />
                        Exportar CSV
                    </Button>
                </div>
            </div>

            {isError ? (
                <p className="text-red-400 text-sm">
                    {error instanceof Error
                        ? error.message
                        : 'Não foi possível carregar o relatório.'}
                </p>
            ) : null}

            {isLoading ? (
                <div className="py-16 text-center text-gray-400">
                    <Loader2 className="h-8 w-8 animate-spin text-yellow-500 mx-auto mb-3" />
                    Carregando avaliações...
                </div>
            ) : (
                <>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <Card className="bg-black border border-yellow-500/30 rounded-2xl">
                            <CardContent className="p-5 text-center">
                                <p className="text-yellow-500 text-2xl font-bold flex items-center justify-center gap-1">
                                    <Star className="h-5 w-5 fill-yellow-500" />
                                    {summary.average > 0 ? summary.average.toFixed(1) : '—'}
                                </p>
                                <p className="text-gray-500 text-xs mt-1">Média</p>
                            </CardContent>
                        </Card>
                        <Card className="bg-black border border-yellow-500/30 rounded-2xl">
                            <CardContent className="p-5 text-center">
                                <p className="text-yellow-500 text-2xl font-bold">{summary.count}</p>
                                <p className="text-gray-500 text-xs mt-1">Opiniões</p>
                            </CardContent>
                        </Card>
                        <Card className="bg-black border border-yellow-500/30 rounded-2xl">
                            <CardContent className="p-5 text-center">
                                <p className="text-yellow-500 text-2xl font-bold">
                                    {summary.withComment}
                                </p>
                                <p className="text-gray-500 text-xs mt-1">Com texto</p>
                            </CardContent>
                        </Card>
                    </div>

                    <div className="flex flex-wrap gap-3 text-xs text-gray-400 font-semibold">
                        {([5, 4, 3, 2, 1] as const).map((star) => (
                            <span key={star}>
                                {star}★ {summary.distribution[star]}
                            </span>
                        ))}
                    </div>

                    <Card className="bg-black border border-yellow-500/30 rounded-2xl">
                        <CardHeader>
                            <CardTitle className="text-white text-lg">Filtros</CardTitle>
                            <CardDescription className="text-gray-400">
                                Filtre por evento, nota e tema. Cada opinião aparece separada abaixo.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
                                <Input
                                    value={filters.search}
                                    onChange={(e) =>
                                        setFilters((prev) => ({ ...prev, search: e.target.value }))
                                    }
                                    placeholder="Buscar na opinião ou evento"
                                    className="pl-9 bg-black/60 border-yellow-500/30 text-white"
                                />
                            </div>

                            <div>
                                <p className="text-sm text-gray-300 font-medium mb-2">Evento</p>
                                <Select
                                    value={filters.eventId}
                                    onValueChange={(eventId) =>
                                        setFilters((prev) => ({
                                            ...prev,
                                            eventId: eventId as FeedbackReportFilters['eventId'],
                                        }))
                                    }
                                >
                                    <SelectTrigger className="bg-black/60 border-yellow-500/30 text-white">
                                        <SelectValue placeholder="Todos os eventos" />
                                    </SelectTrigger>
                                    <SelectContent className="bg-black border-yellow-500/30 text-white">
                                        <SelectItem value="all">Todos</SelectItem>
                                        {(data?.events ?? []).map((ev) => (
                                            <SelectItem key={ev.id} value={ev.id}>
                                                {ev.title}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>

                            <div>
                                <p className="text-sm text-gray-300 font-medium mb-2">Nota</p>
                                <div className="flex flex-wrap gap-2">
                                    {(
                                        [
                                            ['all', 'Todas'],
                                            [5, '5★'],
                                            [4, '4★'],
                                            [3, '3★'],
                                            [2, '2★'],
                                            [1, '1★'],
                                        ] as const
                                    ).map(([key, label]) => (
                                        <FeedbackFilterChip
                                            key={String(key)}
                                            active={filters.rating === key}
                                            onClick={() =>
                                                setFilters((prev) => ({
                                                    ...prev,
                                                    rating: key as FeedbackRatingFilter,
                                                }))
                                            }
                                        >
                                            {label}
                                        </FeedbackFilterChip>
                                    ))}
                                </div>
                            </div>

                            <div>
                                <p className="text-sm text-gray-300 font-medium mb-2">Tema</p>
                                <div className="flex flex-wrap gap-2">
                                    <FeedbackFilterChip
                                        active={filters.tag === 'all'}
                                        onClick={() =>
                                            setFilters((prev) => ({ ...prev, tag: 'all' }))
                                        }
                                    >
                                        Todos
                                    </FeedbackFilterChip>
                                    {EVENT_REVIEW_TAGS.map((tag) => (
                                        <FeedbackFilterChip
                                            key={tag.id}
                                            active={filters.tag === tag.id}
                                            onClick={() =>
                                                setFilters((prev) => ({ ...prev, tag: tag.id }))
                                            }
                                        >
                                            {tag.label}
                                            {data?.tag_counts[tag.id]
                                                ? ` (${data.tag_counts[tag.id]})`
                                                : ''}
                                        </FeedbackFilterChip>
                                    ))}
                                </div>
                            </div>

                            <div>
                                <p className="text-sm text-gray-300 font-medium mb-2">Comentário</p>
                                <div className="flex flex-wrap gap-2">
                                    {(
                                        [
                                            ['all', 'Todos'],
                                            ['with', 'Com opinião'],
                                            ['without', 'Só nota'],
                                        ] as const
                                    ).map(([key, label]) => (
                                        <FeedbackFilterChip
                                            key={key}
                                            active={filters.comment === key}
                                            onClick={() =>
                                                setFilters((prev) => ({
                                                    ...prev,
                                                    comment: key as FeedbackCommentFilter,
                                                }))
                                            }
                                        >
                                            {label}
                                        </FeedbackFilterChip>
                                    ))}
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    <div>
                        <h2 className="text-white font-semibold text-lg mb-4">
                            Opiniões separadas · {summary.count}
                        </h2>
                        {filtered.length === 0 ? (
                            <p className="text-gray-400 text-sm text-center py-10">
                                Nenhuma opinião com esses filtros. Ajuste os filtros ou aguarde
                                avaliações dos clientes.
                            </p>
                        ) : (
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                                {filtered.map((item) => (
                                    <FeedbackOpinionCard key={item.id} item={item} />
                                ))}
                            </div>
                        )}
                    </div>
                </>
            )}
        </div>
    );
};

export default ManagerFeedbackReport;
