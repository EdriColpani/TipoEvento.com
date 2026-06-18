import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { showSuccess, showError, showLoading, dismissToast } from '@/utils/toast';
import { Loader2, User, ArrowLeft } from 'lucide-react';
import { useProfile, ProfileData } from '@/hooks/use-profile';
import { useQueryClient } from '@tanstack/react-query';
import {
    isSameDocument,
    normalizeDocumentDigits,
    translateProfileSaveError,
} from '@/utils/profile-documents';

const GENDER_OPTIONS = [
    "Masculino",
    "Feminino",
    "Não binário",
    "Outro",
    "Prefiro não dizer"
];

// --- Utility Functions ---

// Função de validação de CPF
const validateCPF = (cpf: string) => {
    const cleanCPF = cpf.replace(/\D/g, '');
    if (cleanCPF.length !== 11) return false;
    if (/^(\d)\1{10}$/.test(cleanCPF)) return false;
    let sum = 0;
    for (let i = 0; i < 9; i++) {
        sum += parseInt(cleanCPF.charAt(i)) * (10 - i);
    }
    let checkDigit = 11 - (sum % 11);
    if (checkDigit === 10 || checkDigit === 11) checkDigit = 0;
    if (checkDigit !== parseInt(cleanCPF.charAt(9))) return false;
    sum = 0;
    for (let i = 0; i < 10; i++) {
        sum += parseInt(cleanCPF.charAt(i)) * (11 - i);
    }
    checkDigit = 11 - (sum % 11);
    if (checkDigit === 10 || checkDigit === 11) checkDigit = 0;
    if (checkDigit !== parseInt(cleanCPF.charAt(10))) return false;
    return true;
};

// Função de validação de RG (apenas formato)
const validateRG = (rg: string) => {
    const cleanRG = rg.replace(/\D/g, '');
    return cleanRG.length >= 7 && cleanRG.length <= 9; // RG geralmente tem 7 a 9 dígitos
};

// Função de validação de CEP (apenas formato)
const validateCEP = (cep: string) => {
    const cleanCEP = cep.replace(/\D/g, '');
    return cleanCEP.length === 8;
};

const formatCPF = (value: string) => {
    if (!value) return '';
    const cleanValue = value.replace(/\D/g, '');
    return cleanValue
        .replace(/(\d{3})(\d)/, '$1.$2')
        .replace(/(\d{3})(\d)/, '$1.$2')
        .replace(/(\d{3})(\d{1,2})/, '$1-$2')
        .replace(/(-\d{2})\d+?$/, '$1');
};

const formatRG = (value: string) => {
    if (!value) return '';
    const cleanValue = value.replace(/\D/g, '');
    return cleanValue
        .replace(/(\d{2})(\d)/, '$1.$2')
        .replace(/(\d{3})(\d)/, '$1.$2')
        .replace(/(\d{3})(\d{1})/, '$1-$2')
        .replace(/(-\d{1})\d+?$/, '$1');
};

const formatCEP = (value: string) => {
    if (!value) return '';
    const cleanValue = value.replace(/\D/g, '');
    return cleanValue
        .replace(/(\d{5})(\d)/, '$1-$2')
        .replace(/(-\d{3})\d+?$/, '$1');
};

// Schema para o perfil de gestor individual (todos os campos são obrigatórios para o gestor PF)
const managerIndividualProfileSchema = z.object({
    first_name: z.string().min(1, { message: "Nome é obrigatório." }),
    last_name: z.string().min(1, { message: "Sobrenome é obrigatório." }),
    birth_date: z.string().min(1, { message: "Data de nascimento é obrigatória." }),
    gender: z.string().min(1, { message: "Gênero é obrigatório." }).nullable(), 
    
    cpf: z.string().min(1, { message: "CPF é obrigatório." }).refine(validateCPF, { message: "CPF inválido." }),
    rg: z.string().min(1, { message: "RG é obrigatório." }).refine(validateRG, { message: "RG inválido." }),

    cep: z.string().min(1, { message: "CEP é obrigatório." }).refine((val) => val.replace(/\D/g, '').length === 8, { message: "CEP inválido (8 dígitos)." }),
    rua: z.string().min(1, { message: "Rua é obrigatória." }),
    bairro: z.string().min(1, { message: "Bairro é obrigatório." }),
    cidade: z.string().min(1, { message: "Cidade é obrigatória." }),
    estado: z.string().min(1, { message: "Estado é obrigatório." }),
    numero: z.string().min(1, { message: "Número é obrigatório." }),
    complemento: z.string().optional().nullable(), 
});

