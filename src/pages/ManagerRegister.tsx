"use client";

import React, { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Button } from "@/components/ui/button";
import MultiLineEditor from '@/components/MultiLineEditor';
import ContractOtpAcceptanceDialog from '@/components/ContractOtpAcceptanceDialog';
import { Loader2 } from 'lucide-react';
import { showError, showSuccess } from '@/utils/toast';
import { usePageAuth } from '@/hooks/use-page-auth';
import { useProfile } from '@/hooks/use-profile';
import ManagerTypeSelectionDialog from '@/components/ManagerTypeSelectionDialog';
import ManagerUseCaseSelectionDialog from '@/components/ManagerUseCaseSelectionDialog';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchActivePlatformContract } from '@/utils/fetchPlatformContract';
import {
    saveManagerRegistrationUseCase,
    type ManagerRegistrationUseCase,
} from '@/constants/company-kind';
import { supabase } from '@/integrations/supabase/client';
import { fetchManagerPrimaryCompanyId } from '@/utils/manager-scope';
import { resolveManagerPostLoginPath } from '@/utils/manager-post-login-path';
import { MANAGER_ACCOUNT_REGISTER_PATH } from '@/utils/promoter-registration-flow';
import { clearCompanyRegistrationPostpone } from '@/utils/manager-company-registration';
import {
    MANAGER_INDIVIDUAL_REGISTER_PATH,
    saveManagerRegistrationKind,
} from '@/utils/manager-registration-kind';
import { useManagerCompanyContractAcceptances } from '@/hooks/use-manager-contract-acceptances';
import { hasSignedCompanyRegistration } from '@/constants/manager-onboarding-gate';
import { useClientToManagerTransitionWarning } from '@/hooks/use-client-to-manager-transition-warning';

const ADMIN_MASTER_USER_TYPE_ID = 1;

const MANAGER_CONTRACT_AGREEMENT_LABEL =
    'Declaro que li, compreendi e concordo integralmente com este Contrato de Prestação de Serviços EventFest e, quando aplicável, declaro possuir poderes para representar a empresa CONTRATANTE.';

