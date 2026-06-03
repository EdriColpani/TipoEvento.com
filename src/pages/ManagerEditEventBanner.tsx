"use client";

import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { showSuccess, showError, showLoading, dismissToast } from '@/utils/toast';
import { supabase } from '@/integrations/supabase/client';
import {
    Loader2,
    CalendarDays,
    ListOrdered,
    Heading,
    Subtitles,
    ArrowLeft,
    Save,
    Calendar,
    StopCircle,
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { DatePicker } from '@/components/DatePicker';
import ImageUploadPicker from '@/components/ImageUploadPicker';
import { useQueryClient } from '@tanstack/react-query';
import { useProfile } from '@/hooks/use-profile';
import {
    formatEventCarouselBannerError,
    getYesterdayIsoDate,
} from '@/utils/event-carousel-banner-rules';
import { MANAGER_EVENT_BANNERS_QUERY_KEY } from '@/hooks/use-manager-event-banners';

const eventBannerEditSchema = z.object({
    image_url: z.string().url('URL da imagem é obrigatória e deve ser válida.'),
    headline: z.string().min(1, 'Título é obrigatório.'),
    subheadline: z.string().min(1, 'Subtítulo é obrigatório.'),
    display_order: z
        .union([z.number().min(0, 'Ordem deve ser 0 ou maior.'), z.literal('')])
        .transform((e) => (e === '' ? 0 : Number(e))),
    start_date: z.date({ required_error: 'Data de início é obrigatória.' }),
    end_date: z.date({ required_error: 'Data de fim é obrigatória.' }),
});

type EventBannerEditFormData = z.infer<typeof eventBannerEditSchema>;

const ManagerEditEventBanner: React.FC = () => {
    const navigate = useNavigate();
    const { id } = useParams<{ id: string }>();
    const queryClient = useQueryClient();
    const [isSaving, setIsSaving] = useState(false);
    const [isFetching, setIsFetching] = useState(true);
    const [userId, setUserId] = useState<string | null>(null);
    const [eventTitle, setEventTitle] = useState('');

    const form = useForm<EventBannerEditFormData>({
        resolver: zodResolver(eventBannerEditSchema),
        defaultValues: {
            image_url: '',
            headline: '',
            subheadline: '',
            display_order: 0,
            start_date: undefined,
            end_date: undefined,
        },
    });

    const { profile, isLoading: isLoadingProfile } = useProfile(userId || undefined);
    const isAdminMaster = profile?.tipo_usuario_id === 1;

    useEffect(() => {
        supabase.auth.getUser().then(({ data: { user } }) => setUserId(user?.id ?? null));
    }, []);

    useEffect(() => {
        const load = async () => {
            if (!id || !userId || isLoadingProfile) return;

            const { data, error } = await supabase
                .from('event_carousel_banners')
                .select(
                    `
                    id,
                    image_url,
                    headline,
                    subheadline,
                    display_order,
                    start_date,
                    end_date,
                    events ( title, created_by )
                `,
                )
                .eq('id', id)
                .single();

            if (error || !data) {
                showError('Banner não encontrado ou sem permissão.');
                navigate('/manager/events/banners');
                return;
            }

            const eventRow = data.events as { title?: string; created_by?: string | null } | null;

            if (!isAdminMaster && eventRow?.created_by !== userId) {
                showError('Você não tem permissão para editar este banner.');
                navigate('/manager/events/banners');
                return;
            }

            setEventTitle(eventRow?.title || 'Evento');
            form.reset({
                image_url: data.image_url || '',
                headline: data.headline || '',
                subheadline: data.subheadline || '',
                display_order: data.display_order ?? 0,
                start_date: data.start_date ? parseISO(String(data.start_date).slice(0, 10)) : undefined,
                end_date: data.end_date ? parseISO(String(data.end_date).slice(0, 10)) : undefined,
            });
            setIsFetching(false);
        };

        void load();
    }, [id, userId, isLoadingProfile, isAdminMaster, navigate, form]);

    const handleImageUpload = (url: string) => {
        form.setValue('image_url', url, { shouldValidate: true });
    };

    const invalidateCaches = () => {
        queryClient.invalidateQueries({ queryKey: [MANAGER_EVENT_BANNERS_QUERY_KEY] });
        queryClient.invalidateQueries({ queryKey: ['carouselBanners'] });
    };

    const onSubmit = async (values: EventBannerEditFormData) => {
        if (!userId || !id) {
            showError('Sessão inválida.');
            return;
        }

        setIsSaving(true);
        const toastId = showLoading('Salvando alterações...');

        try {
            const { error } = await supabase
                .from('event_carousel_banners')
                .update({
                    image_url: values.image_url,
                    headline: values.headline,
                    subheadline: values.subheadline,
                    display_order: Number(values.display_order),
                    start_date: format(values.start_date, 'yyyy-MM-dd'),
                    end_date: format(values.end_date, 'yyyy-MM-dd'),
                })
                .eq('id', id);

            if (error) throw error;

            dismissToast(toastId);
            showSuccess(`Banner "${values.headline}" atualizado.`);
            invalidateCaches();
            navigate('/manager/events/banners');
        } catch (error: unknown) {
            dismissToast(toastId);
            console.error('Erro ao atualizar banner:', error);
            showError(formatEventCarouselBannerError(error));
        } finally {
            setIsSaving(false);
        }
    };

    const handleEndNow = async () => {
        if (!id) return;
        setIsSaving(true);
        const toastId = showLoading('Encerrando exibição...');
        try {
            const { error } = await supabase
                .from('event_carousel_banners')
                .update({ end_date: getYesterdayIsoDate() })
                .eq('id', id);
            if (error) throw error;
            dismissToast(toastId);
            showSuccess('Exibição encerrada.');
            invalidateCaches();
            navigate('/manager/events/banners');
        } catch (error: unknown) {
            dismissToast(toastId);
            showError(formatEventCarouselBannerError(error));
        } finally {
            setIsSaving(false);
        }
    };

    if (!userId || isFetching || isLoadingProfile) {
        return (
            <div className="max-w-4xl mx-auto px-4 sm:px-0 text-center py-20">
                <Loader2 className="h-10 w-10 animate-spin text-yellow-500 mx-auto mb-4" />
                <p className="text-gray-400">Carregando banner...</p>
            </div>
        );
    }

    return (
        <div className="max-w-4xl mx-auto px-4 sm:px-0">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-8 gap-4">
                <h1 className="text-2xl sm:text-3xl font-serif text-yellow-500">Editar banner de evento</h1>
                <Button
                    onClick={() => navigate('/manager/events/banners')}
                    variant="outline"
                    className="bg-black/60 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10"
                >
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Voltar à lista
                </Button>
            </div>

            <Card className="bg-black border border-yellow-500/30 rounded-2xl shadow-2xl shadow-yellow-500/10">
                <CardHeader>
                    <CardTitle className="text-white text-xl font-semibold">Evento vinculado</CardTitle>
                    <CardDescription className="text-gray-400 text-sm flex items-center gap-2">
                        <Calendar className="h-4 w-4 text-yellow-500" />
                        {eventTitle}
                        <span className="text-gray-600">— o evento não pode ser alterado após a criação.</span>
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <Form {...form}>
                        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                            <div className="space-y-4 border-t border-yellow-500/20 pt-4">
                                <h3 className="text-xl font-semibold text-white">Imagem do banner *</h3>
                                {userId && (
                                    <ImageUploadPicker
                                        userId={userId}
                                        currentImageUrl={form.watch('image_url')}
                                        onImageUpload={handleImageUpload}
                                        width={770}
                                        height={450}
                                        placeholderText="Imagem 770×450"
                                        bucketName="event-banners"
                                        folderPath="banners"
                                        maxFileSizeMB={5}
                                        isInvalid={!!form.formState.errors.image_url}
                                        disabled={isSaving}
                                    />
                                )}
                                {form.formState.errors.image_url && (
                                    <p className="text-red-500 text-xs">{form.formState.errors.image_url.message}</p>
                                )}
                            </div>

                            <FormField
                                control={form.control}
                                name="headline"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel className="text-white flex items-center">
                                            <Heading className="h-4 w-4 mr-2 text-yellow-500" />
                                            Título *
                                        </FormLabel>
                                        <FormControl>
                                            <Input
                                                {...field}
                                                disabled={isSaving}
                                                className="bg-black/60 border-yellow-500/30 text-white"
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
                                            Subtítulo *
                                        </FormLabel>
                                        <FormControl>
                                            <Textarea
                                                {...field}
                                                disabled={isSaving}
                                                className="bg-black/60 border-yellow-500/30 text-white min-h-[60px]"
                                            />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                <FormField
                                    control={form.control}
                                    name="display_order"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel className="text-white flex items-center">
                                                <ListOrdered className="h-4 w-4 mr-2 text-yellow-500" />
                                                Ordem *
                                            </FormLabel>
                                            <FormControl>
                                                <Input
                                                    type="number"
                                                    min={0}
                                                    {...field}
                                                    onChange={(e) =>
                                                        field.onChange(e.target.value === '' ? '' : Number(e.target.value))
                                                    }
                                                    disabled={isSaving}
                                                    className="bg-black/60 border-yellow-500/30 text-white"
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
                                                Início *
                                            </FormLabel>
                                            <FormControl>
                                                <DatePicker
                                                    date={field.value}
                                                    setDate={field.onChange}
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
                                                Fim *
                                            </FormLabel>
                                            <FormControl>
                                                <DatePicker
                                                    date={field.value}
                                                    setDate={field.onChange}
                                                    disabled={isSaving}
                                                />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                            </div>

                            <div className="flex flex-col sm:flex-row gap-3 pt-4">
                                <Button
                                    type="submit"
                                    disabled={isSaving}
                                    className="flex-1 bg-yellow-500 text-black hover:bg-yellow-600 py-3 text-base font-semibold transition-all duration-300"
                                >
                                    {isSaving ? (
                                        <Loader2 className="h-5 w-5 animate-spin" />
                                    ) : (
                                        <>
                                            <Save className="mr-2 h-5 w-5" />
                                            Salvar alterações
                                        </>
                                    )}
                                </Button>
                                <Button
                                    type="button"
                                    variant="outline"
                                    disabled={isSaving}
                                    onClick={handleEndNow}
                                    className="flex-1 bg-black/60 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 hover:text-yellow-500 py-3 text-lg font-semibold transition-all duration-300"
                                >
                                    <StopCircle className="mr-2 h-5 w-5 shrink-0" />
                                    Encerrar exibição agora
                                </Button>
                            </div>
                        </form>
                    </Form>
                </CardContent>
            </Card>
        </div>
    );
};

export default ManagerEditEventBanner;
