"use client";

import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { showSuccess, showError, showLoading, dismissToast } from '@/utils/toast';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, Image, CalendarDays, ListOrdered, Heading, Subtitles, ArrowLeft, Save, Calendar } from 'lucide-react';
import { format } from 'date-fns';
import { parseEventLocalDay } from '@/utils/format-event-date';
import { DatePicker } from '@/components/DatePicker';
import ImageUploadPicker from '@/components/ImageUploadPicker';
import { useProfile } from '@/hooks/use-profile';
import { useManagerEvents, ManagerEvent } from '@/hooks/use-manager-events';
import { useQueryClient } from '@tanstack/react-query';

// Zod schema for event banner validation
const eventBannerSchema = z.object({
    event_id: z.string().min(1, "Selecione um evento."),
    image_url: z.string().url("URL da Imagem/Banner é obrigatória e deve ser uma URL válida."),
    headline: z.string().min(1, "Título é obrigatório."),
    subheadline: z.string().min(1, "Subtítulo é obrigatório."),
    display_order: z.union([z.number().min(0, "Ordem de Exibição deve ser 0 ou maior."), z.literal('')]).transform(e => e === '' ? 0 : Number(e)),
    start_date: z.date({ required_error: "Data de Início é obrigatória." }),
    end_date: z.date({ required_error: "Data de Fim é obrigatória." }),
});

type EventBannerFormData = z.infer<typeof eventBannerSchema>;

