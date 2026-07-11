import React, { useState } from 'react';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Power, Loader2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { showSuccess, showError, showLoading, dismissToast } from '@/utils/toast';
import { formatMinEventTicketsActivationError } from '@/utils/min-event-tickets-errors';
import { formatTicketInactivityError } from '@/utils/ticket-inactivity-errors';
import { fetchGoLiveChecklistOnce, type GoLiveChecklistItem } from '@/hooks/use-event-go-live-checklist';
import { getGoLiveAutoBlockers, getGoLiveFixAction, isGoLiveAutoReady } from '@/utils/go-live-activation';
import { isEventLifecycleEnded } from '@/utils/event-lifecycle';

interface EventActiveToggleProps {
    eventId: string;
    eventTitle: string;
    isDraft: boolean;
    isActive: boolean;
    eventDate?: string | null;
    eventTime?: string | null;
    lifecycleEndedAt?: string | null;
    isAdminMaster?: boolean;
    onSuccess: () => void;
}

/**
 * Ativa / desativa evento na listagem do gestor (não aparece na vitrine nem aceita novas vendas quando inativo).
 * Rascunhos não exibem o controle.
 * Evento encerrado (início + 1 dia): só Admin Master pode reativar.
 */
const EventActiveToggle: React.FC<EventActiveToggleProps> = ({
    eventId,
    eventTitle,
    isDraft,
    isActive,
    eventDate,
    eventTime,
    lifecycleEndedAt,
    isAdminMaster = false,
    onSuccess,
}) => {
    const navigate = useNavigate();
    const [busy, setBusy] = useState(false);
    const [goLiveBlockOpen, setGoLiveBlockOpen] = useState(false);
    const [blockers, setBlockers] = useState<GoLiveChecklistItem[]>([]);

    if (isDraft) {
        return null;
    }

    const lifecycleEnded =
        Boolean(lifecycleEndedAt) || isEventLifecycleEnded(eventDate, eventTime);
    const canReactivate = !lifecycleEnded || isAdminMaster;

    const applyToggle = async (nextActive: boolean) => {
        setBusy(true);
        const toastId = showLoading(nextActive ? 'Ativando evento...' : 'Desativando evento...');
        try {
            const { error } = await supabase.from('events').update({ is_active: nextActive }).eq('id', eventId);
            if (error) {
                throw error;
            }
            dismissToast(toastId);
            showSuccess(
                nextActive
                    ? 'Evento ativado novamente.'
                    : 'Evento desativado. Ele sai da vitrine e não aceita novas vendas.',
            );
            onSuccess();
        } catch (err: unknown) {
            dismissToast(toastId);
            const raw = err instanceof Error ? err.message : 'Erro desconhecido';
            const msg = formatTicketInactivityError(formatMinEventTicketsActivationError(raw));
            const lifecycleMsg = /EVENT_LIFECYCLE_ENDED/i.test(raw)
                ? 'Este evento já foi realizado. Somente o administrador pode reativá-lo.'
                : msg;
            showError(nextActive ? lifecycleMsg : `Não foi possível desativar o evento: ${msg}`);
        } finally {
            setBusy(false);
        }
    };

    const tryActivate = async () => {
        if (lifecycleEnded && !isAdminMaster) {
            showError('Este evento já foi realizado. Somente o administrador pode reativá-lo.');
            return;
        }
        setBusy(true);
        try {
            const checklist = await fetchGoLiveChecklistOnce(eventId);
            if (checklist.applies && !isGoLiveAutoReady(checklist)) {
                const pending = getGoLiveAutoBlockers(checklist.items);
                setBlockers(pending);
                setGoLiveBlockOpen(true);
                return;
            }
            await applyToggle(true);
        } catch (err) {
            showError(err instanceof Error ? err.message : 'Erro ao validar checklist go-live.');
        } finally {
            setBusy(false);
        }
    };

    if (!isActive) {
        return (
            <>
                <span className="inline-flex shrink-0 align-middle">
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="shrink-0 border-green-500/40 bg-black/60 text-green-400 hover:bg-green-500/15 hover:text-green-300 h-8 px-3 disabled:opacity-50"
                        disabled={busy || !canReactivate}
                        onClick={() => void tryActivate()}
                        title={
                            !canReactivate
                                ? 'Evento encerrado — só o administrador pode reativar'
                                : 'Ativar evento na vitrine. Mega eventos exigem checklist go-live completo.'
                        }
                    >
                        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Power className="h-4 w-4" />}
                        <span className="ml-1.5 hidden sm:inline">
                            {lifecycleEnded && !isAdminMaster ? 'Encerrado' : 'Ativar'}
                        </span>
                    </Button>
                </span>

                <AlertDialog open={goLiveBlockOpen} onOpenChange={setGoLiveBlockOpen}>
                    <AlertDialogContent className="bg-black/95 border border-amber-500/40 text-white max-w-lg">
                        <AlertDialogHeader>
                            <AlertDialogTitle className="text-amber-300">Ainda não dá para ativar</AlertDialogTitle>
                            <AlertDialogDescription asChild>
                                <div className="text-gray-400 space-y-3 text-sm">
                                    <p>
                                        <strong className="text-white">{eventTitle}</strong> — corrija os itens
                                        obrigatórios abaixo e clique em <strong className="text-white">Ativar</strong> de novo:
                                    </p>
                                    <ul className="space-y-2">
                                        {blockers.map((item) => {
                                            const fix = getGoLiveFixAction(item.key, eventId);
                                            return (
                                                <li
                                                    key={item.key}
                                                    className="rounded-lg border border-red-500/20 bg-red-950/30 p-2 text-red-100/90"
                                                >
                                                    <p className="font-medium text-white">{item.label}</p>
                                                    {item.message && (
                                                        <p className="text-xs mt-1 text-gray-300">{item.message}</p>
                                                    )}
                                                    {fix && (
                                                        <button
                                                            type="button"
                                                            className="text-yellow-400 underline text-xs mt-1 hover:text-yellow-300"
                                                            onClick={() => {
                                                                setGoLiveBlockOpen(false);
                                                                navigate(fix.path);
                                                            }}
                                                        >
                                                            {fix.label}
                                                        </button>
                                                    )}
                                                </li>
                                            );
                                        })}
                                    </ul>
                                </div>
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel className="bg-black/60 border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10">
                                Fechar
                            </AlertDialogCancel>
                            <AlertDialogAction
                                className="bg-yellow-500 text-black hover:bg-yellow-600"
                                onClick={() => navigate(`/manager/events/edit/${eventId}`)}
                            >
                                Abrir checklist
                            </AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            </>
        );
    }

    return (
        <span className="inline-flex shrink-0 align-middle">
        <AlertDialog>
            <AlertDialogTrigger asChild>
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="shrink-0 border-orange-500/40 bg-black/60 text-orange-300 hover:bg-orange-500/15 hover:text-orange-200 h-8 px-3"
                    disabled={busy}
                    title="Desativar evento (remove da vitrine)"
                >
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Power className="h-4 w-4" />}
                    <span className="ml-1.5 hidden sm:inline">Desativar</span>
                </Button>
            </AlertDialogTrigger>
            <AlertDialogContent className="bg-black/95 border border-orange-500/30 text-white">
                <AlertDialogHeader>
                    <AlertDialogTitle className="text-orange-300">Desativar evento?</AlertDialogTitle>
                    <AlertDialogDescription className="text-gray-400">
                        <span className="font-semibold text-white">"{eventTitle}"</span> deixará de aparecer na vitrine
                        pública e não aceitará novas compras ou inscrições. Quem já comprou ou se inscreveu não é
                        afetado; você pode reativar quando quiser (exceto após o encerramento automático).
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel className="bg-black/60 border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10">
                        Cancelar
                    </AlertDialogCancel>
                    <AlertDialogAction
                        className="bg-orange-600 text-white hover:bg-orange-700"
                        disabled={busy}
                        onClick={() => {
                            void applyToggle(false);
                        }}
                    >
                        Desativar
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
        </span>
    );
};

export default EventActiveToggle;
