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
import { supabase } from '@/integrations/supabase/client';
import { showSuccess, showError, showLoading, dismissToast } from '@/utils/toast';

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
    const [busy, setBusy] = useState(false);

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
            const msg = err instanceof Error ? err.message : 'Erro desconhecido';
            showError(`Não foi possível atualizar o evento: ${msg}`);
        } finally {
            setBusy(false);
        }
    };

    if (!isActive) {
        return (
            <span className="inline-flex shrink-0 align-middle">
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="shrink-0 bg-black/60 border-green-500/40 text-green-400 hover:bg-green-500/10 h-8 px-3"
                    disabled={busy}
                    onClick={() => applyToggle(true)}
                    title="Ativar evento na vitrine"
                >
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Power className="h-4 w-4" />}
                    <span className="ml-1.5 hidden sm:inline">Ativar</span>
                </Button>
            </span>
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
