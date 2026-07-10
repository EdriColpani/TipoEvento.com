import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useForm, FormProvider } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Form } from '@/components/ui/form';
import { showSuccess, showError, showLoading, dismissToast } from '@/utils/toast';
import { Loader2, Building, ArrowLeft } from 'lucide-react';
import { useManagerCompany } from '@/hooks/use-manager-company';
import { useProfile } from '@/hooks/use-profile';
import { usePageAuth } from '@/hooks/use-page-auth';
import { restGet, restPatch } from '@/utils/supabase-rest';
import { withTimeout } from '@/utils/promise-timeout';
import CompanyForm, { createCompanySchema, CompanyFormData } from '@/components/CompanyForm';
import ManagerCompanyTabs from '@/components/ManagerCompanyTabs'; // Importando o novo componente

// --- Utility Functions ---

const validateCNPJ = (cnpj: string) => {
    const cleanCNPJ = cnpj.replace(/\D/g, '');

    if (cleanCNPJ.length !== 14) return false;

    // Evita CNPJs com todos os dígitos iguais
    if (/^(\d)\1{13}$/.test(cleanCNPJ)) return false;

    let size = cleanCNPJ.length - 2;
    let numbers = cleanCNPJ.substring(0, size);
    const digits = cleanCNPJ.substring(size);
    let sum = 0;
    let pos = size - 7;

    // Validação do primeiro dígito
    for (let i = size; i >= 1; i--) {
        sum += parseInt(numbers.charAt(size - i)) * pos--;
        if (pos < 2) pos = 9;
    }
    let result = sum % 11 < 2 ? 0 : 11 - (sum % 11);
    if (result !== parseInt(digits.charAt(0))) return false;

    // Validação do segundo dígito
    size = size + 1;
    numbers = cleanCNPJ.substring(0, size);
    sum = 0;
    pos = size - 7;
    for (let i = size; i >= 1; i--) {
        sum += parseInt(numbers.charAt(size - i)) * pos--;
        if (pos < 2) pos = 9;
    }
    result = sum % 11 < 2 ? 0 : 11 - (sum % 11);
    if (result !== parseInt(digits.charAt(1))) return false;

    return true;
};

const formatCNPJ = (value: string) => {
    if (!value) return '';
    const cleanValue = value.replace(/\D/g, '');
    return cleanValue
        .replace(/^(\d{2})(\d)/, '$1.$2')
        .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
        .replace(/\.(\d{3})(\d)/, '.$1/$2')
        .replace(/(\d{4})(\d)/, '$1-$2')
        .replace(/(-\d{2})\d+?$/, '$1');
};

const formatPhone = (value: string) => {
    if (!value) return '';
    const cleanValue = value.replace(/\D/g, '');
    if (cleanValue.length <= 10) {
        return cleanValue.replace(/^(\d{2})(\d{4})(\d{4})$/, '($1) $2-$3');
    }
    return cleanValue.replace(/^(\d{2})(\d{5})(\d{4})$/, '($1) $2-$3');
};

const formatCEP = (value: string) => {
    if (!value) return '';
    const cleanValue = value.replace(/\D/g, '');
    return cleanValue
        .replace(/(\d{5})(\d)/, '$1-$2')
        .replace(/(-\d{3})\d+?$/, '$1');
};

// --- Zod Schema ---

// Usamos o schema base do CompanyForm, mas aqui os campos são opcionais para edição
const companyProfileSchema = createCompanySchema(false);

type CompanyProfileData = z.infer<typeof companyProfileSchema> & { id?: string };

// --- Component ---

