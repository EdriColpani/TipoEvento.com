"use client";

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Plus, Loader2, ArrowLeft, Percent, Hash, Edit, Trash2, AlertTriangle, Power, History } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { showSuccess, showError, showLoading, dismissToast } from '@/utils/toast';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import CommissionTierForm from '@/components/CommissionTierForm';
import { useProfile } from '@/hooks/use-profile';

interface CommissionRange {
    id: string;
    min_tickets: number;
    max_tickets: number;
    percentage: number;
    active: boolean;
    created_at: string;
    updated_at: string;
}

interface CommissionRangeHistory {
    id: string;
    commission_range_id: string;
    min_tickets: number;
    max_tickets: number;
    percentage: number;
    changed_at: string;
}

const ADMIN_MASTER_USER_TYPE_ID = 1;

const fetchCommissionRanges = async (): Promise<CommissionRange[]> => {
    try {
        // A RLS garante que apenas o Admin Master possa ler
        const { data, error } = await supabase
            .from('commission_ranges')
            .select('*')
            .order('min_tickets', { ascending: true }); // Ordena pelo mínimo de ingressos

        if (error) {
            console.error("Error fetching commission ranges:", error);
            // Se a tabela não existir, retorna array vazio ao invés de quebrar
            if (error.code === '42P01' || error.message.includes('does not exist')) {
                console.warn("Tabela commission_ranges não existe. Retornando array vazio.");
                return [];
            }
            throw new Error(error.message);
        }
        
        return (data || []) as CommissionRange[];
    } catch (error: any) {
        console.error("Erro inesperado ao buscar faixas:", error);
        // Retorna array vazio para não quebrar a página
        return [];
    }
};

const fetchCommissionRangesHistory = async (): Promise<CommissionRangeHistory[]> => {
    const { data, error } = await supabase
        .from('commission_ranges_history')
        .select('*')
        .order('changed_at', { ascending: false });

    if (error) {
        console.error("Error fetching commission ranges history:", error);
        throw new Error(error.message);
    }
    
    return data as CommissionRangeHistory[];
};

const useCommissionRanges = (isAdminMaster: boolean) => {
    const queryClient = useQueryClient();
    const query = useQuery({
        queryKey: ['commissionRanges'],
        queryFn: fetchCommissionRanges,
        enabled: isAdminMaster, // Só executa se for Admin Master
        staleTime: 1000 * 60 * 5, // 5 minutes
        onError: (error) => {
            console.error("Query Error: Failed to load commission ranges.", error);
            showError("Erro ao carregar as faixas de comissão.");
        }
    });

    return {
        ...query,
        ranges: query.data || [],
        invalidateRanges: () => queryClient.invalidateQueries({ queryKey: ['commissionRanges'] }),
    };
};

