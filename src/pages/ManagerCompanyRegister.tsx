import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useForm, FormProvider } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Form } from '@/components/ui/form';
import { showSuccess, showError, showLoading, dismissToast } from '@/utils/toast';
import { Loader2, Building, ArrowLeft } from 'lucide-react';
import { Input } from '@/components/ui/input';
import CompanyForm, { createCompanySchema, CompanyFormData } from '@/components/CompanyForm';
import EmailConfirmationScreen from '@/components/EmailConfirmationScreen';
import { useQueryClient } from '@tanstack/react-query';
import {
    ensureAuthUserForCompanyRegistration,
    finalizeManagerCompanyRegistration,
    loadCompanyRegisterDraft,
    MANAGER_COMPANY_REGISTER_PATH,
    saveCompanyRegisterDraft,
} from '@/utils/promoter-registration-flow';
import { hasPendingPromoterRegistration } from '@/utils/manager-company-registration';
import { isAuthEmailConfirmed } from '@/utils/auth-email-confirmed';

// --- Component ---

const ManagerCompanyRegister: React.FC = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const queryClient = useQueryClient();
    const locationState = (location.state ?? {}) as {
        fromPromoterCta?: boolean;
        allowGuestSignup?: boolean;
    };
    const [userId, setUserId] = useState<string | null>(null);
    const [isFetching, setIsFetching] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [isCepLoading, setIsCepLoading] = useState(false);
    const [accountName, setAccountName] = useState('');
    const [accountPassword, setAccountPassword] = useState('');
    const [accountPasswordConfirm, setAccountPasswordConfirm] = useState('');
    const [pendingConfirmationEmail, setPendingConfirmationEmail] = useState<string | null>(null);
    const [autoFinalizing, setAutoFinalizing] = useState(false);
    const [resumeWithoutDraft, setResumeWithoutDraft] = useState(false);

    const needsGuestAccount = !userId && Boolean(locationState.allowGuestSignup);

    // Schema de validação para o contexto de Gestor (Pessoa Jurídica)
    const schema = createCompanySchema(true); 

    const form = useForm<CompanyFormData>({
        resolver: zodResolver(schema),
        defaultValues: {
            corporate_name: '',
            cnpj: '',
            trade_name: '',
            phone: '',
            email: '',
            cep: '',
            street: '',
            neighborhood: '',
            city: '',
            state: '',
            number: '',
            complement: '',
        },
    });

    useEffect(() => {
        const runAutoFinalize = async (activeUserId: string, companyValues: CompanyFormData) => {
            setAutoFinalizing(true);
            const toastId = showLoading('E-mail confirmado! Finalizando cadastro de gestor PRO...');
            try {
                await finalizeManagerCompanyRegistration(activeUserId, companyValues, queryClient);
                dismissToast(toastId);
                showSuccess('Registro de Gestor (Empresa) concluído com sucesso!');
                navigate('/manager/dashboard');
            } catch (e: unknown) {
                dismissToast(toastId);
                console.error('Auto-finalize error:', e);
                const message = e instanceof Error ? e.message : 'Erro desconhecido';
                showError(`Falha ao finalizar cadastro: ${message}`);
                form.reset(companyValues);
                setAutoFinalizing(false);
                setIsFetching(false);
            }
        };

        const fetchUser = async () => {
            const {
                data: { user },
            } = await supabase.auth.getUser();
            if (user) {
                if (!isAuthEmailConfirmed(user)) {
                    await supabase.auth.signOut({ scope: 'local' });
                    if (locationState.allowGuestSignup) {
                        setIsFetching(false);
                        return;
                    }
                    showError('Confirme seu e-mail antes de cadastrar a empresa.');
                    navigate('/login', { state: { from: MANAGER_COMPANY_REGISTER_PATH } });
                    return;
                }
                setUserId(user.id);
                const draft = loadCompanyRegisterDraft();
                if (draft?.autoFinalize) {
                    await runAutoFinalize(user.id, draft.company);
                    return;
                }
                if (draft) {
                    form.reset(draft.company);
                    setAccountName(draft.accountName);
                    showSuccess('Dados da empresa restaurados. Revise e finalize o cadastro.');
                } else if (hasPendingPromoterRegistration(user)) {
                    setResumeWithoutDraft(true);
                }
                setIsFetching(false);
                return;
            }
            if (locationState.allowGuestSignup) {
                setIsFetching(false);
                return;
            }
            showError('Faça login para cadastrar sua empresa ou use o botão Começar Agora na página inicial.');
            navigate('/login', { state: { from: MANAGER_COMPANY_REGISTER_PATH } });
        };
        void fetchUser();

        const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
            if (!session?.user?.id || !isAuthEmailConfirmed(session.user)) return;
            if (userId === session.user.id && !autoFinalizing) return;

            const draft = loadCompanyRegisterDraft();
            if (draft?.autoFinalize) {
                void runAutoFinalize(session.user.id, draft.company);
                return;
            }
            setUserId(session.user.id);
            if (draft) {
                form.reset(draft.company);
                setAccountName(draft.accountName);
            } else if (hasPendingPromoterRegistration(session.user)) {
                setResumeWithoutDraft(true);
            }
            setIsFetching(false);
        });

        return () => {
            authListener.subscription.unsubscribe();
        };
    }, [navigate, locationState.allowGuestSignup, form, queryClient, userId, autoFinalizing]);

    // Function to fetch address via ViaCEP
    const fetchAddressByCep = async (cep: string) => {
        const cleanCep = cep.replace(/\D/g, '');
        if (cleanCep.length !== 8) return;

        setIsCepLoading(true);
        try {
            const response = await fetch(`https://viacep.com.br/ws/${cleanCep}/json/`);
            const data = await response.json();

            if (data.erro) {
                showError("CEP não encontrado.");
                form.setError('cep', { message: "CEP não encontrado." });
                form.setValue('street', '');
                form.setValue('neighborhood', '');
                form.setValue('city', '');
                form.setValue('state', '');
            } else {
                form.clearErrors('cep');
                form.setValue('street', data.logradouro || '');
                form.setValue('neighborhood', data.bairro || '');
                form.setValue('city', data.localidade || '');
                form.setValue('state', data.uf || '');
                document.getElementById('number')?.focus();
            }
        } catch (error) {
            console.error("Erro ao buscar CEP:", error);
            showError("Erro na comunicação com o serviço de CEP.");
        } finally {
            setIsCepLoading(false);
        }
    };

    const onSubmit = async (values: CompanyFormData) => {
        setIsSaving(true);
        const toastId = showLoading('Registrando empresa e perfil de gestor...');

        try {
            if (needsGuestAccount) {
                if (!accountName.trim()) {
                    throw new Error('Informe o nome do responsável pela conta.');
                }
                if (!values.email?.trim()) {
                    throw new Error('Informe o e-mail da empresa (será usado para login).');
                }
                if (accountPassword.length < 6) {
                    throw new Error('A senha deve ter no mínimo 6 caracteres.');
                }
                if (accountPassword !== accountPasswordConfirm) {
                    throw new Error('As senhas não conferem.');
                }
            }

            const authResult = await ensureAuthUserForCompanyRegistration(
                values.email || '',
                accountPassword,
                accountName || values.corporate_name,
                userId,
            );

            if (authResult.status === 'email_confirmation_required') {
                saveCompanyRegisterDraft({
                    company: values,
                    accountName: accountName.trim(),
                    autoFinalize: true,
                });
                setUserId(null);
                dismissToast(toastId);
                setPendingConfirmationEmail(authResult.email);
                return;
            }

            const activeUserId = authResult.userId;
            if (activeUserId !== userId) {
                setUserId(activeUserId);
            }

            await finalizeManagerCompanyRegistration(activeUserId, values, queryClient);

            dismissToast(toastId);
            showSuccess('Registro de Gestor (Empresa) concluído com sucesso!');
            navigate('/manager/dashboard');
        } catch (e: unknown) {
            dismissToast(toastId);
            console.error('Supabase Save Error:', e);
            const message = e instanceof Error ? e.message : 'Erro desconhecido';
            showError(`Falha ao registrar empresa: ${message}`);
        } finally {
            setIsSaving(false);
        }
    };

    // Dados de exemplo para auto-preenchimento
    const dummyCompanyData: CompanyFormData = {
        corporate_name: 'Empresa de Teste S.A.',
        cnpj: '00.000.000/0001-00',
        trade_name: 'Teste Company',
        phone: '(11) 98765-4321',
        email: 'contato@testcompany.com',
        cep: '01001-000',
        street: 'Praça da Sé',
        neighborhood: 'Sé',
        city: 'São Paulo',
        state: 'SP',
        number: '100',
        complement: 'Andar 5',
    };

    const handleAutoFill = () => {
        form.reset(dummyCompanyData);
        showSuccess("Formulário preenchido com dados de teste!");
    };

    if (isFetching || autoFinalizing) {
        return (
            <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center gap-4">
                <Loader2 className="h-10 w-10 animate-spin text-yellow-500" />
                {autoFinalizing && (
                    <p className="text-gray-400 text-sm">Finalizando cadastro de gestor PRO...</p>
                )}
            </div>
        );
    }

    if (pendingConfirmationEmail) {
        return (
            <EmailConfirmationScreen
                email={pendingConfirmationEmail}
                variant="pro"
                showDraftSaved
                loginTo={MANAGER_COMPANY_REGISTER_PATH}
                resendRedirectPath={MANAGER_COMPANY_REGISTER_PATH}
                onBack={() => navigate('/')}
                backLabel="Voltar para a página inicial"
            />
        );
    }

    return (
        <div className="min-h-screen bg-black text-white flex items-center justify-center px-4 sm:px-6 py-12">
            <div className="relative z-10 w-full max-w-4xl">
                <div className="text-center mb-6 sm:mb-8">
                    <div 
                        className="text-3xl font-serif text-yellow-500 font-bold mb-2 cursor-pointer"
                        onClick={() => navigate('/')} 
                    >
                        EventFest PRO
                    </div>
                    <h1 className="text-xl sm:text-2xl font-semibold text-white mb-2">Cadastro de Gestor (Pessoa Jurídica)</h1>
                    <p className="text-gray-400 text-sm sm:text-base">
                        {needsGuestAccount
                            ? 'Crie sua conta e cadastre a empresa para virar gestor PRO.'
                            : resumeWithoutDraft
                              ? 'E-mail confirmado! Preencha os dados da empresa para concluir seu cadastro de gestor PRO.'
                              : 'Preencha os dados da sua empresa para se tornar um gestor.'}
                    </p>
                </div>
                <Card className="bg-black border border-yellow-500/30 rounded-2xl p-6 sm:p-8 shadow-2xl shadow-yellow-500/10">
                    <CardHeader>
                        <CardTitle className="text-white text-xl sm:text-2xl font-semibold flex items-center">
                            <Building className="h-6 w-6 mr-2 text-yellow-500" />
                            Dados Corporativos
                        </CardTitle>
                        <CardDescription className="text-gray-400 text-sm">
                            Todos os campos são obrigatórios para o registro de Pessoa Jurídica.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <FormProvider {...form}>
                            <Form {...form}>
                                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">

                                    {needsGuestAccount && (
                                        <div className="space-y-4 rounded-xl border border-cyan-500/30 bg-cyan-500/5 p-4">
                                            <p className="text-sm text-cyan-200/90 font-medium">
                                                Conta de acesso (obrigatório)
                                            </p>
                                            <p className="text-xs text-gray-400">
                                                Use o mesmo e-mail de acesso abaixo. Enviaremos um link para
                                                confirmar o e-mail antes de concluir o cadastro da empresa. Se já
                                                tiver conta,{' '}
                                                <Link
                                                    to="/login"
                                                    state={{ from: MANAGER_COMPANY_REGISTER_PATH }}
                                                    className="text-yellow-500 hover:underline"
                                                >
                                                    faça login
                                                </Link>
                                                .
                                            </p>
                                            <div>
                                                <label className="block text-sm text-white mb-2">
                                                    Nome do responsável *
                                                </label>
                                                <Input
                                                    value={accountName}
                                                    onChange={(e) => setAccountName(e.target.value)}
                                                    className="bg-black/60 border-yellow-500/30 text-white"
                                                    disabled={isSaving}
                                                />
                                            </div>
                                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                                <div>
                                                    <label className="block text-sm text-white mb-2">
                                                        Senha *
                                                    </label>
                                                    <Input
                                                        type="password"
                                                        value={accountPassword}
                                                        onChange={(e) => setAccountPassword(e.target.value)}
                                                        className="bg-black/60 border-yellow-500/30 text-white"
                                                        disabled={isSaving}
                                                        minLength={6}
                                                    />
                                                </div>
                                                <div>
                                                    <label className="block text-sm text-white mb-2">
                                                        Confirmar senha *
                                                    </label>
                                                    <Input
                                                        type="password"
                                                        value={accountPasswordConfirm}
                                                        onChange={(e) =>
                                                            setAccountPasswordConfirm(e.target.value)
                                                        }
                                                        className="bg-black/60 border-yellow-500/30 text-white"
                                                        disabled={isSaving}
                                                        minLength={6}
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    <CompanyForm 
                                        isSaving={isSaving} 
                                        isCepLoading={isCepLoading} 
                                        fetchAddressByCep={fetchAddressByCep} 
                                        isManagerContext={true} 
                                    />

                                    <div className="pt-4 flex flex-col sm:flex-row space-y-4 sm:space-y-0 sm:space-x-4">
                                        <Button
                                            type="submit"
                                            disabled={isSaving}
                                            className="flex-1 bg-yellow-500 text-black hover:bg-yellow-600 py-3 text-lg font-semibold transition-all duration-300 cursor-pointer disabled:opacity-50"
                                        >
                                            {isSaving ? (
                                                <div className="flex items-center justify-center">
                                                    <Loader2 className="w-5 h-5 animate-spin mr-2" />
                                                    Finalizando Registro...
                                                </div>
                                            ) : (
                                                <>
                                                    <i className="fas fa-check-circle mr-2"></i>
                                                    Finalizar Cadastro PRO
                                                </>
                                            )}
                                        </Button>
                                        <Button
                                            type="button"
                                            onClick={() =>
                                                navigate(
                                                    locationState.fromPromoterCta ? '/' : '/manager/register',
                                                )
                                            }
                                            variant="outline"
                                            className="flex-1 bg-black/60 border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 py-3 text-lg font-semibold transition-all duration-300 cursor-pointer"
                                            disabled={isSaving}
                                        >
                                            <ArrowLeft className="mr-2 h-5 w-5" />
                                            Voltar
                                        </Button>
                                    </div>
                                    {/* Botão de Auto-Preenchimento */}
                                    <Button
                                        type="button"
                                        onClick={handleAutoFill}
                                        variant="secondary"
                                        className="w-full bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 py-3 text-base sm:text-lg font-semibold transition-all duration-300 cursor-pointer"
                                        disabled={isSaving}
                                    >
                                        <i className="fas fa-magic mr-2"></i>
                                        Auto-Preencher para Teste
                                    </Button>
                                </form>
                            </Form>
                        </FormProvider>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
};

export default ManagerCompanyRegister;