const ManagerCreateEventBanner: React.FC = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const queryClient = useQueryClient();
    const [isSaving, setIsSaving] = useState(false);
    const [userId, setUserId] = useState<string | null>(null);

    useEffect(() => {
        supabase.auth.getUser().then(({ data: { user } }) => {
            setUserId(user?.id || null);
        });
    }, []);
    
    const { profile, isLoading: isLoadingProfile } = useProfile(userId || undefined);
    const isAdminMaster = profile?.tipo_usuario_id === 1;
    
    // Busca eventos do gestor (ou todos se for Admin Master)
    const { events, isLoading: isLoadingEvents } = useManagerEvents(userId, isAdminMaster);

    const form = useForm<EventBannerFormData>({
        resolver: zodResolver(eventBannerSchema),
        defaultValues: {
            event_id: location.state?.eventId || '', // Pré-seleciona se vier da criação do evento
            image_url: '',
            headline: '',
            subheadline: '',
            display_order: 0,
            start_date: undefined,
            end_date: undefined,
        },
    });
    
    // Preenche Título, Subtítulo e URL da Imagem automaticamente ao selecionar o evento
    useEffect(() => {
        const selectedEventId = form.watch('event_id');
        if (selectedEventId && events.length > 0) {
            const selectedEvent = events.find(e => e.id === selectedEventId);
            if (selectedEvent) {
                // Busca detalhes completos do evento (incluindo URLs de imagem)
                supabase.from('events').select('title, description, date, image_url').eq('id', selectedEventId).single().then(({ data, error }) => {
                    if (error || !data) {
                        console.error("Failed to fetch event details for banner autofill:", error);
                        return;
                    }
                    
                    // 1. Preenche Título e Subtítulo
                    form.setValue('headline', data.title, { shouldValidate: true });
                    form.setValue('subheadline', data.description?.substring(0, 100) || 'Destaque do evento no carrossel.', { shouldValidate: true });
                    
                    // 2. Preenche URL da Imagem do Carrossel (image_url é o campo 770x450)
                    if (data.image_url) {
                        form.setValue('image_url', data.image_url, { shouldValidate: true });
                    } else {
                        form.setValue('image_url', '', { shouldValidate: true });
                        showError("A imagem do carrossel (770x450) não foi encontrada no evento. Por favor, faça o upload.");
                    }
                    
                    // 3. Define a data de início como a data do evento por padrão
                    if (data.date) {
                        const eventDay = parseEventLocalDay(data.date);
                        if (eventDay) {
                            form.setValue('start_date', eventDay, { shouldValidate: true });
                            form.setValue('end_date', eventDay, { shouldValidate: true });
                        }
                    }
                });
            }
        }
    }, [form.watch('event_id'), events]);


    const handleImageUpload = (url: string) => {
        form.setValue('image_url', url, { shouldValidate: true });
    };

    const onSubmit = async (values: EventBannerFormData) => {
        if (!userId || isLoadingProfile) {
            showError("Sessão inválida. Tente fazer login novamente.");
            return;
        }

        setIsSaving(true);
        const toastId = showLoading("Criando banner de evento...");

        const isoStartDate = values.start_date ? format(values.start_date, 'yyyy-MM-dd') : null;
        const isoEndDate = values.end_date ? format(values.end_date, 'yyyy-MM-dd') : null;

        try {
            const { error } = await supabase
                .from('event_carousel_banners')
                .insert([
                    {
                        event_id: values.event_id,
                        image_url: values.image_url,
                        headline: values.headline,
                        subheadline: values.subheadline,
                        display_order: Number(values.display_order),
                        start_date: isoStartDate,
                        end_date: isoEndDate,
                        created_by: userId,
                    },
                ]);

            if (error) {
                throw error;
            }

            dismissToast(toastId);
            showSuccess(`Banner para o evento "${values.headline}" criado com sucesso!`);
            form.reset(); // Clear form
            queryClient.invalidateQueries({ queryKey: ['carouselBanners'] }); // Invalida o cache do carrossel
            navigate('/manager/events'); // Redireciona para a lista de eventos

        } catch (error: any) {
            dismissToast(toastId);
            console.error("Erro ao criar banner de evento:", error);
            showError(`Falha ao criar banner: ${error.message || 'Erro desconhecido'}`);
        } finally {
            setIsSaving(false);
        }
    };
    
    if (isLoadingProfile || isLoadingEvents) {
        return (
            <div className="max-w-4xl mx-auto px-4 sm:px-0 text-center py-20">
                <Loader2 className="h-10 w-10 animate-spin text-yellow-500 mx-auto mb-4" />
                <p className="text-gray-400">Carregando dados...</p>
            </div>
        );
    }

    return (
        <div className="max-w-4xl mx-auto px-4 sm:px-0">
            <div className="flex items-center justify-between mb-8">
                <h1 className="text-2xl sm:text-3xl font-serif text-yellow-500 mb-4 sm:mb-0">Criar Banner de Evento</h1>
                <Button 
                    onClick={() => navigate('/manager/events')}
                    variant="outline"
                    className="bg-black/60 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 text-sm"
                >
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Voltar para Eventos
                </Button>
            </div>

            <Card className="bg-black border border-yellow-500/30 rounded-2xl shadow-2xl shadow-yellow-500/10">
                <CardHeader>
                    <CardTitle className="text-white text-xl sm:text-2xl font-semibold">Associação e Conteúdo</CardTitle>
                    <CardDescription className="text-gray-400 text-sm">
                        Crie um banner de destaque para o carrossel da página inicial, vinculado a um evento específico.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <Form {...form}>
                        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                            
                            {/* Evento Associado */}
                            <FormField
                                control={form.control}
                                name="event_id"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel className="text-white flex items-center">
                                            <Calendar className="h-4 w-4 mr-2 text-yellow-500" />
                                            Evento *
                                        </FormLabel>
                                        <Select onValueChange={field.onChange} value={field.value} disabled={isSaving}>
                                            <FormControl>
                                                <SelectTrigger className={`w-full bg-black/60 border-yellow-500/30 text-white focus:ring-yellow-500 ${form.formState.errors.event_id ? 'border-red-500' : ''}`}>
                                                    <SelectValue placeholder="Selecione o Evento" />
                                                </SelectTrigger>
                                            </FormControl>
                                            <SelectContent className="bg-black border-yellow-500/30 text-white">
                                                {events.length === 0 ? (
                                                    <div className="py-2 px-3 text-sm text-gray-500">Nenhum evento publicado encontrado</div>
                                                ) : (
                                                    events.filter(e => !e.is_draft).map((event: ManagerEvent) => (
                                                        <SelectItem key={event.id} value={event.id} className="hover:bg-yellow-500/10 cursor-pointer">
                                                            {event.title}
                                                        </SelectItem>
                                                    ))
                                                )}
                                            </SelectContent>
                                        </Select>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            
                            {/* Imagem/Banner com ImageUploadPicker */}
                            <div className="space-y-4 pt-4 border-t border-yellow-500/20">
                                <h3 className="text-xl font-semibold text-white">Imagem do Banner *</h3>
                                <CardDescription className="text-gray-400 text-sm">
                                    A imagem será preenchida automaticamente com a imagem do carrossel (770x450) do evento selecionado.
                                </CardDescription>
                                {userId && (
                                    <ImageUploadPicker
                                        userId={userId}
                                        currentImageUrl={form.watch('image_url')}
                                        onImageUpload={handleImageUpload}
                                        width={770} 
                                        height={450} 
                                        placeholderText="Aguardando seleção do evento..."
                                        bucketName="event-banners" 
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
                                    onClick={() => navigate('/manager/events')}
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

export default ManagerCreateEventBanner;