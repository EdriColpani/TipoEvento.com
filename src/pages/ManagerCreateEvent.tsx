import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from "@/components/ui/button";
import { Plus, ArrowLeft, Loader2, QrCode } from 'lucide-react';
import { showSuccess, showError } from '@/utils/toast';
import { supabase } from '@/integrations/supabase/client';
import EventFormSteps from '@/components/EventFormSteps';
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useProfile } from '@/hooks/use-profile';
import { clearManagerCreateEventSession } from '@/utils/manager-create-event-session';

const ADMIN_MASTER_USER_TYPE_ID = 1;

const ManagerCreateEvent: React.FC = () => {
    const navigate = useNavigate();
    const [userId, setUserId] = useState<string | null>(null);
    const { profile, isLoading: isLoadingProfile } = useProfile(userId || undefined);
    const [showWristbandModal, setShowWristbandModal] = useState(false);
    const [newEventId, setNewEventId] = useState<string | null>(null);
    const userIdRef = useRef<string | null>(null);
    userIdRef.current = userId;

    useEffect(() => {
        supabase.auth.getUser().then(({ data: { user } }) => {
            setUserId(user?.id || null);
        });
    }, []);

    // Só limpa session ao sair da rota de criar — nunca quando `userId` muda de null→uuid (apagava chaves e gerava 2º INSERT).
    useEffect(() => {
        return () => {
            const uid = userIdRef.current;
            if (uid) clearManagerCreateEventSession(uid);
        };
    }, []);

    const isAdminMaster = profile?.tipo_usuario_id === ADMIN_MASTER_USER_TYPE_ID;

    const handleSaveSuccess = (id: string) => {
        setNewEventId(id);
        setShowWristbandModal(true);
    };

    const handleEmitirPulseiras = () => {
        setShowWristbandModal(false);
        navigate('/manager/wristbands/create', { state: { eventId: newEventId } }); // Passa o ID do evento
    };

    const handleNaoEmitir = () => {
        setShowWristbandModal(false);
        navigate('/manager/events');
    };

    const handleIrParaPulseiras = () => {
        setShowWristbandModal(false);
        navigate('/manager/wristbands', { state: { eventId: newEventId } });
    };

    const handleAutoFill = () => {
        // This functionality will be handled within EventFormSteps if needed,
        // or removed if the auto-fill is only for admin-level testing.
        showError("Funcionalidade de auto-preenchimento movida para o componente de formulário.");
    };

    if (isLoadingProfile || !userId) {
        return (
            <div className="max-w-4xl mx-auto px-4 sm:px-0 text-center py-20">
                <Loader2 className="h-10 w-10 animate-spin text-yellow-500 mx-auto mb-4" />
                <p className="text-gray-400">Carregando dados do gestor...</p>
            </div>
        );
    }

    return (
        <div className="max-w-4xl mx-auto px-4 sm:px-0">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-8">
                <h1 className="text-2xl sm:text-3xl font-serif text-yellow-500 mb-4 sm:mb-0">Criar Novo Evento</h1>
                <div className="flex space-x-3">
                    {isAdminMaster && (
                        <Button 
                            onClick={handleAutoFill}
                            variant="secondary"
                            className="bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 text-sm"
                            disabled={true} // Desabilitado por enquanto, a lógica será movida para EventFormSteps
                        >
                            <i className="fas fa-magic mr-2"></i>
                            Auto-Preencher para Teste
                        </Button>
                    )}
                    <Button 
                        onClick={() => navigate('/manager/events')}
                        variant="outline"
                        className="bg-black/60 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 text-sm"
                    >
                        <ArrowLeft className="mr-2 h-4 w-4" />
                        Voltar para a Lista
                    </Button>
                </div>
            </div>

            <EventFormSteps
                userId={userId}
                onCreateSuccess={handleSaveSuccess}
                draftPersistedEventId={newEventId}
                freezeFormAfterCreate={showWristbandModal}
            />
            
            <AlertDialog open={showWristbandModal} onOpenChange={setShowWristbandModal}>
                <AlertDialogContent className="bg-black/90 border border-yellow-500/30 text-white w-[calc(100vw-1.5rem)] max-w-2xl sm:max-w-2xl overflow-hidden p-5 sm:p-6">
                    <AlertDialogHeader className="text-left space-y-3">
                        <AlertDialogTitle className="text-yellow-500 text-xl font-serif pr-1 select-none outline-none focus:outline-none focus-visible:ring-2 focus-visible:ring-yellow-500/40 focus-visible:ring-offset-2 focus-visible:ring-offset-black rounded-sm">
                            Próxima Etapa: Pulseiras
                        </AlertDialogTitle>
                        <AlertDialogDescription className="text-gray-400 text-left text-sm sm:text-base leading-relaxed">
                            O evento foi criado com sucesso! Você deseja cadastrar as pulseiras de acesso agora?
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    {/* Só Button: AlertDialogAction/Cancel do Radix aplicam estilos que escapam do grid em alguns temas */}
                    <div className="mt-6 flex w-full min-w-0 flex-col gap-3">
                        <Button
                            type="button"
                            variant="outline"
                            onClick={handleEmitirPulseiras}
                            className="w-full min-h-11 h-auto justify-center whitespace-normal py-2.5 px-3 bg-yellow-500 text-black border-0 hover:bg-yellow-600"
                        >
                            <Plus className="h-4 w-4 mr-2 shrink-0" />
                            Emitir Pulseiras
                        </Button>
                        <Button
                            type="button"
                            variant="outline"
                            onClick={handleIrParaPulseiras}
                            className="w-full min-h-11 h-auto justify-center whitespace-normal py-2.5 px-3 bg-black/60 border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10"
                        >
                            <QrCode className="h-4 w-4 mr-2 shrink-0" />
                            Ir para Pulseiras
                        </Button>
                        <Button
                            type="button"
                            variant="outline"
                            onClick={handleNaoEmitir}
                            className="w-full min-h-11 h-auto justify-center whitespace-normal py-2.5 px-3 bg-black/60 border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10"
                        >
                            Não, Voltar para Eventos
                        </Button>
                    </div>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
};

export default ManagerCreateEvent;