import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useForm, FormProvider } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Form } from '@/components/ui/form';
import { showSuccess, showError, showLoading, dismissToast } from '@/utils/toast';
import { Loader2, Building, ArrowLeft } from 'lucide-react';
import CompanyForm, { createCompanySchema, CompanyFormData } from '@/components/CompanyForm';
import { useQueryClient } from '@tanstack/react-query';
import {
    finalizeManagerCompanyRegistration,
    MANAGER_ACCOUNT_REGISTER_PATH,
    MANAGER_COMPANY_REGISTER_PATH,
} from '@/utils/promoter-registration-flow';
import { isAuthEmailConfirmed } from '@/utils/auth-email-confirmed';

const ManagerCompanyRegister: React.FC = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const queryClient = useQueryClient();
    const locationState = (location.state ?? {}) as { fromPromoterCta?: boolean };
    const [userId, setUserId] = useState<string | null>(null);
    const [isFetching, setIsFetching] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [isCepLoading, setIsCepLoading] = useState(false);

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
        const loadSession = async () => {
            const {
                data: { user },
            } = await supabase.auth.getUser();

            if (!user) {
                navigate(MANAGER_ACCOUNT_REGISTER_PATH, {
                    state: { fromPromoterCta: locationState.fromPromoterCta },
                    replace: true,
                });
                return;
            }

            if (!isAuthEmailConfirmed(user)) {
                await supabase.auth.signOut({ scope: 'local' });
                showError('Confirme seu e-mail antes de cadastrar a empresa.');
                navigate(MANAGER_ACCOUNT_REGISTER_PATH, { replace: true });
                return;
            }

            setUserId(user.id);
            if (user.email) {
                form.setValue('email', user.email);
            }
            setIsFetching(false);
        };

        void loadSession();

        const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
            if (!session?.user?.id || !isAuthEmailConfirmed(session.user)) return;
            setUserId(session.user.id);
            if (session.user.email) {
                form.setValue('email', session.user.email);
            }
            setIsFetching(false);
        });

        return () => {
            authListener.subscription.unsubscribe();
        };
    }, [navigate, locationState.fromPromoterCta, form]);

    const fetchAddressByCep = async (cep: string) => {
        const cleanCep = cep.replace(/\D/g, '');
        if (cleanCep.length !== 8) return;

        setIsCepLoading(true);
        try {
            const response = await fetch(`https://viacep.com.br/ws/${cleanCep}/json/`);
            const data = await response.json();

            if (data.erro) {
                showError('CEP não encontrado.');
                form.setError('cep', { message: 'CEP não encontrado.' });
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
            console.error('Erro ao buscar CEP:', error);
            showError('Erro na comunicação com o serviço de CEP.');
        } finally {
            setIsCepLoading(false);
        }
    };

    const onSubmit = async (values: CompanyFormData) => {
        if (!userId) {
            showError('Sessão inválida. Crie sua conta e confirme o e-mail primeiro.');
            navigate(MANAGER_ACCOUNT_REGISTER_PATH);
            return;
        }

        setIsSaving(true);
        const toastId = showLoading('Registrando empresa e perfil de gestor...');

        try {
            await finalizeManagerCompanyRegistration(userId, values, queryClient);
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

    if (isFetching) {
        return (
            <div className="min-h-screen bg-black text-white flex items-center justify-center">
                <Loader2 className="h-10 w-10 animate-spin text-yellow-500" />
            </div>
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
                    <h1 className="text-xl sm:text-2xl font-semibold text-white mb-2">
                        Cadastro de Gestor (Pessoa Jurídica)
                    </h1>
                    <p className="text-gray-400 text-sm sm:text-base">
                        Etapa 2 de 2 — e-mail confirmado. Preencha os dados da empresa para
                        concluir seu cadastro de gestor PRO.
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
                                                    locationState.fromPromoterCta
                                                        ? '/'
                                                        : '/manager/register',
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
