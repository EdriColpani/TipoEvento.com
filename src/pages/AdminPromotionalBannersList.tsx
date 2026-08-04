import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Loader2, Image, Edit, Trash2, ArrowLeft, CalendarDays, ListOrdered } from 'lucide-react';
import { usePageAuth } from '@/hooks/use-page-auth';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { showError, showSuccess, showLoading, dismissToast } from '@/utils/toast';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { useProfile } from '@/hooks/use-profile';
import { restDelete, restGet } from '@/utils/supabase-rest';

interface PromotionalBanner {
    id: string;
    image_url: string;
    headline: string;
    subheadline: string;
    display_order: number;
    start_date: string;
    end_date: string;
    link_url: string | null;
    created_at: string;
}

const fetchPromotionalBanners = async (): Promise<PromotionalBanner[]> => {
    const rows = await restGet<PromotionalBanner[]>(
        'promotional_banners?select=*&order=display_order.asc,start_date.desc',
        15_000,
    );
    return Array.isArray(rows) ? rows : [];
};

const usePromotionalBanners = () => {
    const queryClient = useQueryClient();
    const query = useQuery({
        queryKey: ['promotionalBanners'],
        queryFn: fetchPromotionalBanners,
        staleTime: 1000 * 60 * 1,
        retry: 1,
        refetchOnWindowFocus: false,
    });

    return {
        ...query,
        banners: query.data || [],
        invalidateBanners: () => queryClient.invalidateQueries({ queryKey: ['promotionalBanners'] }),
    };
};

