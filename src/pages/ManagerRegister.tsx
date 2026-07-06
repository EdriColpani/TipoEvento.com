"use client";

import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Button } from "@/components/ui/button";
import MultiLineEditor from '@/components/MultiLineEditor';
import { Loader2 } from 'lucide-react';
import { showError, showSuccess } from '@/utils/toast';
import { usePageAuth } from '@/hooks/use-page-auth';
import ManagerTypeSelectionDialog from '@/components/ManagerTypeSelectionDialog';
import ManagerUseCaseSelectionDialog from '@/components/ManagerUseCaseSelectionDialog';
import ManagerIndividualRegisterDialog from '@/components/ManagerIndividualRegisterDialog';
import { useQuery } from '@tanstack/react-query';
import { fetchActivePlatformContract } from '@/utils/fetchPlatformContract';
import {
    buildContractAcceptanceAuditMeta,
    recordContractAcceptance,
} from '@/utils/contract-acceptance-audit';
import {
    saveManagerRegistrationUseCase,
    type ManagerRegistrationUseCase,
} from '@/constants/company-kind';

const ADMIN_MASTER_USER_TYPE_ID = 1;

const ManagerRegister: React.FC = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const [agreedToTerms, setAgreedToTerms] = useState(false);
    const [termsScrolledToEnd, setTermsScrolledToEnd] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [showTypeSelectionModal, setShowTypeSelectionModal] = useState(false);
    const [showUseCaseModal, setShowUseCaseModal] = useState(false);
    const [registrationUseCase, setRegistrationUseCase] = useState<ManagerRegistrationUseCase>('organizer');
    const [showIndividualRegisterModal, setShowIndividualRegisterModal] = useState(false);

    const { userId } = usePageAuth();
    const { profile, isLoading: isLoadingProfile } = useProfile(userId);

    const isAdminRegisterRoute = location.pathname === '/admin/register-manager';
    const isAdminMaster = profile?.tipo_usuario_id === ADMIN_MASTER_USER_TYPE_ID;

    const {
        data: platformContract,
        isLoading: isLoadingContract,
        isError: isErrorContract,
    } = useQuery({
        queryKey: ['platformContract', 'company_registration'],
        queryFn: () => fetchActivePlatformContract('company_registration'),
        staleTime: 1000 * 60 * 60,
    });

    const shouldShowAgreementCheckbox = !isAdminRegisterRoute;

    const handleAgreeToTerms = (agreed: boolean, context?: { scrolledToEnd: boolean }) => {
        setAgreedToTerms(agreed);
        setTermsScrolledToEnd(context?.scrolledToEnd ?? false);
    };

    const handleContinue = async () => {
        if (!platformContract) {
            showError('Contrato de adesão indisponível.');
            return;
        }
        if (!agreedToTerms) {
            showError('Aceite o contrato para continuar.');
            return;
        }

        if (!userId) {
            showError('Sessão inválida. Faça login novamente.');
            return;
        }

        try {
            await recordContractAcceptance({
                contractId: platformContract.id,
                contractType: platformContract.contract_type,
                userId,
                audit: buildContractAcceptanceAuditMeta('manager_register', {
                    scrolledToEnd: termsScrolledToEnd,
                }),
            });
        } catch (err) {
            console.error('Erro ao registrar aceite do contrato de adesão:', err);
            showError('Não foi possível registrar o aceite do contrato. Tente novamente.');
            return;
        }

        setShowUseCaseModal(true);
    };

    const handleSelectUseCase = (useCase: ManagerRegistrationUseCase) => {
        setRegistrationUseCase(useCase);
        saveManagerRegistrationUseCase(useCase);
        setShowUseCaseModal(false);
        setShowTypeSelectionModal(true);
    };

    const handleSelectManagerType = (type: 'individual' | 'company') => {
        setShowTypeSelectionModal(false);
        setIsSubmitting(true);

        if (registrationUseCase === 'partner' && type === 'individual') {
            showError('Empresas parceiras devem se cadastrar como Pessoa Jurídica.');
            setIsSubmitting(false);
            setShowTypeSelectionModal(true);
            return;
        }

        if (type === 'individual') {
            // Abre o modal de registro individual
            setShowIndividualRegisterModal(true);
            setIsSubmitting(false);
        } else {
            // Navega para o registro de empresa
            showSuccess(`Você selecionou o cadastro como Pessoa Jurídica.`);
            setTimeout(() => {
                setIsSubmitting(false);
                navigate('/manager/register/company');
            }, 500);
        }
    };

    return (
        <div className="min-h-screen bg-black text-white flex items-center justify-center px-4 sm:px-6 py-12">
            <div className="absolute inset-0 opacity-10">
                <div className="absolute inset-0" style={{
                    backgroundImage: 'radial-gradient(circle at 25% 25%, #fbbf24 0%, transparent 50%), radial-gradient(circle at 75% 75%, #fbbf24 0%, transparent 50%)',
                    backgroundSize: '400px 400px'
                }}></div>
            </div>
            <div className="relative z-10 w-full max-w-sm sm:max-w-[800px] space-y-6">
                <div className="text-center mb-6 sm:mb-8">
                    <div 
                        className="text-3xl font-serif text-yellow-500 font-bold mb-2 cursor-pointer"
                        onClick={() => navigate('/')} 
                    >
                        EventFest
                    </div>
                    <h1 className="text-xl sm:text-2xl font-semibold text-white mb-2">
                        {isAdminRegisterRoute && isAdminMaster ? "Editar Termos de Registro de Gestor" : "Cadastro de Gestor"}
                    </h1>
                    <p className="text-gray-400 text-sm sm:text-base">
                        {isAdminRegisterRoute && isAdminMaster
                            ? 'Edite o contrato em Admin → Contratos (Cadastro da empresa).'
                            : 'Leia e aceite o contrato de adesão à plataforma para continuar'}
                    </p>
                </div>

                {isLoadingContract ? (
                    <div className="text-center py-10">
                        <Loader2 className="h-8 w-8 animate-spin text-yellow-500 mx-auto mb-4" />
                        <p className="text-gray-400">Carregando contrato de adesão...</p>
                    </div>
                ) : isErrorContract || !platformContract ? (
                    <div className="bg-red-500/20 border border-red-500/30 text-red-400 p-6 rounded-xl">
                        <h3 className="text-red-400 text-xl">Contrato indisponível</h3>
                        <p className="text-gray-400 text-sm mt-2">
                            Não foi possível carregar o contrato de adesão. Peça ao administrador para ativar o
                            contrato &quot;Cadastro da empresa (Gestor)&quot; em Admin → Contratos.
                        </p>
                    </div>
                ) : (
                    <MultiLineEditor
                        onAgree={handleAgreeToTerms}
                        initialAgreedState={agreedToTerms}
                        showAgreementCheckbox={shouldShowAgreementCheckbox}
                        externalContent={platformContract.content}
                        externalTitle={platformContract.title}
                    />
                )}

                {!isAdminRegisterRoute && (
                    <div className="space-y-4">
                        <Button
                            onClick={handleContinue}
                            disabled={!agreedToTerms || isSubmitting || !platformContract}
                            className="w-full bg-yellow-500 text-black hover:bg-yellow-600 py-3 text-base sm:text-lg font-semibold transition-all duration-300 cursor-pointer hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
                        >
                            {isSubmitting ? (
                                <div className="flex items-center justify-center">
                                    <Loader2 className="w-5 h-5 border-2 border-black/20 border-t-black rounded-full animate-spin mr-2"></Loader2>
                                    <span>Carregando...</span>
                                </div>
                            ) : (
                                'Continuar'
                            )}
                        </Button>
                        <Button
                            onClick={() => navigate('/')}
                            variant="outline"
                            className="w-full bg-transparent border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 py-3 text-base sm:text-lg font-semibold transition-all duration-300 cursor-pointer"
                        >
                            Voltar para a Home
                        </Button>
                    </div>
                )}
            </div>

            <ManagerUseCaseSelectionDialog
                isOpen={showUseCaseModal}
                onClose={() => setShowUseCaseModal(false)}
                onSelectUseCase={handleSelectUseCase}
                isSubmitting={isSubmitting}
            />

            <ManagerTypeSelectionDialog
                isOpen={showTypeSelectionModal}
                onClose={() => setShowTypeSelectionModal(false)}
                onSelectType={handleSelectManagerType}
                isSubmitting={isSubmitting}
            />
            
            {/* NOVO: Modal de Registro Individual (PF) */}
            <ManagerIndividualRegisterDialog
                isOpen={showIndividualRegisterModal}
                onClose={() => setShowIndividualRegisterModal(false)}
                profile={profile}
                userId={userId}
            />
        </div>
    );
};

export default ManagerRegister;