import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from "@/components/ui/button";
import { Plus, ArrowLeft, Loader2, QrCode } from 'lucide-react';
import { showSuccess, showError } from '@/utils/toast';
import { supabase } from '@/integrations/supabase/client';
import EventFormSteps from '@/components/EventFormSteps';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useProfile } from '@/hooks/use-profile';

const ADMIN_MASTER_USER_TYPE_ID = 1;

const ManagerCreateEvent: React.FC = () => {
    const navigate = useNavigate();
    const [userId, setUserId] = useState<string | null>(null);
    const { profile, isLoading: isLoadingProfile } = useProfile(userId || undefined);
    const [showWristbandModal, setShowWristbandModal] = useState(false);
    const [newEventId, setNewEventId] = useState<string | null>(null);

    useEffect(() => {
        supabase.auth.getUser().then(({ data: { user } }) => {
            setUserId(user?.id || null);
        });
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

            <EventFormSteps userId={userId} onCreateSuccess={handleSaveSuccess} />
            
            <AlertDialog open={showWristbandModal} onOpenChange={setShowWristbandModal}>
                <AlertDialogContent className="bg-black/90 border border-yellow-500/30 text-white">
                    <AlertDialogHeader>
                        <AlertDialogTitle className="text-yellow-500 text-xl">Próxima Etapa: Pulseiras</AlertDialogTitle>
                        <AlertDialogDescription className="text-gray-400">
                            O evento foi criado com sucesso! Você deseja cadastrar as pulseiras de acesso agora?
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter className="flex-col sm:flex-row gap-2">
                        <AlertDialogCancel
                            onClick={handleNaoEmitir}
                            className="bg-black/60 border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 order-3 sm:order-1"
                        >
                            Não, Voltar para Eventos
                        </AlertDialogCancel>
                        <Button
                            type="button"
                            variant="outline"
                            onClick={handleIrParaPulseiras}
                            className="bg-black/60 border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 order-2"
                        >
                            <QrCode className="h-4 w-4 mr-2" />
                            Ir para Pulseiras
                        </Button>
                        <AlertDialogAction
                            onClick={handleEmitirPulseiras}
                            className="bg-yellow-500 text-black hover:bg-yellow-600 order-1 sm:order-3"
                        >
                            <Plus className="h-4 w-4 mr-2" />
                            Emitir Pulseiras
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
};

export default ManagerCreateEvent;