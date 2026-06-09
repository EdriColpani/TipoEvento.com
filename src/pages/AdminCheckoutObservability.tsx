import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { ArrowLeft, Activity, AlertTriangle, CheckCircle2, Loader2, RefreshCw } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useProfile } from '@/hooks/use-profile';
import {
    useCheckoutObservability,
    useHighTrafficEvents,
    type CheckoutObservabilityAlert,
} from '@/hooks/use-checkout-observability';
import { formatEventDateForDisplay } from '@/utils/format-event-date';
import { showError } from '@/utils/toast';

const ADMIN_MASTER_USER_TYPE_ID = 1;
const WINDOW_OPTIONS = [5, 15, 30, 60];

const alertClasses = (level: CheckoutObservabilityAlert['level']) => {
    switch (level) {
        case 'critical':
            return 'border-red-500/50 bg-red-950/40 text-red-100';
        case 'warning':
            return 'border-amber-500/50 bg-amber-950/40 text-amber-100';
        default:
            return 'border-cyan-500/50 bg-cyan-950/40 text-cyan-100';
    }
};

const MetricCard: React.FC<{ label: string; value: string | number; hint?: string }> = ({
    label,
    value,
    hint,
}) => (
    <div className="rounded-xl border border-yellow-500/20 bg-black/50 p-4">
        <p className="text-xs uppercase tracking-wide text-gray-400 mb-1">{label}</p>
        <p className="text-2xl font-semibold text-white">{value}</p>
        {hint && <p className="text-xs text-gray-500 mt-1">{hint}</p>}
    </div>
);