const DeleteBannerDialog: React.FC<{ banner: PromotionalBanner, onDeleteSuccess: () => void }> = ({ banner, onDeleteSuccess }) => {
    const [isDeleting, setIsDeleting] = useState(false);

    const handleDelete = async () => {
        setIsDeleting(true);
        const toastId = showLoading(`Excluindo banner "${banner.headline}"...`);

        try {
            await restDelete(
                `promotional_banners?id=eq.${encodeURIComponent(banner.id)}`,
                15_000,
            );

            dismissToast(toastId);
            showSuccess(`Banner excluído com sucesso.`);
            onDeleteSuccess();
        } catch (error: unknown) {
            dismissToast(toastId);
            console.error("Erro ao deletar banner:", error);
            showError(
                `Falha ao excluir banner: ${error instanceof Error ? error.message : 'Erro desconhecido'}`,
            );
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
                    className="bg-black/60 border border-red-500/40 text-red-400 hover:bg-red-500/10"
                >
                    <Trash2 className="h-4 w-4" />
                </Button>
            </AlertDialogTrigger>
            <AlertDialogContent className="bg-black/90 border border-red-500/30 text-white">
                <AlertDialogHeader>
                    <AlertDialogTitle className="text-red-400">Tem certeza absoluta?</AlertDialogTitle>
                    <AlertDialogDescription className="text-gray-400">
                        Esta ação não pode ser desfeita. Isso excluirá permanentemente o banner
                        <span className="font-semibold text-white"> "{banner.headline}" </span>.
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel className="bg-black/60 border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10">
                        Cancelar
                    </AlertDialogCancel>
                    <AlertDialogAction
                        onClick={(e) => {
                            e.preventDefault();
                            void handleDelete();
                        }}
                        className="bg-red-600 text-white hover:bg-red-700"
                        disabled={isDeleting}
                    >
                        {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Excluir Banner'}
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
};

const ADMIN_MASTER_USER_TYPE_ID = 1;

const AdminPromotionalBannersList: React.FC = () => {
    const navigate = useNavigate();
    const { userId, authPending } = usePageAuth();

    const { profile, isLoading: isLoadingProfile } = useProfile(userId);
    const { banners, isLoading, isError, error, invalidateBanners } = usePromotionalBanners();

    const handleEditClick = (bannerId: string) => {
        navigate(`/admin/banners/edit/${bannerId}`);
    };

    if (authPending || (userId && isLoadingProfile && !profile)) {
        return (
            <div className="max-w-7xl mx-auto text-center py-20">
                <Loader2 className="h-8 w-8 animate-spin text-yellow-500 mx-auto mb-4" />
                <p className="text-gray-400">Verificando permissões...</p>
            </div>
        );
    }

    if (Number(profile?.tipo_usuario_id) !== ADMIN_MASTER_USER_TYPE_ID) {
        return (
            <div className="max-w-7xl mx-auto text-center py-20">
                <p className="text-gray-400 mb-4">Acesso negado. Apenas Admin Master.</p>
                <Button
                    type="button"
                    variant="outline"
                    className="bg-black/60 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10"
                    onClick={() => navigate('/manager/dashboard')}
                >
                    Voltar ao Dashboard
                </Button>
            </div>
        );
    }

    if (isLoading) {
        return (
            <div className="max-w-7xl mx-auto text-center py-20">
                <Loader2 className="h-8 w-8 animate-spin text-yellow-500 mx-auto mb-4" />
                <p className="text-gray-400">Carregando banners promocionais...</p>
            </div>
        );
    }

    if (isError) {
        return (
            <div className="max-w-7xl mx-auto text-center py-10 space-y-3">
                <p className="text-red-400">
                    Erro ao carregar banners
                    {error instanceof Error ? `: ${error.message}` : '. Tente recarregar a página.'}
                </p>
                <Button
                    type="button"
                    className="bg-yellow-500 text-black hover:bg-yellow-600"
                    onClick={() => void invalidateBanners()}
                >
                    Tentar novamente
                </Button>
            </div>
        );
    }

    return (
        <div className="max-w-7xl mx-auto">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-8">
                <h1 className="text-2xl sm:text-3xl font-serif text-yellow-500 mb-4 sm:mb-0 flex items-center">
                    <Image className="h-7 w-7 mr-3" />
                    Banners Promocionais ({banners.length})
                </h1>
                <div className="flex space-x-3">
                    <Button 
                        onClick={() => navigate('/admin/banners/create')}
                        className="bg-yellow-500 text-black hover:bg-yellow-600 py-3 text-base font-semibold transition-all duration-300 cursor-pointer"
                    >
                        <Plus className="mr-2 h-5 w-5" />
                        Criar Novo Banner
                    </Button>
                    <Button 
                        onClick={() => navigate('/admin/dashboard')}
                        variant="outline"
                        className="bg-black/60 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 text-sm"
                    >
                        <ArrowLeft className="mr-2 h-4 w-4" />
                        Voltar
                    </Button>
                </div>
            </div>

            <Card className="bg-black border border-yellow-500/30 rounded-2xl shadow-2xl shadow-yellow-500/10 p-6">
                {banners.length === 0 ? (
                    <div className="text-center py-10">
                        <Image className="h-12 w-12 text-gray-600 mx-auto mb-4" />
                        <p className="text-gray-400 text-lg">Nenhum banner promocional cadastrado.</p>
                        <p className="text-gray-500 text-sm mt-2">Crie banners para destacar promoções na página inicial.</p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <Table className="w-full min-w-[800px]">
                            <TableHeader>
                                <TableRow className="border-b border-yellow-500/20 text-sm hover:bg-black/40">
                                    <TableHead className="text-left text-gray-400 font-semibold py-3 w-[30%]">Título</TableHead>
                                    <TableHead className="text-center text-gray-400 font-semibold py-3 w-[10%]">Ordem</TableHead>
                                    <TableHead className="text-center text-gray-400 font-semibold py-3 w-[25%]">Período</TableHead>
                                    <TableHead className="text-center text-gray-400 font-semibold py-3 w-[15%]">Status</TableHead>
                                    <TableHead className="text-right text-gray-400 font-semibold py-3 w-[20%]">Ações</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {banners.map((banner) => {
                                    const todayIso = new Date().toISOString().slice(0, 10);
                                    const startIso = String(banner.start_date).slice(0, 10);
                                    const endIso = String(banner.end_date).slice(0, 10);

                                    let statusText = 'Inativo';
                                    let statusClasses = 'bg-gray-500/20 text-gray-400';

                                    if (endIso < todayIso) {
                                        statusText = 'Inativo';
                                        statusClasses = 'bg-gray-500/20 text-gray-400';
                                    } else if (startIso > todayIso) {
                                        statusText = 'Agendado';
                                        statusClasses = 'bg-yellow-500/20 text-yellow-400';
                                    } else {
                                        statusText = 'Ativo';
                                        statusClasses = 'bg-green-500/20 text-green-400';
                                    }

                                    return (
                                        <TableRow 
                                            key={banner.id} 
                                            className="border-b border-yellow-500/10 hover:bg-black/40 transition-colors text-sm cursor-pointer"
                                        >
                                            <TableCell className="py-4" onClick={() => handleEditClick(banner.id)}>
                                                <div className="text-white font-medium truncate max-w-[250px]">{banner.headline}</div>
                                                <div className="text-gray-500 text-xs truncate max-w-[250px]">{banner.subheadline}</div>
                                            </TableCell>
                                            <TableCell className="text-center py-4">
                                                <div className="flex items-center justify-center text-yellow-500 font-semibold">
                                                    <ListOrdered className="h-4 w-4 mr-1" />
                                                    {banner.display_order}
                                                </div>
                                            </TableCell>
                                            <TableCell className="text-center py-4">
                                                <div className="text-gray-300 text-xs flex items-center justify-center">
                                                    <CalendarDays className="h-4 w-4 mr-1 text-yellow-500" />
                                                    {new Date(`${startIso}T12:00:00`).toLocaleDateString('pt-BR')} - {new Date(`${endIso}T12:00:00`).toLocaleDateString('pt-BR')}
                                                </div>
                                            </TableCell>
                                            <TableCell className="text-center py-4">
                                                <span className={`px-3 py-1 rounded-full text-xs font-semibold ${statusClasses}`}>
                                                    {statusText}
                                                </span>
                                            </TableCell>
                                            <TableCell className="text-right py-4 flex items-center justify-end space-x-2">
                                                <Button 
                                                    variant="outline" 
                                                    size="sm"
                                                    className="bg-black/60 border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 h-8 px-3"
                                                    onClick={() => handleEditClick(banner.id)}
                                                >
                                                    <Edit className="h-4 w-4" />
                                                </Button>
                                                <DeleteBannerDialog banner={banner} onDeleteSuccess={invalidateBanners} />
                                            </TableCell>
                                        </TableRow>
                                    );
                                })}
                            </TableBody>
                        </Table>
                    </div>
                )}
            </Card>
        </div>
    );
};

export default AdminPromotionalBannersList;