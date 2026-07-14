import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from "@/components/ui/button";
import { Plus, ArrowLeft, Loader2, QrCode } from 'lucide-react';
import { showSuccess, showError } from '@/utils/toast';
import EventFormSteps from '@/components/EventFormSteps';
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { usePageAuth } from '@/hooks/use-page-auth';
import { useProfile } from '@/hooks/use-profile';
import { useManagerCompany } from '@/hooks/use-manager-company';
import { useCompanyBilling } from '@/hooks/use-company-billing';
import { isCompanyBillingReady } from '@/constants/billing-plans';
import { companyAllowsTicketSales, isListingOnlyCompanyPlan } from '@/utils/company-billing-rules';
import { clearManagerCreateEventSession } from '@/utils/manager-create-event-session';
import { Card, CardContent } from '@/components/ui/card';
import { AlertTriangle } from 'lucide-react';
import { useCompanyTicketInactivity } from '@/hooks/use-company-ticket-inactivity';
import TicketInactivityBanner from '@/components/TicketInactivityBanner';
import TicketChargebackBlockBanner from '@/components/TicketChargebackBlockBanner';
import { useCompanyTicketChargebackBlock } from '@/hooks/use-company-ticket-chargeback-block';

const ADMIN_MASTER_USER_TYPE_ID = 1;

