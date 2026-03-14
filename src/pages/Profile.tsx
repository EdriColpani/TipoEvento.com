import React, { useEffect, useState } from 'react';
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
import { showSuccess, showError } from '@/utils/toast';
import { Skeleton } from '@/components/ui/skeleton';
import AuthStatusMenu from '@/components/AuthStatusMenu';
import AvatarUpload from '@/components/AvatarUpload';
import { useProfileStatus } from '@/hooks/use-profile-status';
import { useProfile, ProfileData } from '@/hooks/use-profile';
import { useQueryClient } from '@tanstack/react-query';
import MultiLineEditor from '@/components/MultiLineEditor'; // Importando o editor

const GENDER_OPTIONS = [
    "Masculino",
    "Feminino",
    "Não binário",
    "Outro",
    "Prefiro não dizer"
];

// Função de validação de CPF (simplificada para o frontend)
const validateCPF = (cpf: string) => {
    const cleanCPF = cpf.replace(/\D/g, '');
    return cleanCPF.length === 11;
};

// Função de validação de CEP (apenas formato)
const validateCEP = (cep: string) => {
    const cleanCEP = cep.replace(/\D/g, '');
    return cleanCEP.length === 8;
};

const profileSchema = z.object({
    first_name: z.string().min(2, { message: "O nome deve ter pelo menos 2 caracteres." }),
    last_name: z.string().optional().nullable(), // Sobrenome opcional para clientes
    birth_date: z.string().refine((val) => val && !isNaN(Date.parse(val)), { message: "Data de nascimento é obrigatória." }),
    gender: z.string().optional().nullable(),
    
    cpf: z.string().refine(validateCPF, { message: "CPF inválido." }),
    rg: z.string().optional().nullable(), 

    // Campos de Endereço
    cep: z.string().optional().nullable().refine((val) => !val || validateCEP(val), { message: "CEP inválido (8 dígitos)." }),
    rua: z.string().optional().nullable(),
    bairro: z.string().optional().nullable(),
    cidade: z.string().optional().nullable(),
    estado: z.string().optional().nullable(),
    numero: z.string().optional().nullable(),
    complemento: z.string().optional().nullable(),
});