const ManagerRegister: React.FC = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const queryClient = useQueryClient();
    const [agreedToTerms, setAgreedToTerms] = useState(false);
    const [termsScrolledToEnd, setTermsScrolledToEnd] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [otpDialogOpen, setOtpDialogOpen] = useState(false);
    const [showTypeSelectionModal, setShowTypeSelectionModal] = useState(false);
    const [showUseCaseModal, setShowUseCaseModal] = useState(false);
    const [registrationUseCase, setRegistrationUseCase] = useState<ManagerRegistrationUseCase>('organizer');

    const { userId } = usePageAuth();
    const { profile, isLoading: isLoadingProfile } = useProfile(userId);

    const isAdminRegisterRoute = location.pathname === '/admin/register-manager';
    const isAdminMaster = profile?.tipo_usuario_id === ADMIN_MASTER_USER_TYPE_ID;

    const {
        data: companyId,
        isLoading: isLoadingCompany,
    } = useQuery({
        queryKey: ['managerPrimaryCompany', userId],
        queryFn: () => fetchManagerPrimaryCompanyId(supabase, userId!),
        enabled: Boolean(userId) && !isAdminRegisterRoute,
        staleTime: 15_000,
    });

    const { data: acceptancesData, isLoading: isLoadingAcceptances } =
        useManagerCompanyContractAcceptances(companyId);

    const hasSignedCompanyRegistrationContract = hasSignedCompanyRegistration(acceptancesData?.items);

    const { requestClientToManagerTransition, transitionWarningDialog } =
        useClientToManagerTransitionWarning();

    const needsCompanyFirst = !isAdminRegisterRoute && !companyId;
    const showContractStep =
        isAdminRegisterRoute || (Boolean(companyId) && !hasSignedCompanyRegistrationContract);

    const {
        data: platformContract,
        isLoading: isLoadingContract,
        isError: isErrorContract,
    } = useQuery({
        queryKey: ['platformContract', 'company_registration'],
        queryFn: () => fetchActivePlatformContract('company_registration'),
        staleTime: 1000 * 60 * 60,
        enabled: showContractStep || isAdminRegisterRoute,
    });

    const shouldShowAgreementCheckbox = !isAdminRegisterRoute;

    useEffect(() => {
        if (isAdminRegisterRoute || !userId || isLoadingCompany || isLoadingAcceptances) return;
        if (!companyId || !hasSignedCompanyRegistrationContract) return;

        let cancelled = false;
        void (async () => {
            const path = await resolveManagerPostLoginPath(userId);
            if (!cancelled) {
                navigate(path, { replace: true });
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [
        isAdminRegisterRoute,
        userId,
        companyId,
        hasSignedCompanyRegistrationContract,
        isLoadingCompany,
        isLoadingAcceptances,
        navigate,
    ]);

    const handleAgreeToTerms = (agreed: boolean, context?: { scrolledToEnd: boolean }) => {
        setAgreedToTerms(agreed);
        setTermsScrolledToEnd(context?.scrolledToEnd ?? false);
    };

    const handleStartRegistration = () => {
        requestClientToManagerTransition(() => {
            clearCompanyRegistrationPostpone();
            setShowUseCaseModal(true);
        });
    };

    const handleContinueToSign = () => {
        if (!platformContract) {
            showError('Contrato de adesão indisponível.');
            return;
        }
        if (!agreedToTerms) {
            showError('Marque a declaração de aceite para continuar.');
            return;
        }
        if (!termsScrolledToEnd) {
            showError('Role o contrato até o final antes de continuar.');
            return;
        }
        if (!userId) {
            showError('Sessão inválida. Faça login novamente.');
            return;
        }
        if (!companyId) {
            showError('Cadastre a empresa antes de assinar o contrato.');
            return;
        }
        setOtpDialogOpen(true);
    };

    const handleContractAccepted = async () => {
        showSuccess('Contrato assinado com sucesso.');
        if (!userId) {
            navigate('/');
            return;
        }
        if (companyId) {
            await queryClient.invalidateQueries({
                queryKey: ['managerRegistrationContractGate', userId],
            });
        }
        const path = await resolveManagerPostLoginPath(userId);
        navigate(path, { replace: true });
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
            saveManagerRegistrationKind('individual');
            if (!userId) {
                showError('Crie sua conta e confirme o e-mail antes do cadastro de Pessoa Física.');
                setIsSubmitting(false);
                navigate(MANAGER_ACCOUNT_REGISTER_PATH, {
                    state: { from: '/manager/register', fromPromoterCta: true },
                });
                return;
            }
            setIsSubmitting(false);
            navigate(MANAGER_INDIVIDUAL_REGISTER_PATH);
            return;
        }

        saveManagerRegistrationKind('company');

        showSuccess('Você selecionou o cadastro como Pessoa Jurídica.');
        setTimeout(() => {
            setIsSubmitting(false);
            if (!userId) {
                navigate(MANAGER_ACCOUNT_REGISTER_PATH, {
                    state: { fromPromoterCta: true, from: '/informacoes' },
                });
                return;
            }
            navigate('/manager/register/company');
        }, 500);
    };

    const bootLoading =
        isLoadingProfile ||
        (!isAdminRegisterRoute && Boolean(userId) && (isLoadingCompany || isLoadingAcceptances));

    return (
        <div className="min-h-screen bg-black text-white flex items-center justify-center px-4 sm:px-6 py-12">
            <div className="absolute inset-0 opacity-10">
                <div
                    className="absolute inset-0"
                    style={{
                        backgroundImage:
                            'radial-gradient(circle at 25% 25%, #fbbf24 0%, transparent 50%), radial-gradient(circle at 75% 75%, #fbbf24 0%, transparent 50%)',
                        backgroundSize: '400px 400px',
                    }}
                />
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
                        {isAdminRegisterRoute && isAdminMaster
                            ? 'Editar Termos de Registro de Gestor'
                            : showContractStep
                              ? 'Assinatura do contrato'
                              : 'Cadastro de Gestor'}
                    </h1>
                    <p className="text-gray-400 text-sm sm:text-base">
                        {isAdminRegisterRoute && isAdminMaster
                            ? 'Edite o contrato em Admin → Contratos (Cadastro da empresa).'
                            : showContractStep
                              ? 'Empresa cadastrada. Leia o contrato, confirme por e-mail e assine para concluir.'
                              : 'Primeiro cadastre sua conta e empresa. A assinatura do contrato vem depois.'}
                    </p>
                </div>

                {bootLoading ? (
                    <div className="text-center py-10">
                        <Loader2 className="h-8 w-8 animate-spin text-yellow-500 mx-auto mb-4" />
                        <p className="text-gray-400">Carregando…</p>
                    </div>
                ) : needsCompanyFirst ? (
                    <div className="bg-black border border-yellow-500/30 rounded-2xl p-6 sm:p-8 space-y-4">
                        <ol className="list-decimal list-inside space-y-2 text-sm text-gray-300">
                            <li>Escolha o tipo de operação e o perfil (PF ou PJ).</li>
                            <li>Crie a conta (e confirme o e-mail) e cadastre a empresa.</li>
                            <li>Assine o contrato com código enviado ao seu e-mail.</li>
                        </ol>
                        <Button
                            onClick={handleStartRegistration}
                            disabled={isSubmitting}
                            className="w-full bg-yellow-500 text-black hover:bg-yellow-600 py-3 text-base sm:text-lg font-semibold transition-all duration-300 cursor-pointer hover:scale-105 disabled:opacity-50"
                        >
                            Começar cadastro
                        </Button>
                        <Button
                            onClick={() => navigate('/')}
                            variant="outline"
                            className="w-full bg-black/60 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 hover:text-yellow-400 py-3 text-base sm:text-lg font-semibold transition-all duration-300 cursor-pointer"
                        >
                            Voltar para a Home
                        </Button>
                    </div>
                ) : isLoadingContract ? (
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
                        agreementLabel={MANAGER_CONTRACT_AGREEMENT_LABEL}
                    />
                )}

                {!isAdminRegisterRoute && showContractStep && platformContract && (
                    <div className="space-y-4">
                        <div className="rounded-xl border border-amber-500/40 bg-amber-950/60 p-4 text-amber-50 text-sm leading-relaxed">
                            Sua empresa já está cadastrada. Este é o último passo do cadastro de gestor — assine o
                            contrato abaixo para liberar o painel. Não é possível cadastrar a empresa novamente.
                        </div>
                        <Button
                            onClick={handleContinueToSign}
                            disabled={!agreedToTerms || isSubmitting || !platformContract}
                            className="w-full bg-yellow-500 text-black hover:bg-yellow-600 py-3 text-base sm:text-lg font-semibold transition-all duration-300 cursor-pointer hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
                        >
                            Continuar para confirmação
                        </Button>
                        <Button
                            onClick={() => {
                                showError(
                                    'Assine o contrato de cadastro da empresa para usar o painel e escolher um plano.',
                                );
                                navigate('/');
                            }}
                            variant="outline"
                            className="w-full bg-black/60 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 hover:text-yellow-400 py-3 text-base sm:text-lg font-semibold transition-all duration-300 cursor-pointer"
                        >
                            Sair sem assinar o contrato
                        </Button>
                    </div>
                )}
            </div>

            {platformContract && companyId && (
                <ContractOtpAcceptanceDialog
                    open={otpDialogOpen}
                    onOpenChange={setOtpDialogOpen}
                    contractId={platformContract.id}
                    contractType={platformContract.contract_type}
                    companyId={companyId}
                    acceptanceSource="manager_register"
                    scrolledToEnd={termsScrolledToEnd}
                    onAccepted={handleContractAccepted}
                />
            )}

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

            {transitionWarningDialog}
        </div>
    );
};

export default ManagerRegister;