const ManagerCreateEvent: React.FC = () => {
    const navigate = useNavigate();
    const { userId: authUserId, authPending } = usePageAuth();
    const userId = authUserId ?? null;
    const { profile, isLoading: isLoadingProfile } = useProfile(authUserId);
    const { company, isLoading: isLoadingCompany } = useManagerCompany(userId || undefined);
    const { billing, isLoading: isLoadingBilling } = useCompanyBilling(company?.id);
    const isAdminMaster = profile?.tipo_usuario_id === ADMIN_MASTER_USER_TYPE_ID;
    const billingReady = isCompanyBillingReady(billing);
    const isListingPlan = isListingOnlyCompanyPlan(billing?.billing_plan);
    const requiresTicketSales = companyAllowsTicketSales(billing?.billing_plan);
    const needsBillingConfirm = !isAdminMaster && !!company?.id && !isLoadingBilling && !billingReady;
    const { data: inactivityStatus, isLoading: isLoadingInactivity } = useCompanyTicketInactivity(
        company?.id,
        !isAdminMaster,
    );
    const { data: chargebackBlock, isLoading: isLoadingChargebackBlock } = useCompanyTicketChargebackBlock(
        company?.id,
        !isAdminMaster,
    );
    const [showWristbandModal, setShowWristbandModal] = useState(false);
    const [newEventId, setNewEventId] = useState<string | null>(null);
    const userIdRef = useRef<string | null>(null);
    userIdRef.current = userId;

    const waitingSession = authPending;
    const waitingData = Boolean(authUserId) && (isLoadingProfile || isLoadingCompany);

    useEffect(() => {
        return () => {
            const uid = userIdRef.current;
            if (uid) clearManagerCreateEventSession(uid);
        };
    }, []);

    const handleSaveSuccess = (id: string) => {
        setNewEventId(id);
        if (isListingPlan) {
            showSuccess('Evento de divulgação criado com sucesso!');
            navigate('/manager/events');
            return;
        }
        setShowWristbandModal(true);
    };

    const handleIrParaEventos = () => {
        setShowWristbandModal(false);
        navigate('/manager/events');
    };

    const handleEditarEvento = () => {
        setShowWristbandModal(false);
        if (newEventId) {
            navigate(`/manager/events/edit/${newEventId}`);
        } else {
            navigate('/manager/events');
        }
    };

    const handleVerEstoque = () => {
        setShowWristbandModal(false);
        navigate('/manager/wristbands');
    };

    const handleAutoFill = () => {
        // This functionality will be handled within EventFormSteps if needed,
        // or removed if the auto-fill is only for admin-level testing.
        showError("Funcionalidade de auto-preenchimento movida para o componente de formulário.");
    };

    if (waitingSession || waitingData) {
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

            <TicketInactivityBanner status={inactivityStatus} isLoading={isLoadingInactivity} />

            <TicketChargebackBlockBanner
                status={chargebackBlock}
                isLoading={isLoadingChargebackBlock}
            />

            {needsBillingConfirm && (
                <Card className="mb-6 bg-amber-500/10 border border-amber-500/40">
                    <CardContent className="pt-6 flex gap-3">
                        <AlertTriangle className="h-6 w-6 text-amber-400 shrink-0" />
                        <div className="text-sm text-amber-100">
                            <p className="font-medium">Confirme o plano da empresa antes de criar eventos</p>
                            <p className="mt-1 text-amber-200/90">
                                Acesse Configurações → Perfil da Empresa → aba Plano e cobrança, confirme o plano
                                e aceite o contrato.
                            </p>
                            <Button
                                type="button"
                                className="mt-3 bg-yellow-500 text-black hover:bg-yellow-600"
                                onClick={() => navigate('/manager/settings/company-profile')}
                            >
                                Ir para Plano e cobrança
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            )}

            {!needsBillingConfirm && chargebackBlock?.blocked && !isAdminMaster ? (
                <Card className="bg-black border-yellow-500/30">
                    <CardContent className="pt-6 text-sm text-gray-400">
                        O formulário de criação fica indisponível enquanto houver 3 ou mais chargebacks de
                        ingresso em aberto. Após a EventFest confirmar o recebimento, atualize a página —
                        a liberação é automática.
                    </CardContent>
                </Card>
            ) : (
                <EventFormSteps
                    userId={userId}
                    onCreateSuccess={handleSaveSuccess}
                    draftPersistedEventId={newEventId}
                    freezeFormAfterCreate={showWristbandModal}
                />
            )}
            
            {!isListingPlan && (
            <AlertDialog
                open={showWristbandModal}
                onOpenChange={(open) => {
                    if (!open && requiresTicketSales) return;
                    setShowWristbandModal(open);
                }}
            >
                <AlertDialogContent className="bg-black/90 border border-yellow-500/30 text-white w-[calc(100vw-1.5rem)] max-w-2xl sm:max-w-2xl overflow-hidden p-5 sm:p-6">
                    <AlertDialogHeader className="text-left space-y-3">
                        <AlertDialogTitle className="text-yellow-500 text-xl font-serif pr-1 select-none outline-none focus:outline-none focus-visible:ring-2 focus-visible:ring-yellow-500/40 focus-visible:ring-offset-2 focus-visible:ring-offset-black rounded-sm">
                            Evento criado
                        </AlertDialogTitle>
                        <AlertDialogDescription className="!text-gray-300 hover:!text-gray-300 text-left text-sm sm:text-base leading-relaxed">
                            {requiresTicketSales
                                ? 'Os ingressos vêm dos lotes que você definiu. Valide o checklist go-live e clique em Ativar em Meus Eventos para publicar na vitrine.'
                                : 'O evento foi criado. Ative-o em Meus Eventos quando estiver pronto para publicar na vitrine.'}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    {/* Só Button: AlertDialogAction/Cancel do Radix aplicam estilos que escapam do grid em alguns temas */}
                    <div className="mt-6 flex w-full min-w-0 flex-col gap-3">
                        <Button
                            type="button"
                            variant="outline"
                            onClick={handleIrParaEventos}
                            className="w-full min-h-11 h-auto justify-center whitespace-normal py-2.5 px-3 border-0 bg-yellow-500 !text-black hover:!bg-yellow-600 hover:!text-black focus-visible:!text-black"
                        >
                            <Plus className="h-4 w-4 mr-2 shrink-0" />
                            Ir para Meus Eventos
                        </Button>
                        {newEventId && (
                        <Button
                            type="button"
                            variant="outline"
                            onClick={handleEditarEvento}
                            className="w-full min-h-11 h-auto justify-center whitespace-normal py-2.5 px-3 border-yellow-500/30 bg-black/60 !text-yellow-400 hover:!bg-yellow-500/15 hover:!text-yellow-300 focus-visible:!text-yellow-300 focus-visible:ring-yellow-500/40"
                        >
                            Editar evento / lotes
                        </Button>
                        )}
                        <Button
                            type="button"
                            variant="outline"
                            onClick={handleVerEstoque}
                            className="w-full min-h-11 h-auto justify-center whitespace-normal py-2.5 px-3 border-yellow-500/30 bg-black/60 !text-yellow-400 hover:!bg-yellow-500/15 hover:!text-yellow-300 focus-visible:!text-yellow-300 focus-visible:ring-yellow-500/40"
                        >
                            <QrCode className="h-4 w-4 mr-2 shrink-0" />
                            Ver estoque
                        </Button>
                    </div>
                </AlertDialogContent>
            </AlertDialog>
            )}
        </div>
    );
};

export default ManagerCreateEvent;