const ManagerCompanyProfile: React.FC = () => {
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const { userId, authPending, sessionReady } = usePageAuth();
    const [isFetching, setIsFetching] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [isCepLoading, setIsCepLoading] = useState(false);

    const { company, isLoading: isLoadingCompany } = useManagerCompany(userId);
    const { profile, isLoading: isLoadingProfile } = useProfile(userId);
    const companyId = company?.id;
    const isAdminMaster = profile?.tipo_usuario_id === 1;

    const form = useForm<CompanyProfileData>({
        resolver: zodResolver(companyProfileSchema),
        defaultValues: {
            cnpj: '',
            corporate_name: '',
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

    // 2. Fetch Company Details using companyId
    useEffect(() => {
        const fetchProfileDetails = async () => {
            if (!sessionReady) return;

            if (!userId) {
                showError('Sessão expirada. Faça login novamente.');
                navigate('/login');
                setIsFetching(false);
                return;
            }

            if (isLoadingCompany || isLoadingProfile) return;

            if (!companyId) {
                setIsFetching(false);
                return;
            }

            let data: Record<string, unknown> | null = null;
            try {
                const rows = await restGet<Record<string, unknown>[]>(
                    `companies?id=eq.${companyId}&limit=1`,
                    10_000,
                );
                data = rows?.[0] ?? null;
            } catch (restError) {
                console.warn('[ManagerCompanyProfile] REST falhou:', restError);
                const { data: row, error } = await withTimeout(
                    supabase.from('companies').select('*').eq('id', companyId).single(),
                    10_000,
                    { data: null, error: { code: 'TIMEOUT', message: 'timeout' } as { code: string; message: string } },
                );
                if (error && error.code !== 'PGRST116' && error.code !== 'TIMEOUT') {
                    console.error('Error fetching company profile:', error);
                    showError('Erro ao carregar perfil da empresa.');
                }
                data = row as Record<string, unknown> | null;
            }

            if (data) {
                form.reset({
                    cnpj: formatCNPJ(String(data.cnpj || '')),
                    corporate_name: String(data.corporate_name || ''),
                    trade_name: String(data.trade_name || ''),
                    phone: formatPhone(String(data.phone || '')),
                    email: String(data.email || ''),
                    cep: formatCEP(String(data.cep || '')),
                    street: String(data.street || ''),
                    neighborhood: String(data.neighborhood || ''),
                    city: String(data.city || ''),
                    state: String(data.state || ''),
                    number: String(data.number || ''),
                    complement: String(data.complement || ''),
                });
            }
            setIsFetching(false);
        };
        void fetchProfileDetails();
    }, [userId, sessionReady, companyId, isLoadingCompany, isLoadingProfile, form, navigate]);

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

    // --- Handlers ---

    const handleCnpjChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const formattedCnpj = formatCNPJ(e.target.value);
        form.setValue('cnpj', formattedCnpj, { shouldValidate: true });
    };

    const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const formattedPhone = formatPhone(e.target.value);
        form.setValue('phone', formattedPhone, { shouldValidate: true });
    };

    const handleCepChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const rawValue = e.target.value;
        const formattedCep = formatCEP(rawValue);
        form.setValue('cep', formattedCep, { shouldValidate: true });

        if (formattedCep.replace(/\D/g, '').length === 8) {
            fetchAddressByCep(formattedCep);
        }
    };

    const onSubmit = async (values: CompanyProfileData) => {
        if (!userId || !companyId) {
            showError("ID da empresa não encontrado. Tente recarregar ou cadastre a empresa primeiro.");
            return;
        }
        setIsSaving(true);
        const toastId = showLoading("Atualizando perfil...");

        const dataToSave = {
            cnpj: values.cnpj ? values.cnpj.replace(/\D/g, '') : null,
            corporate_name: values.corporate_name || null,
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
            await restPatch(
                `companies?id=eq.${encodeURIComponent(companyId)}`,
                dataToSave,
                15_000,
            );

            await queryClient.invalidateQueries({ queryKey: ['credit-acceptance-network'] });

            dismissToast(toastId);
            showSuccess("Perfil da Empresa salvo com sucesso!");
            navigate('/manager/settings');

        } catch (e: any) {
            dismissToast(toastId);
            console.error("Supabase Save Error:", e);
            const message = String(e?.message || 'Erro desconhecido');
            if (message.toLowerCase().includes('cnpj') && message.includes('23505')) {
                showError('Este CNPJ já está cadastrado em outra conta.');
            } else if (message.toLowerCase().includes('aborted') || message.toLowerCase().includes('timeout')) {
                showError('Tempo esgotado ao salvar. Verifique a conexão e tente novamente.');
            } else {
                showError(`Falha ao salvar perfil: ${message}`);
            }
        } finally {
            setIsSaving(false);
        }
    };

    if (authPending || !sessionReady || isFetching || isLoadingCompany || isLoadingProfile) {
        return (
            <div className="max-w-4xl mx-auto px-4 sm:px-0 text-center py-20">
                <Loader2 className="h-10 w-10 animate-spin text-yellow-500 mx-auto mb-4" />
                <p className="text-gray-400">Carregando perfil da empresa...</p>
            </div>
        );
    }
    
    if (!companyId || !profile) {
        return (
            <div className="max-w-4xl mx-auto px-4 sm:px-0 text-center py-20">
                <div className="bg-red-500/20 border border-red-500/50 text-red-400 p-6 rounded-xl mb-8">
                    <i className="fas fa-exclamation-triangle text-2xl mb-3"></i>
                    <h3 className="font-semibold text-white mb-2">Empresa Não Cadastrada</h3>
                    <p className="text-sm">Sua conta de gestor (PJ) não está associada a uma empresa. Por favor, complete o cadastro.</p>
                    <Button 
                        onClick={() => navigate('/manager/register/company')}
                        className="mt-4 bg-yellow-500 text-black hover:bg-yellow-600"
                    >
                        Cadastrar Empresa
                    </Button>
                </div>
            </div>
        );
    }
    
    // Componente de Formulário Encapsulado
    const CompanyFormContent = (
        <Card className="bg-black border border-yellow-500/30 rounded-2xl shadow-2xl shadow-yellow-500/10">
            <CardHeader>
                <CardTitle className="text-white text-xl sm:text-2xl font-semibold">
                    Editar Dados Corporativos
                </CardTitle>
                <CardDescription className="text-gray-400 text-sm">
                    Estes dados são essenciais para a emissão de notas fiscais e validação de eventos.
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
                                isManagerContext={false} // Não é o registro inicial, campos são opcionais
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
                                            Salvando...
                                        </div>
                                    ) : (
                                        <>
                                            <i className="fas fa-save mr-2"></i>
                                            Salvar Perfil da Empresa
                                        </>
                                    )}
                                </Button>
                                <Button
                                    type="button"
                                    onClick={() => navigate('/manager/settings')}
                                    variant="outline"
                                    className="flex-1 bg-black/60 border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 py-3 text-lg font-semibold transition-all duration-300 cursor-pointer"
                                    disabled={isSaving}
                                >
                                    <ArrowLeft className="mr-2 h-5 w-5" />
                                    Voltar para Configurações
                                </Button>
                            </div>
                        </form>
                    </Form>
                </FormProvider>
            </CardContent>
        </Card>
    );


    return (
        <div className="max-w-4xl mx-auto px-4 sm:px-0">
            <div className="flex items-center justify-between mb-8">
                <h1 className="text-2xl sm:text-3xl font-serif text-yellow-500 flex items-center">
                    <Building className="h-7 w-7 mr-3" />
                    Configurações da Empresa
                </h1>
                <Button 
                    onClick={() => navigate('/manager/settings')}
                    variant="outline"
                    className="bg-black/60 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 text-sm"
                >
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Voltar
                </Button>
            </div>

            <ManagerCompanyTabs
                companyId={companyId}
                companyData={form.getValues()}
                profile={profile}
                isSaving={isSaving}
                isCepLoading={isCepLoading}
                fetchAddressByCep={fetchAddressByCep}
                formComponent={CompanyFormContent}
                isAdminMaster={isAdminMaster}
            />
        </div>
    );
};

export default ManagerCompanyProfile;