const Profile: React.FC = () => {
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const [session, setSession] = useState<any>(null);
    const [loadingSession, setLoadingSession] = useState(true);
    const [formLoading, setFormLoading] = useState(false);
    const [isEditing, setIsEditing] = useState(false);
    const [isCepLoading, setIsCepLoading] = useState(false);
    const [agreedToTerms, setAgreedToTerms] = useState(false); // NOVO: Estado de concordância

    useEffect(() => {
        const checkSession = async () => {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) {
                navigate('/login');
                return;
            }
            setSession(session);
            setLoadingSession(false);
        };
        checkSession();
    }, [navigate]);

    const userId = session?.user?.id;
    const { profile, isLoading: isLoadingProfile, refetch } = useProfile(userId);
    const { hasPendingNotifications, loading: statusLoading } = useProfileStatus(profile, isLoadingProfile);

    const loading = loadingSession || isLoadingProfile;

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
        // Formato comum de RG (XX.XXX.XXX-X)
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

    const form = useForm<z.infer<typeof profileSchema>>({
        resolver: zodResolver(profileSchema),
        defaultValues: {
            first_name: '',
            last_name: '',
            birth_date: '',
            gender: '',
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
            gender: profile?.gender || '',
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

    useEffect(() => {
        if (profile) {
            // Resetar o formulário com os dados do perfil sempre que o perfil for carregado/atualizado
            form.reset({
                first_name: profile.first_name || '',
                last_name: profile.last_name || '',
                birth_date: profile.birth_date || '',
                gender: profile.gender || '',
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


    // Função para buscar endereço via ViaCEP
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
                // Limpa campos de endereço se o CEP for inválido
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
                // Foca no campo número após o preenchimento automático
                document.getElementById('numero')?.focus();
            }
        } catch (error) {
            console.error("Erro ao buscar CEP:", error);
            showError("Erro na comunicação com o serviço de CEP.");
        } finally {
            setIsCepLoading(false);
        }
    };

    // Funções de formatação no input
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

        // Se o CEP atingir 8 dígitos (após formatação, 9 caracteres com hífen), busca o endereço
        if (formattedCep.replace(/\D/g, '').length === 8) {
            fetchAddressByCep(formattedCep);
        }
    };

    const onSubmit = async (values: z.infer<typeof profileSchema>) => {
        if (!session || !profile) return;
        
        // Se estiver editando, exige a concordância com os termos
        if (isEditing && !agreedToTerms) {
            showError("Você deve concordar com os Termos e Condições para salvar as alterações.");
            return;
        }
        
        setFormLoading(true);

        // Limpeza e conversão para salvar no DB
        const cleanCPF = values.cpf.replace(/\D/g, '');
        const cleanRG = values.rg ? values.rg.replace(/\D/g, '') : null;
        const cleanCEP = values.cep ? values.cep.replace(/\D/g, '') : null;
        
        const genderToSave = (values.gender === "not_specified" || !values.gender) ? null : values.gender;

        // Certifique-se de que campos de endereço vazios sejam salvos como null, não como strings vazias
        const ruaToSave = values.rua || null;
        const bairroToSave = values.bairro || null;
        const cidadeToSave = values.cidade || null;
        const estadoToSave = values.estado || null;
        const numeroToSave = values.numero || null;
        const complementoToSave = values.complemento || null;
        const lastNameToSave = values.last_name || null;

        try {
            const { error } = await supabase
                .from('profiles')
                .update({ 
                    first_name: values.first_name,
                    last_name: lastNameToSave, // Salvando o sobrenome
                    birth_date: values.birth_date,
                    gender: genderToSave,
                    cpf: cleanCPF, 
                    rg: cleanRG,
                    // Salvando endereço
                    cep: cleanCEP,
                    rua: ruaToSave,
                    bairro: bairroToSave,
                    cidade: cidadeToSave,
                    estado: estadoToSave,
                    numero: numeroToSave,
                    complemento: complementoToSave,
                    // Mantém a natureza jurídica existente (que deve ser 1 para clientes)
                    natureza_juridica_id: profile.natureza_juridica_id || 1, 
                })
                .eq('id', session.user.id);

            if (error) {
                showError("Erro ao atualizar o perfil.");
                console.error("Supabase Update Error:", error);
            } else {
                showSuccess("Perfil atualizado com sucesso!");
                // Invalida a query para forçar a re-busca e atualização imediata do status de notificação em todos os componentes
                queryClient.invalidateQueries({ queryKey: ['profile', userId] });
                setIsEditing(false);
            }
        } catch (e) {
            // Captura erros inesperados (como falhas de rede/timeout)
            console.error("Unexpected error during profile update:", e);
            showError("Ocorreu um erro inesperado ao salvar o perfil. Verifique sua conexão.");
        } finally {
            setFormLoading(false);
        }
    };

    const onInvalid = (errors: any) => {
        console.error("Form Validation Errors:", errors);
        showError("Por favor, corrija os erros no formulário antes de salvar.");
        setFormLoading(false);
    };

    const handleAvatarUpload = (newUrl: string) => {
        // Atualiza o cache localmente para refletir a mudança imediatamente
        queryClient.setQueryData(['profile', userId], (oldData: ProfileData | undefined) => {
            if (oldData) {
                return { ...oldData, avatar_url: newUrl };
            }
            return oldData;
        });
    };

    const handleCancelEdit = () => {
        // O reset agora usa os valores do 'profile' carregado pelo useQuery
        form.reset();
        setIsEditing(false);
        setAgreedToTerms(false); // Reseta a concordância
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-black text-white flex items-center justify-center">
                <div className="w-full max-w-4xl p-6 space-y-8">
                    <Skeleton className="h-10 w-1/3" />
                    <Card className="bg-black/80 border-yellow-500/30">
                        <CardHeader>
                            <Skeleton className="h-8 w-1/2" />
                            <Skeleton className="h-4 w-2/3" />
                        </CardHeader>
                        <CardContent className="space-y-6">
                            <div className="flex items-center space-x-4">
                                <Skeleton className="h-24 w-24 rounded-full" />
                                <div className="space-y-2">
                                    <Skeleton className="h-6 w-48" />
                                    <Skeleton className="h-4 w-64" />
                                </div>
                            </div>
                            <Skeleton className="h-10 w-full" />
                            <Skeleton className="h-10 w-full" />
                            <div className="grid grid-cols-2 gap-4">
                                <Skeleton className="h-10 w-full" />
                                <Skeleton className="h-10 w-full" />
                            </div>
                            <Skeleton className="h-10 w-full" />
                            <Skeleton className="h-12 w-32" />
                        </CardContent>
                    </Card>
                </div>
            </div>
        );
    }

    const initials = profile?.first_name ? profile.first_name.charAt(0).toUpperCase() : 'U';
    const fullName = profile?.first_name + (profile?.last_name ? ` ${profile.last_name}` : '');
    const userRoleDisplay = profile?.tipo_usuario_id === 3 ? 'Cliente' : 'Gestor PRO'; // Simplificado para exibição

    return (
        <div className="min-h-screen bg-black text-white">
             <header className="fixed top-0 left-0 right-0 z-[100] bg-black/80 backdrop-blur-md border-b border-yellow-500/20">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
                    <div className="flex items-center space-x-8">
                        <div className="text-xl sm:text-2xl font-serif text-yellow-500 font-bold cursor-pointer" onClick={() => navigate('/')}>
                            EventoFest
                        </div>
                        <nav className="hidden md:flex items-center space-x-8">
                            <a href="/#home" className="text-white hover:text-yellow-500 transition-colors duration-300 cursor-pointer">Home</a>
                            <a href="/#eventos" className="text-white hover:text-yellow-500 transition-colors duration-300 cursor-pointer">Eventos</a>
                            <a href="/#categorias" className="text-white hover:text-yellow-500 transition-colors duration-300 cursor-pointer">Categorias</a>
                            <a href="/#contato" className="text-white hover:text-yellow-500 transition-colors duration-300 cursor-pointer">Contato</a>
                        </nav>
                    </div>
                    <div className="flex items-center space-x-4">
                        <div className="relative hidden lg:block">
                            <Input 
                                type="search" 
                                placeholder="Buscar eventos..." 
                                className="bg-black/60 border-yellow-500/30 text-white placeholder-gray-500 focus:border-yellow-500 w-64 pl-4 pr-10 py-2 rounded-xl"
                            />
                            <i className="fas fa-search absolute right-4 top-1/2 transform -translate-y-1/2 text-yellow-500/60"></i>
                        </div>
                        <AuthStatusMenu />
                    </div>
                </div>
            </header>
            <main className="pt-24 pb-12 px-4 sm:px-6"> {/* Ajustado o padding-top */}
                <div className="max-w-4xl mx-auto">
                    <h1 className="text-3xl sm:text-4xl font-serif text-yellow-500 mb-8">Meu Perfil</h1>
                    
                    {/* Informações de Identificação */}
                    <div className="bg-black/80 backdrop-blur-sm border border-yellow-500/30 rounded-2xl p-6 mb-8">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-gray-400 text-sm">Nome Completo:</p>
                                <h2 className="text-xl font-semibold text-white mb-2">{fullName}</h2>
                                <p className="text-gray-400 text-sm">Função: <span className="text-yellow-500 font-medium">{userRoleDisplay}</span></p>
                            </div>
                            <div className="text-right">
                                <p className="text-gray-400 text-xs">Seu Código de Usuário:</p>
                                <span className="text-2xl font-mono text-yellow-500 font-bold tracking-widest">{profile?.public_id || 'N/A'}</span>
                            </div>
                        </div>
                    </div>

                    {/* Alerta de Perfil Incompleto */}
                    {hasPendingNotifications && profile?.tipo_usuario_id === 3 && (
                        <div className="bg-red-500/20 border border-red-500/50 text-red-400 p-4 rounded-xl mb-8 flex items-start space-x-3 animate-fadeInUp">
                            <i className="fas fa-exclamation-triangle text-xl mt-1"></i>
                            <div>
                                <h3 className="font-semibold text-white mb-1">Atenção: Perfil Incompleto</h3>
                                <p className="text-sm">
                                    Por favor, preencha todos os campos do seu perfil (incluindo RG, Gênero e Endereço completo) para liberar todas as funcionalidades e garantir a emissão correta de ingressos.
                                </p>
                            </div>
                        </div>
                    )}

                    <div className="grid grid-cols-1 gap-8">
                        <div className="col-span-1">
                            <Card className="bg-black/80 backdrop-blur-sm border border-yellow-500/30 rounded-2xl">
                                <CardHeader>
                                    <CardTitle className="text-white text-xl sm:text-2xl">Informações Pessoais</CardTitle>
                                    <CardDescription className="text-gray-400 text-sm">Atualize seus dados pessoais aqui.</CardDescription>
                                </CardHeader>
                                <CardContent>
                                    {session?.user?.id && (
                                        <div className="mb-8">
                                            <AvatarUpload
                                                userId={session.user.id}
                                                url={profile?.avatar_url || null}
                                                onUpload={handleAvatarUpload}
                                                initials={initials}
                                            />
                                        </div>
                                    )}
                                    <Form {...form}>
                                        <form onSubmit={form.handleSubmit(onSubmit, onInvalid)} className="space-y-6">
                                            
                                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                                                <FormField
                                                    control={form.control}
                                                    name="first_name"
                                                    render={({ field }) => (
                                                        <FormItem>
                                                            <FormLabel className="text-white">Nome *</FormLabel>
                                                            <FormControl>
                                                                <Input placeholder="Seu nome" {...field} disabled={!isEditing} className="bg-black/60 border-yellow-500/30 text-white placeholder-gray-500 focus:border-yellow-500 disabled:text-gray-400 disabled:cursor-not-allowed" />
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
                                                            <FormLabel className="text-white">Sobrenome (Opcional)</FormLabel>
                                                            <FormControl>
                                                                <Input placeholder="Seu sobrenome" {...field} disabled={!isEditing} className="bg-black/60 border-yellow-500/30 text-white placeholder-gray-500 focus:border-yellow-500 disabled:text-gray-400 disabled:cursor-not-allowed" />
                                                            </FormControl>
                                                            <FormMessage />
                                                        </FormItem>
                                                    )}
                                                />
                                            </div>

                                            <FormItem>
                                                <FormLabel className="text-white">E-mail</FormLabel>
                                                <FormControl>
                                                    <Input 
                                                        value={session?.user?.email || ''} 
                                                        disabled 
                                                        className="bg-black/60 border-yellow-500/30 text-gray-400 cursor-not-allowed" 
                                                    />
                                                </FormControl>
                                            </FormItem>
                                            
                                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
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
                                                                    disabled={!isEditing} 
                                                                    className="bg-black/60 border-yellow-500/30 text-white placeholder-gray-500 focus:border-yellow-500 disabled:text-gray-400 disabled:cursor-not-allowed" 
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
                                                            <FormLabel className="text-white">RG (Opcional)</FormLabel>
                                                            <FormControl>
                                                                <Input 
                                                                    placeholder="00.000.000-0"
                                                                    {...field} 
                                                                    onChange={handleRgChange}
                                                                    disabled={!isEditing} 
                                                                    className="bg-black/60 border-yellow-500/30 text-white placeholder-gray-500 focus:border-yellow-500 disabled:text-gray-400 disabled:cursor-not-allowed" 
                                                                    maxLength={12}
                                                                />
                                                            </FormControl>
                                                            <FormMessage />
                                                        </FormItem>
                                                    )}
                                                />
                                            </div>

                                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
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
                                                                    disabled={!isEditing} 
                                                                    className="bg-black/60 border-yellow-500/30 text-white placeholder-gray-500 focus:border-yellow-500 disabled:text-gray-400 disabled:cursor-not-allowed" 
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
                                                            <FormLabel className="text-white">Gênero (Opcional)</FormLabel>
                                                            <Select 
                                                                onValueChange={(value) => field.onChange(value === "not_specified" ? null : value)} 
                                                                defaultValue={field.value || "not_specified"} 
                                                                disabled={!isEditing}
                                                            >
                                                                <FormControl>
                                                                    <SelectTrigger 
                                                                        className="w-full bg-black/60 border-yellow-500/30 text-white focus:ring-yellow-500 disabled:text-gray-400 disabled:cursor-not-allowed"
                                                                    >
                                                                        <SelectValue placeholder="Selecione seu gênero" />
                                                                    </SelectTrigger>
                                                                </FormControl>
                                                                <SelectContent className="bg-black border-yellow-500/30 text-white">
                                                                    <SelectItem value="not_specified" className="text-gray-500">
                                                                        Não especificado
                                                                    </SelectItem>
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

                                            {/* --- Seção de Endereço --- */}
                                            <div className="pt-4 border-t border-yellow-500/20">
                                                <h3 className="text-xl font-semibold text-white mb-4">Endereço</h3>
                                                <FormField
                                                    control={form.control}
                                                    name="cep"
                                                    render={({ field }) => (
                                                        <FormItem>
                                                            <FormLabel className="text-white">CEP (Opcional)</FormLabel>
                                                            <FormControl>
                                                                <div className="relative">
                                                                    <Input 
                                                                        placeholder="00000-000"
                                                                        {...field} 
                                                                        onChange={handleCepChange}
                                                                        disabled={!isEditing || isCepLoading} 
                                                                        className="bg-black/60 border-yellow-500/30 text-white placeholder-gray-500 focus:border-yellow-500 disabled:text-gray-400 disabled:cursor-not-allowed pr-10" 
                                                                        maxLength={9}
                                                                    />
                                                                    {isCepLoading && (
                                                                        <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
                                                                            <div className="w-4 h-4 border-2 border-yellow-500/20 border-t-yellow-500 rounded-full animate-spin"></div>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            </FormControl>
                                                            <FormMessage />
                                                        </FormItem>
                                                    )}
                                                />
                                            </div>

                                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                                                <div className="sm:col-span-2">
                                                    <FormField
                                                        control={form.control}
                                                        name="rua"
                                                        render={({ field }) => (
                                                            <FormItem>
                                                                <FormLabel className="text-white">Rua (Opcional)</FormLabel>
                                                                <FormControl>
                                                                    <Input id="rua" placeholder="Ex: Av. Paulista" {...field} disabled={!isEditing || isCepLoading} className="bg-black/60 border-yellow-500/30 text-white placeholder-gray-500 focus:border-yellow-500 disabled:text-gray-400 disabled:cursor-not-allowed" />
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
                                                            <FormLabel className="text-white">Número (Opcional)</FormLabel>
                                                            <FormControl>
                                                                <Input id="numero" placeholder="123" {...field} disabled={!isEditing || isCepLoading} className="bg-black/60 border-yellow-500/30 text-white placeholder-gray-500 focus:border-yellow-500 disabled:text-gray-400 disabled:cursor-not-allowed" />
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
                                                            <Input placeholder="Apto 101, Bloco B" {...field} disabled={!isEditing || isCepLoading} className="bg-black/60 border-yellow-500/30 text-white placeholder-gray-500 focus:border-yellow-500 disabled:text-gray-400 disabled:cursor-not-allowed" />
                                                        </FormControl>
                                                        <FormMessage />
                                                    </FormItem>
                                                )}
                                            />

                                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                                                <FormField
                                                    control={form.control}
                                                    name="bairro"
                                                    render={({ field }) => (
                                                        <FormItem>
                                                            <FormLabel className="text-white">Bairro (Opcional)</FormLabel>
                                                            <FormControl>
                                                                <Input placeholder="Jardim Paulista" {...field} disabled={!isEditing || isCepLoading} className="bg-black/60 border-yellow-500/30 text-white placeholder-gray-500 focus:border-yellow-500 disabled:text-gray-400 disabled:cursor-not-allowed" />
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
                                                            <FormLabel className="text-white">Cidade (Opcional)</FormLabel>
                                                            <FormControl>
                                                                <Input placeholder="São Paulo" {...field} disabled={!isEditing || isCepLoading} className="bg-black/60 border-yellow-500/30 text-white placeholder-gray-500 focus:border-yellow-500 disabled:text-gray-400 disabled:cursor-not-allowed" />
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
                                                            <FormLabel className="text-white">Estado (Opcional)</FormLabel>
                                                            <FormControl>
                                                                <Input placeholder="SP" {...field} disabled={!isEditing || isCepLoading} className="bg-black/60 border-yellow-500/30 text-white placeholder-gray-500 focus:border-yellow-500 disabled:text-gray-400 disabled:cursor-not-allowed" />
                                                            </FormControl>
                                                            <FormMessage />
                                                        </FormItem>
                                                    )}
                                                />
                                            </div>
                                            
                                            {/* --- NOVO: MultiLineEditor para Termos e Condições --- */}
                                            {isEditing && (
                                                <div className="pt-6 border-t border-yellow-500/20">
                                                    <MultiLineEditor 
                                                        onAgree={setAgreedToTerms} 
                                                        initialAgreedState={agreedToTerms}
                                                        showAgreementCheckbox={true}
                                                        termsType="general"
                                                    />
                                                </div>
                                            )}

                                            {isEditing ? (
                                                <div className="flex items-center space-x-4 pt-4">
                                                    <Button 
                                                        type="submit" 
                                                        disabled={formLoading || !agreedToTerms} 
                                                        className="bg-yellow-500 text-black hover:bg-yellow-600 transition-all duration-300 cursor-pointer disabled:opacity-50"
                                                    >
                                                        {formLoading ? (
                                                            <div className="flex items-center justify-center">
                                                                <div className="w-5 h-5 border-2 border-black/20 border-t-black rounded-full animate-spin mr-2"></div>
                                                                Salvando...
                                                            </div>
                                                        ) : 'Salvar Alterações'}
                                                    </Button>
                                                    <Button type="button" variant="outline" onClick={handleCancelEdit} className="bg-black/60 border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10">
                                                        Cancelar
                                                    </Button>
                                                </div>
                                            ) : (
                                                <div className="flex flex-col sm:flex-row space-y-4 sm:space-y-0 sm:space-x-4 pt-4">
                                                    <Button type="button" onClick={() => setIsEditing(true)} className="flex-1 bg-yellow-500 text-black hover:bg-yellow-600 transition-all duration-300 cursor-pointer">
                                                        Editar Perfil
                                                    </Button>
                                                    <Button 
                                                        type="button" 
                                                        onClick={() => navigate('/tickets')}
                                                        variant="outline"
                                                        className="flex-1 bg-black/60 border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 transition-all duration-300 cursor-pointer"
                                                    >
                                                        <i className="fas fa-ticket-alt mr-2"></i>
                                                        Ver Meus Ingressos
                                                    </Button>
                                                </div>
                                            )}
                                        </form>
                                    </Form>
                                </CardContent>
                            </Card>
                        </div>
                    </div>
                </div>
            </main>
        </div>
    );
};

export default Profile;