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
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Trash2, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { showSuccess, showError, showLoading, dismissToast } from '@/utils/toast';

interface DeleteEventDialogProps {
    eventId: string;
    eventTitle: string;
    onDeleteSuccess: () => void;
}

const DeleteEventDialog: React.FC<DeleteEventDialogProps> = ({ eventId, eventTitle, onDeleteSuccess }) => {
    const [isDeleting, setIsDeleting] = useState(false);

    const handleDelete = async () => {
        setIsDeleting(true);
        const toastId = showLoading(`Excluindo evento "${eventTitle}"...`);

        try {
            // A política RLS garante que apenas o proprietário possa deletar
            const { error } = await supabase
                .from('events')
                .delete()
                .eq('id', eventId);

            if (error) {
                throw error;
            }

            dismissToast(toastId);
            showSuccess(`Evento "${eventTitle}" excluído com sucesso.`);
            onDeleteSuccess(); // Notifica o componente pai para recarregar a lista

        } catch (error: any) {
            dismissToast(toastId);
            console.error("Erro ao deletar evento:", error);
            showError(`Falha ao excluir evento: ${error.message || 'Erro desconhecido'}`);
        } finally {
            setIsDeleting(false);
        }
    };

    return (
        <span className="inline-flex shrink-0 align-middle">
            <AlertDialog>
                <AlertDialogTrigger asChild>
                    <Button
                        variant="destructive"
                        size="sm"
                        className="shrink-0 bg-red-500/20 text-red-400 hover:bg-red-500/30 h-8 w-8 p-0"
                        disabled={isDeleting}
                    >
                        {isDeleting ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                            <Trash2 className="h-4 w-4" />
                        )}
                    </Button>
                </AlertDialogTrigger>
            <AlertDialogContent className="bg-black/90 border border-red-500/30 text-white">
                <AlertDialogHeader>
                    <AlertDialogTitle className="text-red-400">Tem certeza absoluta?</AlertDialogTitle>
                    <AlertDialogDescription className="text-gray-400">
                        Esta ação não pode ser desfeita. Isso excluirá permanentemente o evento 
                        <span className="font-semibold text-white"> "{eventTitle}" </span> 
                        e todos os dados associados.
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel className="bg-black/60 border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10">
                        Cancelar
                    </AlertDialogCancel>
                    <AlertDialogAction 
                        onClick={handleDelete} 
                        className="bg-red-600 text-white hover:bg-red-700"
                        disabled={isDeleting}
                    >
                        {isDeleting ? 'Excluindo...' : 'Excluir Evento'}
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
            </AlertDialog>
        </span>
    );
};

export default DeleteEventDialog;