import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Loader2, Image, Edit, Trash2, ArrowLeft, CalendarDays, ListOrdered } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { showError, showSuccess, showLoading, dismissToast } from '@/utils/toast';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useProfile } from '@/hooks/use-profile'; // Importando useProfile

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
    // Admin Master tem RLS total, então buscamos todos os banners
    const { data, error } = await supabase
        .from('promotional_banners')
        .select('*')
        .order('display_order', { ascending: true })
        .order('start_date', { ascending: false });

    if (error) {
        console.error("Error fetching promotional banners:", error);
        throw new Error(error.message);
    }
    
    return data as PromotionalBanner[];
};

const usePromotionalBanners = () => {
    const queryClient = useQueryClient();
    const query = useQuery({
        queryKey: ['promotionalBanners'],
        queryFn: fetchPromotionalBanners,
        staleTime: 1000 * 60 * 1, // 1 minute
        onError: (error) => {
            console.error("Query Error: Failed to load promotional banners.", error);
            showError("Erro ao carregar a lista de banners promocionais.");
        }
    });

    return {
        ...query,
        banners: query.data || [],
        invalidateBanners: () => queryClient.invalidateQueries({ queryKey: ['promotionalBanners'] }),
    };
};

const DeleteBannerDialog: React.FC<{ banner: PromotionalBanner, onDeleteSuccess: () => void }> = ({ banner, onDeleteSuccess }) => {
    const [isDeleting, setIsDeleting] = useState(false);
    const [isDialogOpen, setIsDialogOpen] = useState(false);

    const handleDelete = async () => {
        setIsDeleting(true);
        const toastId = showLoading(`Excluindo banner "${banner.headline}"...`);

        try {
            const { error } = await supabase
                .from('promotional_banners')
                .delete()
                .eq('id', banner.id);

            if (error) {
                throw error;
            }

            dismissToast(toastId);
            showSuccess(`Banner excluído com sucesso.`);
            onDeleteSuccess();
            setIsDialogOpen(false);

        } catch (error: any) {
            dismissToast(toastId);
            console.error("Erro ao deletar banner:", error);
            showError(`Falha ao excluir banner: ${error.message || 'Erro desconhecido'}`);
        } finally {
            setIsDeleting(false);
        }
    };

    return (
        <AlertDialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
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
                        onClick={handleDelete} 
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
    const [userId, setUserId] = useState<string | undefined>(undefined);
    
    useEffect(() => {
        supabase.auth.getUser().then(({ data: { user } }) => {
            setUserId(user?.id);
        });
    }, []);
    
    const { profile, isLoading: isLoadingProfile } = useProfile(userId);
    const { banners, isLoading, isError, invalidateBanners } = usePromotionalBanners();

    const handleEditClick = (bannerId: string) => {
        navigate(`/admin/banners/edit/${bannerId}`);
    };

    if (isLoadingProfile || userId === undefined) {
        return (
            <div className="max-w-7xl mx-auto text-center py-20">
                <Loader2 className="h-8 w-8 animate-spin text-yellow-500 mx-auto mb-4" />
                <p className="text-gray-400">Verificando permissões...</p>
            </div>
        );
    }
    
    if (Number(profile?.tipo_usuario_id) !== ADMIN_MASTER_USER_TYPE_ID) {
        showError("Acesso negado. Você não tem permissão de Administrador Master.");
        navigate('/manager/dashboard');
        return null;
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
        return <div className="text-red-400 text-center py-10">Erro ao carregar banners. Tente recarregar a página.</div>;
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
                                    const startDate = new Date(banner.start_date);
                                    const endDate = new Date(banner.end_date);
                                    const today = new Date();
                                    
                                    let statusText = 'Inativo';
                                    let statusClasses = 'bg-gray-500/20 text-gray-400';

                                    if (startDate <= today && endDate >= today) {
                                        statusText = 'Ativo';
                                        statusClasses = 'bg-green-500/20 text-green-400';
                                    } else if (startDate > today) {
                                        statusText = 'Agendado';
                                        statusClasses = 'bg-yellow-500/20 text-yellow-400';
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
                                                    {startDate.toLocaleDateString('pt-BR')} - {endDate.toLocaleDateString('pt-BR')}
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