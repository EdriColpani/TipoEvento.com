import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
    Plus,
    Loader2,
    Image,
    Edit,
    Trash2,
    ArrowLeft,
    CalendarDays,
    ListOrdered,
    StopCircle,
} from 'lucide-react';
import { usePageAuth } from '@/hooks/use-page-auth';
import { showError, showSuccess, showLoading, dismissToast } from '@/utils/toast';
import { restDelete, restPatch } from '@/utils/supabase-rest';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { useProfile } from '@/hooks/use-profile';
import {
    useManagerEventBanners,
    type ManagerEventCarouselBanner,
} from '@/hooks/use-manager-event-banners';
import {
    EVENT_CAROUSEL_BANNER_STATUS_LABELS,
    formatEventCarouselBannerError,
    getYesterdayIsoDate,
} from '@/utils/event-carousel-banner-rules';
import { parseEventLocalDay } from '@/utils/format-event-date';
import { format } from 'date-fns';

const STATUS_CLASSES: Record<string, string> = {
    active: 'bg-green-500/20 text-green-400',
    scheduled: 'bg-yellow-500/20 text-yellow-400',
    ended: 'bg-gray-500/20 text-gray-400',
};

const EndBannerDialog: React.FC<{
    banner: ManagerEventCarouselBanner;
    onSuccess: () => void;
}> = ({ banner, onSuccess }) => {
    const [isEnding, setIsEnding] = useState(false);

    const handleEnd = async () => {
        setIsEnding(true);
        const toastId = showLoading(`Encerrando exibição de "${banner.headline}"...`);
        try {
            await restPatch(`event_carousel_banners?id=eq.${banner.id}`, {
                end_date: getYesterdayIsoDate(),
            });
            dismissToast(toastId);
            showSuccess('Exibição do banner encerrada.');
            onSuccess();
        } catch (error: unknown) {
            dismissToast(toastId);
            console.error('Erro ao encerrar banner:', error);
            showError(formatEventCarouselBannerError(error));
        } finally {
            setIsEnding(false);
        }
    };

    return (
        <AlertDialog>
            <AlertDialogTrigger asChild>
                <Button
                    variant="outline"
                    size="sm"
                    className="bg-black/60 border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 hover:text-yellow-500 h-8 px-3"
                    title="Encerrar exibição"
                >
                    <StopCircle className="h-4 w-4" />
                </Button>
            </AlertDialogTrigger>
            <AlertDialogContent className="bg-black/90 border border-yellow-500/30 text-white">
                <AlertDialogHeader>
                    <AlertDialogTitle className="text-yellow-500">Encerrar exibição?</AlertDialogTitle>
                    <AlertDialogDescription className="text-gray-400">
                        O banner <span className="font-semibold text-white">"{banner.headline}"</span> deixará de
                        aparecer no carrossel. Você pode editar as datas depois ou excluir o banner para criar outro
                        no mesmo evento.
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel className="bg-black/60 border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10">
                        Cancelar
                    </AlertDialogCancel>
                    <AlertDialogAction
                        onClick={handleEnd}
                        className="bg-yellow-500 text-black hover:bg-yellow-600"
                        disabled={isEnding}
                    >
                        {isEnding ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Encerrar agora'}
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
};

const DeleteBannerDialog: React.FC<{
    banner: ManagerEventCarouselBanner;
    onSuccess: () => void;
}> = ({ banner, onSuccess }) => {
    const [isDeleting, setIsDeleting] = useState(false);

    const handleDelete = async () => {
        setIsDeleting(true);
        const toastId = showLoading(`Excluindo banner "${banner.headline}"...`);
        try {
            await restDelete(`event_carousel_banners?id=eq.${banner.id}`);
            dismissToast(toastId);
            showSuccess('Banner excluído. Você pode criar um novo banner para este evento.');
            onSuccess();
        } catch (error: unknown) {
            dismissToast(toastId);
            console.error('Erro ao excluir banner:', error);
            showError(formatEventCarouselBannerError(error));
        } finally {
            setIsDeleting(false);
        }
    };

    return (
        <AlertDialog>
            <AlertDialogTrigger asChild>
                <Button
                    variant="outline"
                    size="sm"
                    className="bg-black/60 border-red-500/30 text-red-400 hover:bg-red-500/10 h-8 px-3"
                    title="Excluir banner"
                >
                    <Trash2 className="h-4 w-4" />
                </Button>
            </AlertDialogTrigger>
            <AlertDialogContent className="bg-black/90 border border-red-500/30 text-white">
                <AlertDialogHeader>
                    <AlertDialogTitle className="text-red-400">Excluir banner?</AlertDialogTitle>
                    <AlertDialogDescription className="text-gray-400">
                        Esta ação não pode ser desfeita. O banner{' '}
                        <span className="font-semibold text-white">"{banner.headline}"</span> será removido
                        permanentemente.
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel className="bg-black/60 border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10">
                        Cancelar
                    </AlertDialogCancel>
                    <AlertDialogAction
                        onClick={handleDelete}
                        className="bg-red-600 text-white hover:bg-red-700"
                        disabled={isDeleting}
                    >
                        {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Excluir'}
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
};

const formatBannerDate = (iso: string) => {
    const day = parseEventLocalDay(iso);
    return day ? format(day, 'dd/MM/yyyy') : '—';
};

const ManagerEventBannersList: React.FC = () => {
    const navigate = useNavigate();
    const { userId, authPending } = usePageAuth();

    const { profile, isLoading: isLoadingProfile } = useProfile(userId);
    const isAdminMaster = profile?.tipo_usuario_id === 1;
    const { banners, isLoading, isError, invalidateBanners } = useManagerEventBanners(userId, isAdminMaster);

    const invalidateAll = () => {
        invalidateBanners();
    };

    if (authPending || (userId && isLoadingProfile)) {
        return (
            <div className="max-w-7xl mx-auto text-center py-20">
                <Loader2 className="h-8 w-8 animate-spin text-yellow-500 mx-auto mb-4" />
                <p className="text-gray-400">Carregando...</p>
            </div>
        );
    }

    if (isLoading) {
        return (
            <div className="max-w-7xl mx-auto text-center py-20">
                <Loader2 className="h-8 w-8 animate-spin text-yellow-500 mx-auto mb-4" />
                <p className="text-gray-400">Carregando banners de evento...</p>
            </div>
        );
    }

    if (isError) {
        return (
            <div className="text-red-400 text-center py-10">
                Erro ao carregar banners. Tente recarregar a página.
            </div>
        );
    }

    return (
        <div className="max-w-7xl mx-auto px-4 sm:px-0">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-8 gap-4">
                <h1 className="text-2xl sm:text-3xl font-serif text-yellow-500 flex items-center">
                    <Image className="h-7 w-7 mr-3" />
                    Banners de Evento ({banners.length})
                </h1>
                <div className="flex flex-wrap gap-3">
                    <Button
                        onClick={() => navigate('/manager/events/banners/create')}
                        className="bg-yellow-500 text-black hover:bg-yellow-600"
                    >
                        <Plus className="mr-2 h-5 w-5" />
                        Novo banner
                    </Button>
                    <Button
                        onClick={() => navigate('/manager/events')}
                        variant="outline"
                        className="bg-black/60 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10"
                    >
                        <ArrowLeft className="mr-2 h-4 w-4" />
                        Eventos
                    </Button>
                </div>
            </div>

            <Card className="bg-black border border-yellow-500/30 rounded-2xl shadow-2xl shadow-yellow-500/10 p-6">
                <p className="text-gray-400 text-sm mb-6">
                    Gerencie os banners do carrossel da página inicial. Cada evento permite apenas 1 banner — edite,
                    encerre a exibição ou exclua para cadastrar outro.
                </p>

                {banners.length === 0 ? (
                    <div className="text-center py-10">
                        <Image className="h-12 w-12 text-gray-600 mx-auto mb-4" />
                        <p className="text-gray-400 text-lg">Nenhum banner de evento cadastrado.</p>
                        <Button
                            className="mt-6 bg-yellow-500 text-black hover:bg-yellow-600"
                            onClick={() => navigate('/manager/events/banners/create')}
                        >
                            <Plus className="mr-2 h-4 w-4" />
                            Criar primeiro banner
                        </Button>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <Table className="w-full min-w-[900px]">
                            <TableHeader>
                                <TableRow className="border-b border-yellow-500/20 hover:bg-black/40">
                                    <TableHead className="text-gray-400 w-[28%]">Banner / Evento</TableHead>
                                    <TableHead className="text-center text-gray-400 w-[8%]">Ordem</TableHead>
                                    <TableHead className="text-center text-gray-400 w-[22%]">Período</TableHead>
                                    <TableHead className="text-center text-gray-400 w-[12%]">Status</TableHead>
                                    <TableHead className="text-right text-gray-400 w-[30%]">Ações</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {banners.map((banner) => (
                                    <TableRow
                                        key={banner.id}
                                        className="border-b border-yellow-500/10 hover:bg-black/40"
                                    >
                                        <TableCell
                                            className="py-4 cursor-pointer"
                                            onClick={() => navigate(`/manager/events/banners/edit/${banner.id}`)}
                                        >
                                            <div className="text-white font-medium truncate max-w-[240px]">
                                                {banner.headline}
                                            </div>
                                            <div className="text-gray-500 text-xs truncate max-w-[240px]">
                                                {banner.event_title}
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-center py-4 text-yellow-500">
                                            <span className="inline-flex items-center">
                                                <ListOrdered className="h-4 w-4 mr-1" />
                                                {banner.display_order}
                                            </span>
                                        </TableCell>
                                        <TableCell className="text-center py-4 text-gray-300 text-xs">
                                            <span className="inline-flex items-center justify-center">
                                                <CalendarDays className="h-4 w-4 mr-1 text-yellow-500" />
                                                {formatBannerDate(banner.start_date)} –{' '}
                                                {formatBannerDate(banner.end_date)}
                                            </span>
                                        </TableCell>
                                        <TableCell className="text-center py-4">
                                            <span
                                                className={`px-3 py-1 rounded-full text-xs font-semibold ${STATUS_CLASSES[banner.status]}`}
                                            >
                                                {EVENT_CAROUSEL_BANNER_STATUS_LABELS[banner.status]}
                                            </span>
                                        </TableCell>
                                        <TableCell className="text-right py-4">
                                            <div className="flex items-center justify-end gap-2">
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    className="bg-black/60 border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 h-8 px-3"
                                                    onClick={() =>
                                                        navigate(`/manager/events/banners/edit/${banner.id}`)
                                                    }
                                                >
                                                    <Edit className="h-4 w-4" />
                                                </Button>
                                                {banner.status !== 'ended' && (
                                                    <EndBannerDialog banner={banner} onSuccess={invalidateAll} />
                                                )}
                                                <DeleteBannerDialog banner={banner} onSuccess={invalidateAll} />
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                )}
            </Card>
        </div>
    );
};

export default ManagerEventBannersList;
