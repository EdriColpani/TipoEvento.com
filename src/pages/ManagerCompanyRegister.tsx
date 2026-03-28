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
import { useQueryClient } from '@tanstack/react-query'; // Importando useQueryClient

// --- Component ---

const ManagerCompanyRegister: React.FC = () => {
    const navigate = useNavigate();
    const queryClient = useQueryClient(); // Inicializando useQueryClient
    const [userId, setUserId] = useState<string | null>(null);
    const [isFetching, setIsFetching] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [isCepLoading, setIsCepLoading] = useState(false);

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

    // Fetch User ID
    useEffect(() => {
        const fetchUser = async () => {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) {
                showError("Sessão expirada. Faça login novamente.");
                navigate('/login');
                return;
            }
            setUserId(user.id);
            setIsFetching(false);
        };
        fetchUser();
    }, [navigate]);

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
        if (!userId) return;
        setIsSaving(true);
        const toastId = showLoading("Registrando empresa e perfil de gestor...");

        const dataToSave = {
            // REMOVIDO: user_id: userId, // A posse agora é gerenciada pela tabela user_companies
            cnpj: values.cnpj.replace(/\D/g, ''),
            corporate_name: values.corporate_name,
            trade_name: values.trade_name || null,
            phone: values.phone ? values.phone.replace(/\D/g, '') : null,
            email: values.email || null,
            
            cep: values.cep ? values.cep.replace(/\D/g, '') : null,
            street: values.street || null,
            number: values.number || null,
            neighborhood: values.neighborhood || null,
            city: values.city || null,
            state: values.state || null,
            complement: values.complement || null,
        };

        try {
            // 1. Perfil primeiro: RLS em `companies` (companies_insert_gestor_pro) exige tipo_usuario_id = 2 no perfil.
            //    Ordem antiga (empresa → perfil) fazia o INSERT falhar ou gerava estado estranho.
            const { error: profileUpdateError } = await supabase
                .from('profiles')
                .update({
                    tipo_usuario_id: 2,
                    natureza_juridica_id: 2,
                })
                .eq('id', userId);

            if (profileUpdateError) {
                throw new Error(
                    profileUpdateError.message ||
                        'Não foi possível atualizar o perfil para Gestor PRO. Verifique permissões (RLS) ou tente de novo.',
                );
            }

            // 2. Inserir empresa
            const { data: companyData, error: companyError } = await supabase
                .from('companies')
                .insert([dataToSave])
                .select('id')
                .single();

            if (companyError) {
                if (companyError.code === '23505' && companyError.message.includes('cnpj')) {
                    throw new Error('Este CNPJ já está cadastrado em outra conta.');
                }
                throw companyError;
            }

            const companyId = companyData.id;

            // 3. Vínculo obrigatório — sem user_companies o app não resolve company_id ao salvar evento
            const { error: associationError } = await supabase.from('user_companies').insert({
                user_id: userId,
                company_id: companyId,
                role: 'owner',
                is_primary: true,
            });

            if (associationError) {
                await supabase.from('companies').delete().eq('id', companyId);
                throw new Error(
                    associationError.message ||
                        'Empresa criada, mas falhou o vínculo com sua conta. Tente novamente ou contate o suporte.',
                );
            }

            // 4. NOVO: Atualizar o status dos eventos da nova empresa para 'approved'
            const { error: eventUpdateError } = await supabase
                .from('events')
                .update({ status: 'approved' })
                .eq('company_id', companyId)
                .eq('status', 'pending'); // Apenas eventos pendentes
            
            if (eventUpdateError) {
                console.error("Warning: Failed to update event statuses to approved:", eventUpdateError);
            }

            queryClient.invalidateQueries({ queryKey: ['managerCompany', userId] });
            queryClient.invalidateQueries({ queryKey: ['profile', userId] });
            queryClient.invalidateQueries({ queryKey: ['dashboardData'] });

            dismissToast(toastId);
            showSuccess("Registro de Gestor (Empresa) concluído com sucesso!");
            navigate('/manager/dashboard');

        } catch (e: any) {
            dismissToast(toastId);
            console.error("Supabase Save Error:", e);
            showError(`Falha ao registrar empresa: ${e.message || 'Erro desconhecido'}`);
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
                        EventoFest PRO
                    </div>
                    <h1 className="text-xl sm:text-2xl font-semibold text-white mb-2">Cadastro de Gestor (Pessoa Jurídica)</h1>
                    <p className="text-gray-400 text-sm sm:text-base">Preencha os dados da sua empresa para se tornar um gestor.</p>
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
                                            onClick={() => navigate('/manager/register')}
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