"use client";

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { showSuccess, showError, showLoading, dismissToast } from '@/utils/toast';
import { Loader2, User, ArrowLeft } from 'lucide-react';
import { ProfileData } from '@/hooks/use-profile';
import { useQueryClient } from '@tanstack/react-query';
import { ensureGestorCompanyLinked } from '@/utils/ensureGestorCompany';

interface ManagerIndividualRegisterDialogProps {
    isOpen: boolean;
    onClose: () => void;
    profile: ProfileData | null | undefined;
    userId: string | undefined;
}

const GENDER_OPTIONS = [
    "Masculino",
    "Feminino",
    "Não binário",
    "Outro",
    "Prefiro não dizer"
];

// --- Utility Functions ---

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

const validateRG = (rg: string) => {
    const cleanRG = rg.replace(/\D/g, '');
    return cleanRG.length >= 7 && cleanRG.length <= 9;
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

// Schema para o registro de gestor individual (todos os campos são obrigatórios)
const managerIndividualProfileSchema = z.object({
    first_name: z.string().min(1, "Nome é obrigatório."),
    last_name: z.string().min(1, "Sobrenome é obrigatório."),
    birth_date: z.string().min(1, "Data de nascimento é obrigatória."),
    gender: z.string().min(1, "Gênero é obrigatório.").nullable(), 
    
    cpf: z.string().min(1, "CPF é obrigatório.").refine(validateCPF, { message: "CPF inválido." }),
    rg: z.string().min(1, "RG é obrigatório.").refine(validateRG, { message: "RG inválido." }),

    cep: z.string().min(1, "CEP é obrigatório.").refine((val) => val.replace(/\D/g, '').length === 8, { message: "CEP inválido (8 dígitos)." }),
    rua: z.string().min(1, "Rua é obrigatória."),
    bairro: z.string().min(1, "Bairro é obrigatório."),
    cidade: z.string().min(1, "Cidade é obrigatória."),
    estado: z.string().min(1, "Estado é obrigatório."),
    numero: z.string().min(1, "Número é obrigatório."),
    complemento: z.string().min(1, "Complemento é obrigatório.").nullable(),
});

type ManagerIndividualProfileData = z.infer<typeof managerIndividualProfileSchema>;

const ManagerIndividualRegisterDialog: React.FC<ManagerIndividualRegisterDialogProps> = ({
    isOpen,
    onClose,
    profile,
    userId,
}) => {
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const [isSaving, setIsSaving] = useState(false);
    const [isCepLoading, setIsCepLoading] = useState(false);

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
    });

    // Preenche o formulário com os dados do perfil ao abrir o modal
    useEffect(() => {
        if (profile) {
            form.reset({
                first_name: profile.first_name || '',
                last_name: profile.last_name || '', 
                birth_date: profile.birth_date || '',
                gender: profile.gender || "", 
                cpf: profile.cpf ? formatCPF(profile.cpf) : '',
                rg: profile.rg ? formatRG(profile.rg) : '',
                cep: profile.cep ? formatCEP(profile.cep) : '',
                rua: profile.rua || '',
                bairro: profile.bairro || '',
                cidade: profile.cidade || '',
                estado: profile.estado || '',
                numero: profile.numero || '',
                complemento: profile.complemento || '',
            });
        }
    }, [profile, form]);

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
    
    // Função auxiliar para preparar os dados para salvar no DB
    const prepareDataToSave = (values: ManagerIndividualProfileData, promoteToManager: boolean) => {
        const cleanCPF = values.cpf ? values.cpf.replace(/\D/g, '') : null;
        const cleanRG = values.rg ? values.rg.replace(/\D/g, '') : null;
        const cleanCEP = values.cep ? values.cep.replace(/\D/g, '') : null;
        
        const genderToSave = values.gender || null; 

        return {
            first_name: values.first_name || null,
            last_name: values.last_name || null, 
            birth_date: values.birth_date || null,
            gender: genderToSave,
            cpf: cleanCPF,
            rg: cleanRG,
            cep: cleanCEP,
            rua: values.rua || null,
            bairro: values.bairro || null,
            cidade: values.cidade || null,
            estado: values.estado || null,
            numero: values.numero || null,
            complemento: values.complemento || null,
            // Se for promover, define tipo 2 (Gestor PRO) e natureza jurídica 1 (Pessoa Física).
            tipo_usuario_id: promoteToManager ? 2 : profile?.tipo_usuario_id, 
            natureza_juridica_id: promoteToManager ? 1 : profile?.natureza_juridica_id, // NOVO: Adicionando natureza jurídica
        };
    };

    // Função para salvar o progresso (rascunho) sem promover o usuário
    const saveDraftProfile = async () => {
        if (!userId || isSaving) return;
        
        // Obtém os valores atuais do formulário (incluindo campos incompletos)
        const currentValues = form.getValues();
        
        // Prepara os dados, mantendo o tipo de usuário atual (tipo 3)
        const dataToSave = prepareDataToSave(currentValues, false);

        try {
            // Salva o rascunho no perfil do usuário
            const { error } = await supabase
                .from('profiles')
                .update(dataToSave)
                .eq('id', userId);

            if (error) {
                console.error("Warning: Failed to save draft profile:", error);
            } else {
                // Invalida o cache do perfil para que os dados preenchidos sejam carregados na próxima vez
                queryClient.invalidateQueries({ queryKey: ['profile', userId] });
            }
        } catch (e) {
            console.error("Unexpected error during draft save:", e);
        }
    };

    const handleCloseModal = () => {
        // Salva o progresso antes de fechar
        saveDraftProfile();
        onClose();
    };

    const onSubmit = async (values: ManagerIndividualProfileData) => {
        if (!userId) {
            showError("Usuário não autenticado.");
            return;
        }
        setIsSaving(true);
        const toastId = showLoading("Registrando como Gestor PF...");

        // Prepara os dados, PROMOVENDO para tipo 2 e natureza jurídica 1
        const dataToSave = prepareDataToSave(values, true);

        try {
            // 1. Atualiza o perfil e promove o usuário
            const { error } = await supabase
                .from('profiles')
                .update(dataToSave)
                .eq('id', userId);

            if (error) {
                throw error;
            }

            // Vínculo obrigatório empresa ↔ gestor (pulseiras, eventos, relatórios usam company_id)
            try {
                await ensureGestorCompanyLinked(supabase, userId, {
                    tipo_usuario_id: 2,
                    natureza_juridica_id: 1,
                    first_name: values.first_name,
                    last_name: values.last_name,
                    cpf: values.cpf.replace(/\D/g, ''),
                    cep: values.cep.replace(/\D/g, ''),
                    rua: values.rua,
                    bairro: values.bairro,
                    cidade: values.cidade,
                    estado: values.estado,
                    numero: values.numero,
                    complemento: values.complemento,
                });
                await queryClient.invalidateQueries({ queryKey: ['managerCompany', userId] });
            } catch (linkErr: unknown) {
                const msg = linkErr instanceof Error ? linkErr.message : 'Falha ao criar vínculo com empresa.';
                throw new Error(`${msg} Seu perfil foi atualizado; tente salvar um evento novamente ou contate o suporte.`);
            }

            dismissToast(toastId);
            showSuccess("Cadastro como Gestor PF realizado com sucesso! Redirecionando para o Dashboard PRO.");
            queryClient.invalidateQueries({ queryKey: ['profile', userId] }); // Invalida o cache do perfil
            onClose(); // Fecha o modal
            navigate('/manager/dashboard'); // Redireciona para o dashboard do gestor

        } catch (e: any) {
            dismissToast(toastId);
            console.error("Erro ao registrar como Gestor PF:", e);
            showError(`Falha ao registrar: ${e.message || 'Erro desconhecido'}`);
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={handleCloseModal}>
            <DialogContent className="sm:max-w-[800px] bg-black/90 border border-yellow-500/30 text-white p-6">
                <DialogHeader>
                    <DialogTitle className="text-yellow-500 text-2xl flex items-center">
                        <User className="h-6 w-6 mr-2" />
                        Cadastro de Gestor PF
                    </DialogTitle>
                    <DialogDescription className="text-gray-400">
                        Preencha seus dados pessoais para se registrar como gestor individual. Todos os campos são obrigatórios.
                    </DialogDescription>
                </DialogHeader>
                <div className="max-h-[60vh] overflow-y-auto pr-4">
                    <Form {...form}>
                        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6 py-4">
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
                                                    isInvalid={!!form.formState.errors.first_name}
                                                    className={`bg-black/60 text-white placeholder-gray-500 focus:border-yellow-500`} 
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
                                                    isInvalid={!!form.formState.errors.last_name}
                                                    className={`bg-black/60 text-white placeholder-gray-500 focus:border-yellow-500`} 
                                                />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                            </div>

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
                                                    isInvalid={!!form.formState.errors.cpf}
                                                    className={`bg-black/60 text-white placeholder-gray-500 focus:border-yellow-500`} 
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
                                                    isInvalid={!!form.formState.errors.rg}
                                                    className={`bg-black/60 text-white placeholder-gray-500 focus:border-yellow-500`} 
                                                    maxLength={12}
                                                />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                            </div>

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
                                                    isInvalid={!!form.formState.errors.birth_date}
                                                    className={`bg-black/60 text-white placeholder-gray-500 focus:border-yellow-500`} 
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
                                                        isInvalid={!!form.formState.errors.gender}
                                                        className={`w-full bg-black/60 text-white focus:ring-yellow-500`}
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
                            <div className="pt-4 border-t border-yellow-500/20">
                                <h3 className="text-xl font-semibold text-white mb-4">Endereço</h3>
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
                                                        isInvalid={!!form.formState.errors.cep}
                                                        className={`bg-black/60 text-white placeholder-gray-500 focus:border-yellow-500 pr-10`} 
                                                        maxLength={9}
                                                    />
                                                    {isCepLoading && (
                                                        <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
                                                            <Loader2 className="w-4 h-4 border-2 border-yellow-500/20 border-t-yellow-500 rounded-full animate-spin">
                                                            </Loader2>
                                                        </div>
                                                    )}
                                                </div>
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                <div className="md:col-span-2">
                                    <FormField
                                        control={form.control}
                                        name="rua"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel className="text-white">Rua *</FormLabel>
                                                <FormControl>
                                                    <Input 
                                                        id="rua" 
                                                        placeholder="Ex: Av. Paulista" 
                                                        {...field} 
                                                        disabled={isCepLoading} 
                                                        isInvalid={!!form.formState.errors.rua}
                                                        className={`bg-black/60 text-white placeholder-gray-500 focus:border-yellow-500`} 
                                                    />
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
                                                <Input 
                                                    id="numero" 
                                                    placeholder="123" 
                                                    {...field} 
                                                    disabled={isCepLoading} 
                                                    isInvalid={!!form.formState.errors.numero}
                                                    className={`bg-black/60 text-white placeholder-gray-500 focus:border-yellow-500`} 
                                                />
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
                                        <FormLabel className="text-white">Complemento *</FormLabel>
                                        <FormControl>
                                            <Input 
                                                placeholder="Apto 101, Bloco B" 
                                                {...field} 
                                                disabled={isCepLoading} 
                                                isInvalid={!!form.formState.errors.complemento}
                                                className={`bg-black/60 text-white placeholder-gray-500 focus:border-yellow-500`} 
                                            />
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
                                                <Input 
                                                    placeholder="Jardim Paulista" 
                                                    {...field} 
                                                    disabled={isCepLoading} 
                                                    isInvalid={!!form.formState.errors.bairro}
                                                    className={`bg-black/60 text-white placeholder-gray-500 focus:border-yellow-500`} 
                                                />
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
                                                <Input 
                                                    placeholder="São Paulo" 
                                                    {...field} 
                                                    disabled={isCepLoading} 
                                                    isInvalid={!!form.formState.errors.cidade}
                                                    className={`bg-black/60 text-white placeholder-gray-500 focus:border-yellow-500`} 
                                                />
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
                                                <Input 
                                                    placeholder="SP" 
                                                    {...field} 
                                                    disabled={isCepLoading} 
                                                    isInvalid={!!form.formState.errors.estado}
                                                    className={`bg-black/60 text-white placeholder-gray-500 focus:border-yellow-500`} 
                                                />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                            </div>

                            <DialogFooter className="pt-4 flex flex-col sm:flex-row space-y-4 sm:space-y-0 sm:space-x-4">
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
                                            <User className="w-5 h-5 mr-2" />
                                            Registrar como Gestor PF
                                        </>
                                    )}
                                </Button>
                                <Button
                                    type="button"
                                    onClick={handleCloseModal} // Usa o novo handler que salva o rascunho
                                    variant="outline"
                                    className="flex-1 bg-black/60 border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 py-3 text-lg font-semibold transition-all duration-300 cursor-pointer"
                                    disabled={isSaving}
                                >
                                    <ArrowLeft className="mr-2 h-5 w-5" />
                                    Voltar
                                </Button>
                            </DialogFooter>
                        </form>
                    </Form>
                </div>
            </DialogContent>
        </Dialog>
    );
};

export default ManagerIndividualRegisterDialog;