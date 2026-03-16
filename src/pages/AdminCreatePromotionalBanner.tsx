"use client";

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { showSuccess, showError, showLoading, dismissToast } from '@/utils/toast';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, ImageOff, CalendarDays, ListOrdered, Heading, Subtitles, ArrowLeft, Save } from 'lucide-react';
import { format } from 'date-fns';
import { DatePicker } from '@/components/DatePicker';
import ImageUploadPicker from '@/components/ImageUploadPicker';
import { useProfile } from '@/hooks/use-profile'; // Importando useProfile

// Zod schema for promotional banner validation
const promotionalBannerSchema = z.object({
    image_url: z.string().url("URL da Imagem/Banner é obrigatória e deve ser uma URL válida."),
    headline: z.string().min(1, "Título é obrigatório."),
    subheadline: z.string().min(1, "Subtítulo é obrigatório."),
    display_order: z.union([z.number().min(0, "Ordem de Exibição deve ser 0 ou maior."), z.literal('')]).transform(e => e === '' ? 0 : Number(e)),
    start_date: z.date({ required_error: "Data de Início é obrigatória." }),
    end_date: z.date({ required_error: "Data de Fim é obrigatória." }),
    link_url: z.string().url("URL de Link deve ser uma URL válida.").optional().or(z.literal('')),
});

type PromotionalBannerFormData = z.infer<typeof promotionalBannerSchema>;

const ADMIN_MASTER_USER_TYPE_ID = 1;