const AdminCheckoutObservability: React.FC = () => {
    const navigate = useNavigate();
    const [userId, setUserId] = useState<string | undefined>();
    const [selectedEventId, setSelectedEventId] = useState<string>('');
    const [windowMinutes, setWindowMinutes] = useState(15);

    useEffect(() => {
        supabase.auth.getUser().then(({ data: { user } }) => setUserId(user?.id));
    }, []);

    const { profile, isLoading: isLoadingProfile } = useProfile(userId);
    const isAdminMaster = profile?.tipo_usuario_id === ADMIN_MASTER_USER_TYPE_ID;

    const { data: events = [], isLoading: isLoadingEvents } = useHighTrafficEvents(isAdminMaster);
    const {
        data,
        isLoading,
        isError,
        error,
        refetch,
        isFetching,
    } = useCheckoutObservability(
        selectedEventId || null,
        windowMinutes,
        isAdminMaster && Boolean(selectedEventId),
    );

    useEffect(() => {
        if (isError && error) {
            showError('Não foi possível carregar métricas de checkout.');
        }
    }, [isError, error]);

    useEffect(() => {
        if (!selectedEventId && events.length > 0) {
            setSelectedEventId(events[0].id);
        }
    }, [events, selectedEventId]);

    const integrityOk = data?.inventory?.integrity?.ok !== false;
    const alerts = data?.alerts ?? [];

    const selectedEvent = useMemo(
        () => events.find((e) => e.id === selectedEventId),
        [events, selectedEventId],
    );

    if (isLoadingProfile || !userId) {
        return (
            <div className="max-w-7xl mx-auto flex flex-col items-center justify-center py-24 text-gray-400">
                <Loader2 className="h-10 w-10 animate-spin text-yellow-500 mb-4" />
                <p>Carregando...</p>
            </div>
        );
    }

    if (!isAdminMaster) {
        return (
            <div className="max-w-3xl mx-auto text-center py-20">
                <p className="text-red-400">Acesso restrito ao Admin Master.</p>
                <Button className="mt-4" onClick={() => navigate('/admin/dashboard')}>
                    Voltar
                </Button>
            </div>
        );
    }

    return (
        <div className="max-w-7xl mx-auto">
            <div className="mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <h1 className="text-2xl sm:text-3xl font-serif text-yellow-500 mb-2 flex items-center gap-3">
                        <Activity className="h-7 w-7" />
                        Observabilidade de Checkout
                    </h1>
                    <p className="text-gray-400 text-sm">
                        Métricas em tempo real para eventos com venda de ingressos — reservas, fila, webhooks e integridade de estoque.
                    </p>
                </div>
                <div className="flex flex-wrap gap-2">
                    <Button
                        variant="outline"
                        className="border-yellow-500/30 text-yellow-500"
                        onClick={() => navigate('/admin/dashboard')}
                    >
                        <ArrowLeft className="h-4 w-4 mr-2" />
                        Dashboard
                    </Button>
                    <Button
                        variant="outline"
                        className="border-yellow-500/30 text-yellow-500"
                        onClick={() => refetch()}
                        disabled={!selectedEventId || isFetching}
                    >
                        <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? 'animate-spin' : ''}`} />
                        Atualizar
                    </Button>
                </div>
            </div>

            <Card className="bg-black border border-yellow-500/30 mb-6">
                <CardHeader>
                    <CardTitle className="text-white text-lg">Filtros</CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <p className="text-sm text-gray-400 mb-2">Evento</p>
                        <Select value={selectedEventId} onValueChange={setSelectedEventId}>
                            <SelectTrigger className="bg-black/60 border-yellow-500/30 text-white">
                                <SelectValue placeholder="Selecione um evento" />
                            </SelectTrigger>
                            <SelectContent className="bg-black border-yellow-500/30 text-white">
                                {isLoadingEvents ? (
                                    <div className="px-3 py-2 text-sm text-gray-400">Carregando...</div>
                                ) : events.length === 0 ? (
                                    <div className="px-3 py-2 text-sm text-gray-400">
                                        Nenhum evento com checkout monitorado encontrado.
                                    </div>
                                ) : (
                                    events.map((event) => (
                                        <SelectItem key={event.id} value={event.id} className="hover:bg-yellow-500/10">
                                            {event.title}
                                            {event.date ? ` · ${formatEventDateForDisplay(event.date)}` : ''}
                                        </SelectItem>
                                    ))
                                )}
                            </SelectContent>
                        </Select>
                    </div>
                    <div>
                        <p className="text-sm text-gray-400 mb-2">Janela de análise</p>
                        <Select
                            value={String(windowMinutes)}
                            onValueChange={(v) => setWindowMinutes(Number(v))}
                        >
                            <SelectTrigger className="bg-black/60 border-yellow-500/30 text-white">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent className="bg-black border-yellow-500/30 text-white">
                                {WINDOW_OPTIONS.map((mins) => (
                                    <SelectItem key={mins} value={String(mins)} className="hover:bg-yellow-500/10">
                                        Últimos {mins} minutos
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                </CardContent>
            </Card>

            {selectedEvent && (
                <div className="mb-6 flex flex-wrap gap-2 text-xs">
                    <span className="rounded-full border border-yellow-500/30 px-3 py-1 text-yellow-200">
                        Modo: {selectedEvent.inventory_mode === 'counter' ? 'contador' : 'unit_rows'}
                    </span>
                    {selectedEvent.checkout_queue_enabled && (
                        <span className="rounded-full border border-cyan-500/30 px-3 py-1 text-cyan-200">
                            Fila virtual ativa
                        </span>
                    )}
                    <span
                        className={`rounded-full border px-3 py-1 flex items-center gap-1 ${
                            integrityOk
                                ? 'border-green-500/30 text-green-200'
                                : 'border-red-500/30 text-red-200'
                        }`}
                    >
                        {integrityOk ? (
                            <CheckCircle2 className="h-3.5 w-3.5" />
                        ) : (
                            <AlertTriangle className="h-3.5 w-3.5" />
                        )}
                        Integridade {integrityOk ? 'OK' : 'FALHA'}
                    </span>
                </div>
            )}

            {alerts.length > 0 && (
                <div className="space-y-3 mb-6">
                    {alerts.map((alert) => (
                        <div
                            key={`${alert.code}-${alert.message}`}
                            className={`rounded-xl border p-4 text-sm ${alertClasses(alert.level)}`}
                        >
                            <strong className="uppercase text-xs tracking-wide mr-2">{alert.level}</strong>
                            {alert.message}
                        </div>
                    ))}
                </div>
            )}

            {isLoading && !data ? (
                <div className="flex items-center justify-center py-16 text-gray-400">
                    <Loader2 className="h-8 w-8 animate-spin text-yellow-500 mr-3" />
                    Carregando métricas...
                </div>
            ) : data ? (
                <>
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                        <MetricCard
                            label="Reservas (janela)"
                            value={data.metrics.reservations_window}
                            hint={`${data.metrics.reservations_per_minute}/min`}
                        />
                        <MetricCard
                            label="Pagamentos (janela)"
                            value={data.metrics.payments_window}
                            hint={`${data.metrics.payments_per_minute}/min`}
                        />
                        <MetricCard
                            label="Checkouts pendentes"
                            value={data.metrics.pending_receivables}
                        />
                        <MetricCard
                            label="Ingressos reservados (pending)"
                            value={data.metrics.pending_checkout_tickets}
                        />
                        <MetricCard
                            label="Fila — aguardando"
                            value={data.metrics.queue_waiting}
                        />
                        <MetricCard
                            label="Fila — admitidos"
                            value={data.metrics.queue_admitted}
                        />
                        <MetricCard
                            label="Webhook jobs pendentes"
                            value={data.metrics.webhook_jobs_pending}
                        />
                        <MetricCard
                            label="Conflitos / rate limit"
                            value={`${data.metrics.reserve_conflicts_window} / ${data.metrics.rate_limited_window}`}
                        />
                    </div>

                    {data.inventory && (
                        <Card className="bg-black border border-yellow-500/30 mb-6">
                            <CardHeader>
                                <CardTitle className="text-yellow-500">Estoque</CardTitle>
                                <CardDescription className="text-gray-400">
                                    Capacidade total, vendidos, reservados e disponíveis.
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                <MetricCard label="Capacidade" value={data.inventory.total_capacity} />
                                <MetricCard label="Vendidos" value={data.inventory.sold} />
                                <MetricCard label="Reservados" value={data.inventory.reserved} />
                                <MetricCard label="Disponíveis" value={data.inventory.available} />
                            </CardContent>
                        </Card>
                    )}

                    <Card className="bg-black border border-yellow-500/30">
                        <CardHeader>
                            <CardTitle className="text-white text-lg">Eventos recentes</CardTitle>
                            <CardDescription className="text-gray-400">
                                Últimas operações registradas (reserva, webhook, rate limit).
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            {data.recent_events.length === 0 ? (
                                <p className="text-gray-500 text-sm">
                                    Nenhum evento operacional registrado ainda. Os logs aparecem após checkouts e webhooks.
                                </p>
                            ) : (
                                <div className="space-y-2 max-h-80 overflow-y-auto">
                                    {data.recent_events.map((evt, idx) => (
                                        <div
                                            key={`${evt.created_at}-${idx}`}
                                            className="rounded-lg border border-yellow-500/10 bg-black/40 px-3 py-2 text-sm"
                                        >
                                            <div className="flex flex-wrap items-center justify-between gap-2">
                                                <span className="text-yellow-500 font-mono text-xs">
                                                    {evt.operation}
                                                </span>
                                                <span className="text-gray-500 text-xs">
                                                    {new Date(evt.created_at).toLocaleString('pt-BR')}
                                                </span>
                                            </div>
                                            {evt.correlation_id && (
                                                <p className="text-gray-400 text-xs mt-1 truncate">
                                                    correlation: {evt.correlation_id}
                                                </p>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    <Card className="bg-black border border-cyan-500/30 mt-6">
                        <CardHeader>
                            <CardTitle className="text-cyan-300 text-lg">Teste de carga (k6)</CardTitle>
                            <CardDescription className="text-gray-400">
                                Scripts em <code className="text-cyan-200">load-tests/</code> — ver{' '}
                                <code className="text-cyan-200">load-tests/README.md</code> e{' '}
                                <code className="text-cyan-200">docs/RUNBOOK_GRANDE_PORTE.md</code>.
                            </CardDescription>
                        </CardHeader>
                    </Card>
                </>
            ) : null}
        </div>
    );
};

export default AdminCheckoutObservability;