// Componente de Diálogo de Desativação/Ativação
const ToggleActiveDialog: React.FC<{ range: CommissionRange, onToggleSuccess: () => void }> = ({ range, onToggleSuccess }) => {
    const [isToggling, setIsToggling] = useState(false);
    const [isDialogOpen, setIsDialogOpen] = useState(false);

    const handleToggle = async () => {
        setIsToggling(true);
        const toastId = showLoading(`${range.active ? 'Desativando' : 'Ativando'} faixa...`);

        try {
            // Salva no histórico antes de desativar
            if (range.active) {
                await supabase
                    .from('commission_ranges_history')
                    .insert({
                        commission_range_id: range.id,
                        min_tickets: range.min_tickets,
                        max_tickets: range.max_tickets,
                        percentage: range.percentage,
                    });
            }

            const { error } = await supabase
                .from('commission_ranges')
                .update({ active: !range.active })
                .eq('id', range.id);

            if (error) {
                throw error;
            }

            dismissToast(toastId);
            showSuccess(`Faixa ${range.active ? 'desativada' : 'ativada'} com sucesso.`);
            onToggleSuccess();
            setIsDialogOpen(false);

        } catch (error: any) {
            dismissToast(toastId);
            console.error("Erro ao alterar status da faixa:", error);
            showError(`Falha ao ${range.active ? 'desativar' : 'ativar'} faixa: ${error.message || 'Erro desconhecido'}`);
        } finally {
            setIsToggling(false);
        }
    };

    return (
        <>
            <AlertDialogTrigger asChild>
                <Button 
                    variant="outline" 
                    size="sm"
                    className={`h-8 px-3 ${range.active ? 'bg-black/60 border-red-500/30 text-red-400 hover:bg-red-500/10' : 'bg-black/60 border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10'}`}
                >
                    <Power className="h-4 w-4" />
                </Button>
            </AlertDialogTrigger>
            <AlertDialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                <AlertDialogContent className="bg-black/90 border border-yellow-500/30 text-white">
                    <AlertDialogHeader>
                        <AlertDialogTitle className="text-yellow-400">
                            {range.active ? 'Desativar Faixa' : 'Ativar Faixa'}
                        </AlertDialogTitle>
                        <AlertDialogDescription className="text-gray-400">
                            {range.active ? (
                                <>
                                    Tem certeza que deseja desativar esta faixa? A faixa será salva no histórico e não será mais aplicada a novos eventos.
                                    <br /><br />
                                    Faixa: <span className="font-semibold text-white">{range.min_tickets.toLocaleString('pt-BR')} - {range.max_tickets === 999999 ? 'ou mais' : range.max_tickets.toLocaleString('pt-BR')} ingressos</span>
                                    <br />
                                    Taxa: <span className="font-semibold text-white">{range.percentage.toFixed(2).replace('.', ',')}%</span>
                                </>
                            ) : (
                                <>
                                    Tem certeza que deseja ativar esta faixa? Ela estará disponível para ser aplicada a novos eventos.
                                    <br /><br />
                                    Faixa: <span className="font-semibold text-white">{range.min_tickets.toLocaleString('pt-BR')} - {range.max_tickets === 999999 ? 'ou mais' : range.max_tickets.toLocaleString('pt-BR')} ingressos</span>
                                    <br />
                                    Taxa: <span className="font-semibold text-white">{range.percentage.toFixed(2).replace('.', ',')}%</span>
                                </>
                            )}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel className="bg-black/60 border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10">
                            Cancelar
                        </AlertDialogCancel>
                        <AlertDialogAction 
                            onClick={handleToggle} 
                            className={range.active ? "bg-red-600 text-white hover:bg-red-700" : "bg-yellow-500 text-black hover:bg-yellow-600"}
                            disabled={isToggling}
                        >
                            {isToggling ? <Loader2 className="h-4 w-4 animate-spin" /> : (range.active ? 'Desativar' : 'Ativar')}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    );
};


