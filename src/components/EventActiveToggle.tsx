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

interface EventActiveToggleProps {
    eventId: string;
    eventTitle: string;
    isDraft: boolean;
    isActive: boolean;
    onSuccess: () => void;
}

/**
 * Ativa / desativa evento na listagem do gestor (não aparece na vitrine nem aceita novas vendas quando inativo).
 * Rascunhos não exibem o controle.
 */
const EventActiveToggle: React.FC<EventActiveToggleProps> = ({
    eventId,
    eventTitle,
    isDraft,
    isActive,
    onSuccess,
}) => {
    const navigate = useNavigate();
    const [busy, setBusy] = useState(false);
    const [goLiveBlockOpen, setGoLiveBlockOpen] = useState(false);
    const [blockers, setBlockers] = useState<GoLiveChecklistItem[]>([]);

    if (isDraft) {
        return null;
    }

    const applyToggle = async (nextActive: boolean) => {
        setBusy(true);
        const toastId = showLoading(nextActive ? 'Ativando evento...' : 'Desativando evento...');
        try {
            const { error } = await supabase.from('events').update({ is_active: nextActive }).eq('id', eventId);
            if (error) {
                throw error;
            }
            dismissToast(toastId);
            showSuccess(nextActive ? 'Evento ativado novamente.' : 'Evento desativado. Ele sai da vitrine e não aceita novas vendas.');
            onSuccess();
        } catch (err: unknown) {
            dismissToast(toastId);
            const raw = err instanceof Error ? err.message : 'Erro desconhecido';
            const msg = formatTicketInactivityError(formatMinEventTicketsActivationError(raw));
            showError(
                nextActive
                    ? msg
                    : `Não foi possível desativar o evento: ${msg}`,
            );
        } finally {
            setBusy(false);
        }
    };

    const tryActivate = async () => {
        setBusy(true);
        try {
            const checklist = await fetchGoLiveChecklistOnce(eventId);
            if (checklist.applies && checklist.ready !== true) {
                const pending = (checklist.items ?? []).filter(
                    (item) =>
                        item.required
                        && (item.status === 'fail' || item.status === 'pending'
                            || (item.key === 'inventory_configured' && item.status === 'warning')),
                );
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
                        className="shrink-0 bg-black/60 border-green-500/40 text-green-400 hover:bg-green-500/10 h-8 px-3"
                        disabled={busy}
                        onClick={() => void tryActivate()}
                        title="Ativar evento na vitrine. Mega eventos exigem checklist go-live completo."
                    >
                        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Power className="h-4 w-4" />}
                        <span className="ml-1.5 hidden sm:inline">Ativar</span>
                    </Button>
                </span>

                <AlertDialog open={goLiveBlockOpen} onOpenChange={setGoLiveBlockOpen}>
                    <AlertDialogContent className="bg-black/95 border border-amber-500/40 text-white max-w-lg">
                        <AlertDialogHeader>
                            <AlertDialogTitle className="text-amber-300">Checklist go-live incompleto</AlertDialogTitle>
                            <AlertDialogDescription asChild>
                                <div className="text-gray-400 space-y-2 text-sm">
                                    <p>
                                        <strong className="text-white">{eventTitle}</strong> é um evento de grande porte.
                                        Conclua o checklist antes de ativar na vitrine:
                                    </p>
                                    <ul className="list-disc pl-5 space-y-1 text-amber-100/90">
                                        {blockers.map((item) => (
                                            <li key={item.key}>{item.label}</li>
                                        ))}
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
                    className="shrink-0 bg-black/60 border-orange-500/40 text-orange-300 hover:bg-orange-500/10 h-8 px-3"
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
                        afetado; você pode reativar quando quiser.
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