const AdminCreatePromotionalBanner: React.FC = () => {
    const navigate = useNavigate();
    const [isSaving, setIsSaving] = useState(false);
    const [userId, setUserId] = useState<string | null>(null);

    useEffect(() => {
        supabase.auth.getUser().then(({ data: { user } }) => {
            setUserId(user?.id || null);
        });
    }, []);
    
    const { profile, isLoading: isLoadingProfile } = useProfile(userId || undefined);

    const form = useForm<PromotionalBannerFormData>({
        resolver: zodResolver(promotionalBannerSchema),
        defaultValues: {
            image_url: '',
            headline: '',
            subheadline: '',
            display_order: 0,
            start_date: undefined,
            end_date: undefined,
            link_url: '',
        },
    });

    const handleImageUpload = (url: string) => {
        form.setValue('image_url', url, { shouldValidate: true });
    };

    const onSubmit = async (values: PromotionalBannerFormData) => {
        if (!userId || Number(profile?.tipo_usuario_id) !== ADMIN_MASTER_USER_TYPE_ID) {
            showError("Acesso negado. Apenas Administradores Master podem criar banners.");
            return;
        }

        setIsSaving(true);
        const toastId = showLoading("Criando banner promocional...");

        const isoStartDate = values.start_date ? format(values.start_date, 'yyyy-MM-dd') : null;
        const isoEndDate = values.end_date ? format(values.end_date, 'yyyy-MM-dd') : null;

        try {
            const { error } = await supabase
                .from('promotional_banners')
                .insert([
                    {
                        image_url: values.image_url,
                        headline: values.headline,
                        subheadline: values.subheadline,
                        display_order: Number(values.display_order),
                        start_date: isoStartDate,
                        end_date: isoEndDate,
                        link_url: values.link_url || null,
                        created_by: userId,
                    },
                ]);

            if (error) {
                throw error;
            }

            dismissToast(toastId);
            showSuccess(`Banner promocional "${values.headline}" criado com sucesso!`);
            form.reset(); // Clear form
            navigate('/admin/banners'); // Redirect to banner list

        } catch (error: any) {
            dismissToast(toastId);
            console.error("Erro ao criar banner promocional:", error);
            showError(`Falha ao criar banner: ${error.message || 'Erro desconhecido'}`);
        } finally {
            setIsSaving(false);
        }
    };
    
    // Aguardar userId (definido de forma assíncrona) e carregamento do perfil antes de checar permissão
    if (!userId || isLoadingProfile) {
        return (
            <div className="max-w-4xl mx-auto px-4 sm:px-0 text-center py-20">
                <Loader2 className="h-10 w-10 animate-spin text-yellow-500 mx-auto mb-4" />
                <p className="text-gray-400">Verificando permissões...</p>
            </div>
        );
    }

    const isAdminMaster = Number(profile?.tipo_usuario_id) === ADMIN_MASTER_USER_TYPE_ID;
    if (!isAdminMaster) {
        showError("Acesso negado. Você não tem permissão de Administrador Master.");
        navigate('/manager/dashboard');
        return null;
    }


    return (
        <div className="max-w-4xl mx-auto px-4 sm:px-0">
            <div className="flex items-center justify-between mb-8">
                <h1 className="text-2xl sm:text-3xl font-serif text-yellow-500 mb-4 sm:mb-0">Criar Banner Promocional</h1>
                <Button 
                    onClick={() => navigate('/admin/banners')}
                    variant="outline"
                    className="bg-black/60 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 text-sm"
                >
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Voltar para a Lista
                </Button>
            </div>

            <Card className="bg-black border border-yellow-500/30 rounded-2xl shadow-2xl shadow-yellow-500/10">
                <CardHeader>
                    <CardTitle className="text-white text-xl sm:text-2xl font-semibold">Detalhes do Banner</CardTitle>
                    <CardDescription className="text-gray-400 text-sm">
                        Crie um banner de destaque para a página inicial, independente de um evento específico.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <Form {...form}>
                        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                            
                            {/* Imagem/Banner com ImageUploadPicker */}
                            <div className="space-y-4 pt-4 border-t border-yellow-500/20">
                                <h3 className="text-xl font-semibold text-white">Imagem do Banner *</h3>
                                {userId && (
                                    <ImageUploadPicker
                                        userId={userId}
                                        currentImageUrl={form.watch('image_url')}
                                        onImageUpload={handleImageUpload}
                                        width={600} // ALTERADO: 600px de largura
                                        height={400} // ALTERADO: 400px de altura
                                        placeholderText="Clique para enviar ou arraste e solte uma imagem (600px de largura por 400px de altura)"
                                        bucketName="promotional-banners" // Novo bucket para banners promocionais
                                        folderPath="banners"
                                        maxFileSizeMB={5}
                                        isInvalid={!!form.formState.errors.image_url}
                                        disabled={isSaving}
                                    />
                                )}
                                {form.formState.errors.image_url && <p className="text-red-500 text-xs mt-1">{form.formState.errors.image_url.message}</p>}
                            </div>

                            {/* Título e Subtítulo */}
                            <FormField
                                control={form.control}
                                name="headline"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel className="text-white flex items-center">
                                            <Heading className="h-4 w-4 mr-2 text-yellow-500" />
                                            Título do Banner *
                                        </FormLabel>
                                        <FormControl>
                                            <Input 
                                                placeholder="Título chamativo para o banner"
                                                {...field} 
                                                className={`bg-black/60 border-yellow-500/30 text-white placeholder-gray-500 focus:border-yellow-500 ${form.formState.errors.headline ? 'border-red-500' : ''}`}
                                                disabled={isSaving}
                                            />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            <FormField
                                control={form.control}
                                name="subheadline"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel className="text-white flex items-center">
                                            <Subtitles className="h-4 w-4 mr-2 text-yellow-500" />
                                            Subtítulo do Banner *
                                        </FormLabel>
                                        <FormControl>
                                            <Textarea 
                                                placeholder="Descrição curta para o banner"
                                                {...field} 
                                                className={`bg-black/60 border-yellow-500/30 text-white placeholder-gray-500 focus:border-yellow-500 min-h-[60px] ${form.formState.errors.subheadline ? 'border-red-500' : ''}`}
                                                disabled={isSaving}
                                            />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            {/* Ordem de Exibição, Início e Fim da Exibição */}
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                <FormField
                                    control={form.control}
                                    name="display_order"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel className="text-white flex items-center">
                                                <ListOrdered className="h-4 w-4 mr-2 text-yellow-500" />
                                                Ordem de Exibição *
                                            </FormLabel>
                                            <FormControl>
                                                <Input 
                                                    type="number"
                                                    placeholder="0"
                                                    {...field} 
                                                    onChange={e => field.onChange(e.target.value === '' ? '' : Number(e.target.value))}
                                                    className={`bg-black/60 border-yellow-500/30 text-white placeholder-gray-500 focus:border-yellow-500 ${form.formState.errors.display_order ? 'border-red-500' : ''}`}
                                                    min="0"
                                                    disabled={isSaving}
                                                />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={form.control}
                                    name="start_date"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel className="text-white flex items-center">
                                                <CalendarDays className="h-4 w-4 mr-2 text-yellow-500" />
                                                Início Exibição *
                                            </FormLabel>
                                            <FormControl>
                                                <DatePicker 
                                                    date={field.value || undefined}
                                                    setDate={field.onChange}
                                                    placeholder="DD/MM/AAAA"
                                                    disabled={isSaving}
                                                />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={form.control}
                                    name="end_date"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel className="text-white flex items-center">
                                                <CalendarDays className="h-4 w-4 mr-2 text-yellow-500" />
                                                Fim Exibição *
                                            </FormLabel>
                                            <FormControl>
                                                <DatePicker 
                                                    date={field.value || undefined}
                                                    setDate={field.onChange}
                                                    placeholder="DD/MM/AAAA"
                                                    disabled={isSaving}
                                                />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                            </div>

                            {/* Link URL (Opcional) */}
                            <FormField
                                control={form.control}
                                name="link_url"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel className="text-white">URL de Link (Opcional)</FormLabel>
                                        <FormControl>
                                            <Input 
                                                placeholder="https://seulink.com"
                                                {...field} 
                                                className={`bg-black/60 border-yellow-500/30 text-white placeholder-gray-500 focus:border-yellow-500 ${form.formState.errors.link_url ? 'border-red-500' : ''}`}
                                                disabled={isSaving}
                                            />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            <div className="flex items-center space-x-4 pt-4">
                                <Button
                                    type="submit"
                                    disabled={isSaving}
                                    className="flex-1 bg-yellow-500 text-black hover:bg-yellow-600 py-3 text-lg font-semibold transition-all duration-300 cursor-pointer disabled:opacity-50"
                                >
                                    {isSaving ? (
                                        <div className="flex items-center justify-center">
                                            <Loader2 className="w-5 h-5 animate-spin mr-2" />
                                            Criando Banner...
                                        </div>
                                    ) : (
                                        <>
                                            <Save className="mr-2 h-5 w-5" />
                                            Criar Banner
                                        </>
                                    )}
                                </Button>
                                <Button
                                    type="button"
                                    onClick={() => navigate('/admin/banners')}
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
                </CardContent>
            </Card>
        </div>
    );
};

export default AdminCreatePromotionalBanner;