const AdminCommissionTiers: React.FC = () => {
    const navigate = useNavigate();
    const [userId, setUserId] = useState<string | undefined>(undefined);
    const [renderError, setRenderError] = useState<string | null>(null);
    const { profile, isLoading: isLoadingProfile } = useProfile(userId);
    const isAdminMaster = Number(profile?.tipo_usuario_id) === ADMIN_MASTER_USER_TYPE_ID;
    const { ranges, isLoading, isError, invalidateRanges } = useCommissionRanges(isAdminMaster);
    
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingRange, setEditingRange] = useState<CommissionRange | undefined>(undefined);
    const [showHistory, setShowHistory] = useState(false);
    const [history, setHistory] = useState<CommissionRangeHistory[]>([]);
    const [isLoadingHistory, setIsLoadingHistory] = useState(false);

        useEffect(() => {
            console.log('AdminCommissionTiers: Componente montado');
            supabase.auth.getUser().then(({ data: { user } }) => {
                console.log('AdminCommissionTiers: User ID:', user?.id);
                setUserId(user?.id);
            }).catch((error) => {
                console.error('AdminCommissionTiers: Erro ao buscar usuário:', error);
            });
        }, []);

        useEffect(() => {
            console.log('AdminCommissionTiers: Profile:', profile);
            console.log('AdminCommissionTiers: isAdminMaster:', isAdminMaster);
            console.log('AdminCommissionTiers: isLoading:', isLoading);
            console.log('AdminCommissionTiers: isError:', isError);
            console.log('AdminCommissionTiers: ranges:', ranges);
        }, [profile, isAdminMaster, isLoading, isError, ranges]);

    const handleOpenCreate = () => {
        setEditingRange(undefined);
        setIsModalOpen(true);
    };

    const handleOpenEdit = (range: CommissionRange) => {
        setEditingRange(range);
        setIsModalOpen(true);
    };

    const handleCloseModal = () => {
        setIsModalOpen(false);
        setEditingRange(undefined);
    };

    const handleToggleHistory = async () => {
        if (!showHistory) {
            setIsLoadingHistory(true);
            try {
                const historyData = await fetchCommissionRangesHistory();
                setHistory(historyData);
            } catch (error: any) {
                showError("Erro ao carregar histórico: " + (error.message || 'Erro desconhecido'));
            } finally {
                setIsLoadingHistory(false);
            }
        }
        setShowHistory(!showHistory);
    };


    // Se houver erro de renderização, mostra mensagem
    if (renderError) {
        return (
            <div className="max-w-7xl mx-auto text-center py-20">
                <AlertTriangle className="h-12 w-12 text-red-500 mx-auto mb-4" />
                <p className="text-red-400 text-lg font-semibold mb-2">Erro ao carregar a página</p>
                <p className="text-gray-400 text-sm mb-4">{renderError}</p>
                <Button 
                    onClick={() => {
                        setRenderError(null);
                        window.location.reload();
                    }}
                    className="bg-yellow-500 text-black hover:bg-yellow-600"
                >
                    Recarregar Página
                </Button>
            </div>
        );
    }

    if (isLoadingProfile || userId === undefined) {
        return (
            <div className="max-w-7xl mx-auto text-center py-20">
                <Loader2 className="h-8 w-8 animate-spin text-yellow-500 mx-auto mb-4" />
                <p className="text-gray-400">Verificando permissões...</p>
            </div>
        );
    }
    
    if (!isAdminMaster) {
        showError("Acesso negado. Você não tem permissão de Administrador Master.");
        navigate('/manager/dashboard');
        return null;
    }

    if (isLoading) {
        return (
            <div className="max-w-7xl mx-auto text-center py-20">
                <Loader2 className="h-8 w-8 animate-spin text-yellow-500 mx-auto mb-4" />
                <p className="text-gray-400">Carregando faixas de comissão...</p>
            </div>
        );
    }

    if (isError) {
        return (
            <div className="max-w-7xl mx-auto">
                <div className="text-red-400 text-center py-10">
                    <AlertTriangle className="h-12 w-12 mx-auto mb-4" />
                    <p className="text-lg font-semibold mb-2">Erro ao carregar faixas de comissão</p>
                    <p className="text-sm text-gray-400 mb-4">Possíveis causas:</p>
                    <ul className="text-sm text-gray-400 text-left max-w-md mx-auto mb-4">
                        <li>• As tabelas commission_ranges não existem no banco de dados</li>
                        <li>• Problema de permissões (RLS)</li>
                        <li>• Erro de conexão com o Supabase</li>
                    </ul>
                    <Button 
                        onClick={() => window.location.reload()}
                        className="bg-yellow-500 text-black hover:bg-yellow-600"
                    >
                        Recarregar Página
                    </Button>
                </div>
            </div>
        );
    }

    console.log('AdminCommissionTiers: Renderizando componente principal');
    
    return (
        <div className="max-w-7xl mx-auto">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-8">
                <h1 className="text-2xl sm:text-3xl font-serif text-yellow-500 mb-4 sm:mb-0 flex items-center">
                    <Percent className="h-7 w-7 mr-3" />
                    Faixas de Comissão por Volume ({ranges.filter(r => r.active).length} ativas / {ranges.length} total)
                </h1>
                <div className="flex space-x-3">
                    <Button 
                        onClick={handleToggleHistory}
                        variant="outline"
                        className="bg-black/60 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 text-sm"
                    >
                        <History className="mr-2 h-4 w-4" />
                        {showHistory ? 'Ocultar' : 'Mostrar'} Histórico
                    </Button>
                    <Button 
                        onClick={handleOpenCreate}
                        className="bg-yellow-500 text-black hover:bg-yellow-600 py-3 text-base font-semibold transition-all duration-300 cursor-pointer"
                    >
                        <Plus className="mr-2 h-5 w-5" />
                        Adicionar Faixa
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
                <CardDescription className="text-gray-400 text-sm mb-6">
                    Defina faixas de quantidade de ingressos com suas respectivas taxas de comissão. As faixas não podem se sobrepor e sempre deve existir uma faixa válida para qualquer quantidade.
                </CardDescription>
                
                {ranges.length === 0 ? (
                    <div className="text-center py-10">
                        <AlertTriangle className="h-12 w-12 text-gray-600 mx-auto mb-4" />
                        <p className="text-gray-400 text-lg">Nenhuma faixa de comissão cadastrada.</p>
                        <p className="text-gray-500 text-sm mt-2">Adicione a primeira faixa para começar a aplicar as regras de cobrança.</p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <Table className="w-full min-w-[700px]">
                            <TableHeader>
                                <TableRow className="border-b border-yellow-500/20 text-sm hover:bg-black/40">
                                    <TableHead className="text-left text-gray-400 font-semibold py-3 w-[30%]">Faixa de Ingressos</TableHead>
                                    <TableHead className="text-center text-gray-400 font-semibold py-3 w-[20%]">Taxa de Comissão</TableHead>
                                    <TableHead className="text-center text-gray-400 font-semibold py-3 w-[15%]">Status</TableHead>
                                    <TableHead className="text-right text-gray-400 font-semibold py-3 w-[35%]">Ações</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {ranges.map((range) => {
                                    const maxDisplay = range.max_tickets === 999999 ? 'ou mais' : range.max_tickets.toLocaleString('pt-BR');
                                    
                                    return (
                                        <TableRow 
                                            key={range.id} 
                                            className={`border-b border-yellow-500/10 hover:bg-black/40 transition-colors text-sm ${!range.active ? 'opacity-50' : ''}`}
                                        >
                                            <TableCell className="py-4 text-white font-medium">
                                                {range.min_tickets.toLocaleString('pt-BR')} - {maxDisplay}
                                            </TableCell>
                                            <TableCell className="text-center py-4">
                                                <span className="text-yellow-500 font-bold text-lg">
                                                    {range.percentage.toFixed(2).replace('.', ',')}%
                                                </span>
                                            </TableCell>
                                            <TableCell className="text-center py-4">
                                                <span className={`px-2 py-1 rounded text-xs font-semibold ${range.active ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                                                    {range.active ? 'Ativa' : 'Inativa'}
                                                </span>
                                            </TableCell>
                                            <TableCell className="text-right py-4">
                                                <div className="flex items-center justify-end space-x-2">
                                                    <Button 
                                                        variant="outline" 
                                                        size="sm"
                                                        className="bg-black/60 border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 h-8 px-3"
                                                        onClick={() => handleOpenEdit(range)}
                                                    >
                                                        <Edit className="h-4 w-4" />
                                                    </Button>
                                                    <AlertDialog>
                                                        <Tooltip>
                                                            <TooltipTrigger asChild>
                                                                <ToggleActiveDialog range={range} onToggleSuccess={invalidateRanges} />
                                                            </TooltipTrigger>
                                                            <TooltipContent>
                                                                <p>{range.active ? 'Desativar Faixa' : 'Ativar Faixa'}</p>
                                                            </TooltipContent>
                                                        </Tooltip>
                                                    </AlertDialog>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    );
                                })}
                            </TableBody>
                        </Table>
                    </div>
                )}
            </Card>

            {/* Card de Histórico */}
            {showHistory && (
                <Card className="bg-black border border-yellow-500/30 rounded-2xl shadow-2xl shadow-yellow-500/10 p-6 mt-6">
                    <CardHeader>
                        <CardTitle className="text-yellow-500 text-xl flex items-center">
                            <History className="h-5 w-5 mr-2" />
                            Histórico de Alterações
                        </CardTitle>
                        <CardDescription className="text-gray-400 text-sm">
                            Registro de todas as alterações nas faixas de comissão para auditoria.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        {isLoadingHistory ? (
                            <div className="text-center py-10">
                                <Loader2 className="h-8 w-8 animate-spin text-yellow-500 mx-auto mb-4" />
                                <p className="text-gray-400">Carregando histórico...</p>
                            </div>
                        ) : history.length === 0 ? (
                            <div className="text-center py-10">
                                <History className="h-12 w-12 text-gray-600 mx-auto mb-4" />
                                <p className="text-gray-400 text-lg">Nenhum registro no histórico.</p>
                            </div>
                        ) : (
                            <div className="overflow-x-auto">
                                <Table className="w-full min-w-[700px]">
                                    <TableHeader>
                                        <TableRow className="border-b border-yellow-500/20 text-sm hover:bg-black/40">
                                            <TableHead className="text-left text-gray-400 font-semibold py-3">Faixa de Ingressos</TableHead>
                                            <TableHead className="text-center text-gray-400 font-semibold py-3">Taxa de Comissão</TableHead>
                                            <TableHead className="text-right text-gray-400 font-semibold py-3">Data da Alteração</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {history.map((entry) => {
                                            const maxDisplay = entry.max_tickets === 999999 ? 'ou mais' : entry.max_tickets.toLocaleString('pt-BR');
                                            const date = new Date(entry.changed_at);
                                            
                                            return (
                                                <TableRow 
                                                    key={entry.id} 
                                                    className="border-b border-yellow-500/10 hover:bg-black/40 transition-colors text-sm"
                                                >
                                                    <TableCell className="py-4 text-white font-medium">
                                                        {entry.min_tickets.toLocaleString('pt-BR')} - {maxDisplay}
                                                    </TableCell>
                                                    <TableCell className="text-center py-4">
                                                        <span className="text-yellow-500 font-bold">
                                                            {entry.percentage.toFixed(2).replace('.', ',')}%
                                                        </span>
                                                    </TableCell>
                                                    <TableCell className="text-right py-4 text-gray-400">
                                                        {date.toLocaleString('pt-BR', {
                                                            day: '2-digit',
                                                            month: '2-digit',
                                                            year: 'numeric',
                                                            hour: '2-digit',
                                                            minute: '2-digit'
                                                        })}
                                                    </TableCell>
                                                </TableRow>
                                            );
                                        })}
                                    </TableBody>
                                </Table>
                            </div>
                        )}
                    </CardContent>
                </Card>
            )}
            
            {/* Modal de Criação/Edição */}
            <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
                <DialogContent className="sm:max-w-[700px] bg-black/90 border border-yellow-500/30 text-white p-6">
                    <DialogHeader>
                        <DialogTitle className="text-yellow-500 text-2xl flex items-center">
                            <Percent className="h-6 w-6 mr-2" />
                            {editingRange ? 'Editar Faixa de Comissão' : 'Adicionar Nova Faixa'}
                        </DialogTitle>
                        <DialogDescription className="text-gray-400">
                            Defina a faixa de quantidade de ingressos (mínimo e máximo) e a taxa de comissão correspondente. As faixas não podem se sobrepor.
                        </DialogDescription>
                    </DialogHeader>
                    <CommissionTierForm 
                        initialData={editingRange}
                        existingRanges={ranges.filter(r => r.id !== editingRange?.id)}
                        onSaveSuccess={() => {
                            handleCloseModal();
                            invalidateRanges();
                        }}
                        onCancel={handleCloseModal}
                        userId={userId!}
                    />
                </DialogContent>
            </Dialog>
        </div>
    );
};

export default AdminCommissionTiers;