type ManagerIndividualProfileData = z.infer<typeof managerIndividualProfileSchema>;

// --- Component ---

const ManagerIndividualProfile: React.FC = () => {
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const [userId, setUserId] = useState<string | null>(null);
    const [isFetching, setIsFetching] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [isCepLoading, setIsCepLoading] = useState(false);

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

    const { profile, isLoading: isLoadingProfile } = useProfile(userId || undefined);

    const form = useForm<ManagerIndividualProfileData>({
        resolver: zodResolver(managerIndividualProfileSchema),
        defaultValues: {
            first_name: '',
            last_name: '',
            birth_date: '',
            gender: "", 
            cpf: '',
            rg: '',
            cep: '',
            rua: '',
            bairro: '',
            cidade: '',
            estado: '',
            numero: '',
            complemento: '',
        },
        values: {
            first_name: profile?.first_name || '',
            last_name: profile?.last_name || '', 
            birth_date: profile?.birth_date || '',
            gender: profile?.gender || "", 
            cpf: profile?.cpf ? formatCPF(profile.cpf) : '',
            rg: profile?.rg ? formatRG(profile.rg) : '',
            cep: profile?.cep ? formatCEP(profile.cep) : '',
            rua: profile?.rua || '',
            bairro: profile?.bairro || '',
            cidade: profile?.cidade || '',
            estado: profile?.estado || '',
            numero: profile?.numero || '',
            complemento: profile?.complemento || '',
        },
    });

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
                form.setValue('rua', '');
                form.setValue('bairro', '');
                form.setValue('cidade', '');
                form.setValue('estado', '');
            } else {
                form.clearErrors('cep');
                form.setValue('rua', data.logradouro || '');
                form.setValue('bairro', data.bairro || '');
                form.setValue('cidade', data.localidade || '');
                form.setValue('estado', data.uf || '');
                document.getElementById('numero')?.focus();
            }
        } catch (error) {
            console.error("Erro ao buscar CEP:", error);
            showError("Erro na comunicação com o serviço de CEP.");
        } finally {
            setIsCepLoading(false);
        }
    };

    // --- Handlers ---

    const handleCpfChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const formattedCpf = formatCPF(e.target.value);
        form.setValue('cpf', formattedCpf, { shouldValidate: true });
    };

    const handleRgChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const formattedRg = formatRG(e.target.value);
        form.setValue('rg', formattedRg, { shouldValidate: true });
    };

    const handleCepChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const rawValue = e.target.value;
        const formattedCep = formatCEP(rawValue);
        form.setValue('cep', formattedCep, { shouldValidate: true });

        if (formattedCep.replace(/\D/g, '').length === 8) {
            fetchAddressByCep(formattedCep);
        }
    };

    const onSubmit = async (values: ManagerIndividualProfileData) => {
        if (!userId) return;
        setIsSaving(true);
        const toastId = showLoading("Atualizando perfil de gestor PF...");

        const cleanCPF = values.cpf ? values.cpf.replace(/\D/g, '') : null;
        const cleanRG = values.rg ? values.rg.replace(/\D/g, '') : null;
        const cleanCEP = values.cep ? values.cep.replace(/\D/g, '') : null;
        
        const genderToSave = values.gender || null; 

        const dataToSave: Record<string, string | null> = {
            first_name: values.first_name || null,
            last_name: values.last_name || null,
            birth_date: values.birth_date || null,
            gender: genderToSave,
            cep: cleanCEP,
            rua: values.rua || null,
            bairro: values.bairro || null,
            cidade: values.cidade || null,
            estado: values.estado || null,
            numero: values.numero || null,
            complemento: values.complemento || null,
        };

        // Evita UPDATE desnecessário em CPF/RG (ex.: só dígitos vs máscara) que dispara unique em outra linha
        if (cleanCPF && !isSameDocument(profile?.cpf, cleanCPF)) {
            dataToSave.cpf = normalizeDocumentDigits(cleanCPF);
        }
        if (cleanRG && !isSameDocument(profile?.rg, cleanRG)) {
            dataToSave.rg = normalizeDocumentDigits(cleanRG);
        }

        try {
            const { error } = await supabase
                .from('profiles')
                .update(dataToSave)
                .eq('id', userId);

            if (error) {
                throw error;
            }

            dismissToast(toastId);
            showSuccess("Perfil de Gestor PF atualizado com sucesso!");
            queryClient.invalidateQueries({ queryKey: ['profile', userId] }); // Invalida o cache do perfil
            navigate('/manager/settings');

        } catch (e: any) {
            dismissToast(toastId);
            console.error("Erro ao atualizar Gestor PF:", e);
            showError(`Falha ao atualizar perfil: ${translateProfileSaveError(e)}`);
        } finally {
            setIsSaving(false);
        }
    };

    if (isFetching || isLoadingProfile) {
        return (
            <div className="max-w-4xl mx-auto px-4 sm:px-0 text-center py-20">
                <Loader2 className="h-10 w-10 animate-spin text-yellow-500 mx-auto mb-4" />
                <p className="text-gray-400">Carregando perfil de gestor...</p>
            </div>
        );
    }

    return (
        <div className="max-w-4xl mx-auto px-4 sm:px-0">
            <div className="flex items-center justify-between mb-8">
                <h1 className="text-2xl sm:text-3xl font-serif text-yellow-500 flex items-center">
                    <User className="h-7 w-7 mr-3" />
                    Perfil de Gestor (Pessoa Física)
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

            <Card className="bg-black border border-yellow-500/30 rounded-2xl shadow-2xl shadow-yellow-500/10">
                <CardHeader>
                    <CardTitle className="text-white text-xl sm:text-2xl font-semibold">
                        Dados Pessoais Obrigatórios
                    </CardTitle>
                    <CardDescription className="text-gray-400 text-sm">
                        Estes dados são essenciais para a validação da sua conta de gestor como Pessoa Física.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <Form {...form}>
                        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                            
                            {/* Nome e Sobrenome */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <FormField
                                    control={form.control}
                                    name="first_name"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel className="text-white">Nome *</FormLabel>
                                            <FormControl>
                                                <Input 
                                                    placeholder="Seu primeiro nome" 
                                                    {...field} 
                                                    className="bg-black/60 border-yellow-500/30 text-white placeholder-gray-500 focus:border-yellow-500" 
                                                />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={form.control}
                                    name="last_name"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel className="text-white">Sobrenome *</FormLabel>
                                            <FormControl>
                                                <Input 
                                                    placeholder="Seu sobrenome" 
                                                    {...field} 
                                                    className="bg-black/60 border-yellow-500/30 text-white placeholder-gray-500 focus:border-yellow-500" 
                                                />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                            </div>

                            {/* CPF e RG */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <FormField
                                    control={form.control}
                                    name="cpf"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel className="text-white">CPF *</FormLabel>
                                            <FormControl>
                                                <Input 
                                                    placeholder="000.000.000-00"
                                                    {...field} 
                                                    onChange={handleCpfChange}
                                                    className="bg-black/60 border-yellow-500/30 text-white placeholder-gray-500 focus:border-yellow-500" 
                                                    maxLength={14}
                                                />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={form.control}
                                    name="rg"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel className="text-white">RG *</FormLabel>
                                            <FormControl>
                                                <Input 
                                                    placeholder="00.000.000-0"
                                                    {...field} 
                                                    onChange={handleRgChange}
                                                    className="bg-black/60 border-yellow-500/30 text-white placeholder-gray-500 focus:border-yellow-500" 
                                                    maxLength={12}
                                                />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                            </div>

                            {/* Data de Nascimento e Gênero */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <FormField
                                    control={form.control}
                                    name="birth_date"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel className="text-white">Data de Nascimento *</FormLabel>
                                            <FormControl>
                                                <Input 
                                                    type="date" 
                                                    {...field} 
                                                    className="bg-black/60 border-yellow-500/30 text-white placeholder-gray-500 focus:border-yellow-500" 
                                                />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={form.control}
                                    name="gender"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel className="text-white">Gênero *</FormLabel>
                                            <Select 
                                                onValueChange={field.onChange} 
                                                value={field.value || ""} 
                                            >
                                                <FormControl>
                                                    <SelectTrigger 
                                                        className="w-full bg-black/60 border-yellow-500/30 text-white focus:ring-yellow-500"
                                                    >
                                                        <SelectValue placeholder="Selecione seu gênero" />
                                                    </SelectTrigger>
                                                </FormControl>
                                                <SelectContent className="bg-black border-yellow-500/30 text-white">
                                                    {GENDER_OPTIONS.map(option => (
                                                        <SelectItem key={option} value={option} className="hover:bg-yellow-500/10 cursor-pointer">
                                                            {option}
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                            </div>

                            {/* Seção de Endereço */}
                            <div className="space-y-6 pt-4 border-t border-yellow-500/10">
                                <h3 className="text-lg font-semibold text-white border-b border-yellow-500/10 pb-2">Endereço</h3>
                                
                                <FormField
                                    control={form.control}
                                    name="cep"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel className="text-white">CEP *</FormLabel>
                                            <FormControl>
                                                <div className="relative">
                                                    <Input 
                                                        placeholder="00000-000"
                                                        {...field} 
                                                        onChange={handleCepChange}
                                                        disabled={isCepLoading} 
                                                        className="bg-black/60 border-yellow-500/30 text-white placeholder-gray-500 focus:border-yellow-500 pr-10" 
                                                        maxLength={9}
                                                    />
                                                    {isCepLoading && (
                                                        <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
                                                            <Loader2 className="w-4 h-4 animate-spin text-yellow-500" />
                                                        </div>
                                                    )}
                                                </div>
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />

                                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                    <div className="md:col-span-2">
                                        <FormField
                                            control={form.control}
                                            name="rua"
                                            render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel className="text-white">Rua *</FormLabel>
                                                    <FormControl>
                                                        <Input id="rua" placeholder="Ex: Av. Paulista" {...field} disabled={isCepLoading} className="bg-black/60 border-yellow-500/30 text-white placeholder-gray-500 focus:border-yellow-500" />
                                                    </FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />
                                    </div>
                                    <FormField
                                        control={form.control}
                                        name="numero"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel className="text-white">Número *</FormLabel>
                                                <FormControl>
                                                    <Input id="numero" placeholder="123" {...field} disabled={isCepLoading} className="bg-black/60 border-yellow-500/30 text-white placeholder-gray-500 focus:border-yellow-500" />
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                </div>

                                <FormField
                                    control={form.control}
                                    name="complemento"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel className="text-white">Complemento (Opcional)</FormLabel>
                                            <FormControl>
                                                <Input placeholder="Apto 101, Bloco B" {...field} disabled={isCepLoading} className="bg-black/60 border-yellow-500/30 text-white placeholder-gray-500 focus:border-yellow-500" />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />

                                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                    <FormField
                                        control={form.control}
                                        name="bairro"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel className="text-white">Bairro *</FormLabel>
                                                <FormControl>
                                                    <Input placeholder="Jardim Paulista" {...field} disabled={isCepLoading} className="bg-black/60 border-yellow-500/30 text-white placeholder-gray-500 focus:border-yellow-500" />
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                    <FormField
                                        control={form.control}
                                        name="cidade"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel className="text-white">Cidade *</FormLabel>
                                                <FormControl>
                                                    <Input placeholder="São Paulo" {...field} disabled={isCepLoading} className="bg-black/60 border-yellow-500/30 text-white placeholder-gray-500 focus:border-yellow-500" />
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                    <FormField
                                        control={form.control}
                                        name="estado"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel className="text-white">Estado *</FormLabel>
                                                <FormControl>
                                                    <Input placeholder="SP" {...field} disabled={isCepLoading} className="bg-black/60 border-yellow-500/30 text-white placeholder-gray-500 focus:border-yellow-500" />
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                </div>
                            </div>

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
                                            Salvar Perfil PF
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
                </CardContent>
            </Card>
        </div>
    );
};

export default ManagerIndividualProfile;