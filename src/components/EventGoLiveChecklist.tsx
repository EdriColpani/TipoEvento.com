import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Loader2, CheckCircle2, XCircle, AlertTriangle, Circle, Rocket, ExternalLink } from 'lucide-react';
import {
    useEventGoLiveChecklist,
    useSetGoLiveAcknowledgement,
    type GoLiveChecklistItem,
    type GoLiveItemStatus,
} from '@/hooks/use-event-go-live-checklist';
import { showError } from '@/utils/toast';

const STATUS_ICON: Record<GoLiveItemStatus, React.ReactNode> = {
    pass: <CheckCircle2 className="h-5 w-5 text-green-400 shrink-0" />,
    fail: <XCircle className="h-5 w-5 text-red-400 shrink-0" />,
    warning: <AlertTriangle className="h-5 w-5 text-amber-400 shrink-0" />,
    pending: <Circle className="h-5 w-5 text-gray-500 shrink-0" />,
};

interface EventGoLiveChecklistProps {
    eventId: string;
    compact?: boolean;
}

const EventGoLiveChecklist: React.FC<EventGoLiveChecklistProps> = ({ eventId, compact = false }) => {
    const { data, isLoading, isError, refetch, isFetching } = useEventGoLiveChecklist(eventId);
    const ackMutation = useSetGoLiveAcknowledgement(eventId);
    const [pendingKey, setPendingKey] = useState<string | null>(null);

    const handleManualToggle = async (item: GoLiveChecklistItem, checked: boolean) => {
        setPendingKey(item.key);
        try {
            await ackMutation.mutateAsync({
                eventId,
                itemKey: item.key,
                acknowledged: checked,
            });
        } catch (err) {
            showError(err instanceof Error ? err.message : 'Erro ao salvar confirmação.');
        } finally {
            setPendingKey(null);
        }
    };

    if (isLoading) {
        return (
            <Card className="bg-black border border-yellow-500/30 mb-6">
                <CardContent className="py-8 flex items-center justify-center text-gray-400">
                    <Loader2 className="h-6 w-6 animate-spin text-yellow-500 mr-2" />
                    Carregando checklist go-live...
                </CardContent>
            </Card>
        );
    }

    if (isError || !data) {
        return null;
    }

    if (!data.applies) {
        if (compact) return null;
        return (
            <Card className="bg-black/40 border border-gray-700/50 mb-6">
                <CardContent className="py-4 text-sm text-gray-400">
                    {data.message ?? 'Checklist go-live disponível para eventos pagos com venda de ingressos.'}
                </CardContent>
            </Card>
        );
    }

    const items = data.items ?? [];
    const ready = data.auto_ready === true || data.ready === true;

    return (
        <Card className={`bg-black border mb-6 ${ready ? 'border-green-500/40' : 'border-amber-500/40'}`}>
            <CardHeader className={compact ? 'pb-3' : undefined}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                        <CardTitle className="text-lg text-white flex items-center gap-2">
                            <Rocket className={`h-5 w-5 ${ready ? 'text-green-400' : 'text-amber-400'}`} />
                            Checklist Go-Live
                        </CardTitle>
                        <CardDescription className="text-gray-400 mt-1">
                            Itens em verde liberam o botão Ativar. Itens manuais (runbook, k6) são recomendados para o
                            dia da venda, mas não bloqueiam a ativação na vitrine.
                        </CardDescription>
                    </div>
                    <div className="text-right">
                        <span
                            className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${
                                ready
                                    ? 'bg-green-500/15 text-green-300 border border-green-500/30'
                                    : 'bg-amber-500/15 text-amber-200 border border-amber-500/30'
                            }`}
                        >
                            {data.ready_count}/{data.required_count} concluídos
                        </span>
                        {!compact && (
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="mt-2 text-yellow-500 hover:text-yellow-400"
                                onClick={() => refetch()}
                                disabled={isFetching}
                            >
                                {isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Atualizar'}
                            </Button>
                        )}
                    </div>
                </div>
            </CardHeader>
            <CardContent className="space-y-3">
                {items.map((item) => (
                    <div
                        key={item.key}
                        className="flex items-start gap-3 rounded-xl border border-yellow-500/10 bg-black/40 p-3"
                    >
                        {STATUS_ICON[item.status]}
                        <div className="flex-1 min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                                <p className="text-sm font-medium text-white">{item.label}</p>
                                {item.kind === 'auto' && (
                                    <span className="text-[10px] uppercase tracking-wide text-gray-500">automático</span>
                                )}
                            </div>
                            {item.message && (
                                <p className="text-xs text-gray-400 mt-1">{item.message}</p>
                            )}
                        </div>
                        {item.kind === 'manual' && (
                            <div className="flex items-center gap-2 shrink-0">
                                {pendingKey === item.key ? (
                                    <Loader2 className="h-4 w-4 animate-spin text-yellow-500" />
                                ) : (
                                    <Checkbox
                                        checked={item.acknowledged === true}
                                        onCheckedChange={(v) => void handleManualToggle(item, v === true)}
                                        className="border-yellow-500 data-[state=checked]:bg-yellow-500 data-[state=checked]:text-black"
                                    />
                                )}
                            </div>
                        )}
                    </div>
                ))}

                {!compact && (
                    <div className="pt-2 flex flex-wrap gap-3 text-xs text-gray-400">
                        <span>
                            Runbook: <code className="text-cyan-300">docs/RUNBOOK_GRANDE_PORTE.md</code>
                        </span>
                        <span>
                            Testes k6: <code className="text-cyan-300">load-tests/README.md</code>
                        </span>
                        <a
                            href="/admin/settings/checkout-observability"
                            className="inline-flex items-center gap-1 text-cyan-400 hover:text-cyan-300"
                        >
                            Observabilidade admin
                            <ExternalLink className="h-3 w-3" />
                        </a>
                    </div>
                )}

                {!ready && (
                    <p className="text-sm text-amber-200/90 pt-2 border-t border-amber-500/20">
                        Corrija os itens automáticos em vermelho. Depois use o botão <strong className="text-white">Ativar</strong> na
                        lista de eventos.
                    </p>
                )}
            </CardContent>
        </Card>
    );
};

export default EventGoLiveChecklist;
