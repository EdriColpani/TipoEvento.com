"use client";

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Loader2, ArrowLeft, FileText, Edit, Power, Eye, AlertTriangle, XCircle, Trash2, Save } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { showSuccess, showError, showLoading, dismissToast } from '@/utils/toast';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useProfile } from '@/hooks/use-profile';

interface EventContract {
    id: string;
    version: string;
    title: string;
    content: string;
    is_active: boolean;
    created_at: string;
    created_by: string | null;
    updated_at: string;
}

const ADMIN_MASTER_USER_TYPE_ID = 1;

const fetchEventContracts = async (): Promise<EventContract[]> => {
    const { data, error } = await supabase
        .from('event_contracts')
        .select('*')
        .order('created_at', { ascending: false });

    if (error) {
        console.error("Error fetching event contracts:", error);
        throw new Error(error.message);
    }
    
    return data as EventContract[];
};

const useEventContracts = (isAdminMaster: boolean) => {
    const queryClient = useQueryClient();
    const query = useQuery({
        queryKey: ['eventContracts'],
        queryFn: fetchEventContracts,
        enabled: isAdminMaster,
        staleTime: 1000 * 60 * 5, // 5 minutes
        onError: (error) => {
            console.error("Query Error: Failed to load event contracts.", error);
            showError("Erro ao carregar os contratos de evento.");
        }
    });

    return {
        ...query,
        contracts: query.data || [],
        invalidateContracts: () => queryClient.invalidateQueries({ queryKey: ['eventContracts'] }),
    };
};

// Componente para o formulário de criação/edição de contrato
interface ContractFormProps {
    initialData?: EventContract;
    onSaveSuccess: () => void;
    onCancel: () => void;
    userId: string;
}

const ContractForm: React.FC<ContractFormProps> = ({ initialData, onSaveSuccess, onCancel, userId }) => {
    const [isSaving, setIsSaving] = useState(false);
    const [version, setVersion] = useState(initialData?.version || '');
    const [title, setTitle] = useState(initialData?.title || '');
    const [content, setContent] = useState(initialData?.content || '');

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSaving(true);
        const toastId = showLoading(initialData ? "Atualizando contrato..." : "Criando novo contrato...");

        if (!version || !title || !content) {
            dismissToast(toastId);
            showError("Todos os campos são obrigatórios.");
            setIsSaving(false);
            return;
        }

        // Verifica se a versão já existe para novos contratos
        if (!initialData) {
            const { data: existing, error: existingError } = await supabase
                .from('event_contracts')
                .select('id')
                .eq('version', version)
                .single();
            
            if (existingError && existingError.code !== 'PGRST116') { // PGRST116 = No rows found
                dismissToast(toastId);
                showError("Erro ao verificar versão existente: " + existingError.message);
                setIsSaving(false);
                return;
            }
            if (existing) {
                dismissToast(toastId);
                showError("Já existe um contrato com esta versão.");
                setIsSaving(false);
                return;
            }
        }

        const dataToSave = {
            version,
            title,
            content,
            created_by: userId, // Salva o ID do admin que criou/editou
        };

        try {
            let error;
            if (initialData) {
                // Update
                const result = await supabase
                    .from('event_contracts')
                    .update(dataToSave)
                    .eq('id', initialData.id);
                error = result.error;
            } else {
                // Insert
                const result = await supabase
                    .from('event_contracts')
                    .insert([dataToSave]);
                error = result.error;
            }

            if (error) {
                throw error;
            }

            dismissToast(toastId);
            showSuccess(`Contrato ${initialData ? 'atualizado' : 'criado'} com sucesso!`);
            onSaveSuccess();

        } catch (e: any) {
            dismissToast(toastId);
            console.error("Erro ao salvar contrato:", e);
            showError(`Falha ao salvar: ${e.message || 'Erro desconhecido'}`);
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-6">
            <div>
                <label htmlFor="version" className="block text-sm font-medium text-white mb-2">Versão</label>
                <Input
                    id="version"
                    value={version}
                    onChange={(e) => setVersion(e.target.value)}
                    placeholder="Ex: 1.0"
                    className="bg-black/60 border-yellow-500/30 text-white placeholder-gray-500 focus:border-yellow-500"
                    disabled={isSaving || !!initialData} // Não permite alterar a versão após a criação
                />
                {!!initialData && <p className="text-xs text-gray-500 mt-1">A versão não pode ser alterada após a criação.</p>}
            </div>
            <div>
                <label htmlFor="title" className="block text-sm font-medium text-white mb-2">Título</label>
                <Input
                    id="title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Ex: Termos de Uso da Plataforma EventoFest"
                    className="bg-black/60 border-yellow-500/30 text-white placeholder-gray-500 focus:border-yellow-500"
                    disabled={isSaving}
                />
            </div>
            <div>
                <label htmlFor="content" className="block text-sm font-medium text-white mb-2">Conteúdo (HTML ou Markdown)</label>
                <textarea
                    id="content"
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    placeholder="Insira o conteúdo completo do contrato aqui..."
                    rows={10}
                    className="flex w-full rounded-md border border-yellow-500/30 bg-black/60 px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-yellow-500 focus:border-yellow-500 disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={isSaving}
                />
            </div>

            <div className="flex justify-end space-x-4 pt-4 border-t border-yellow-500/20">
                <Button
                    type="button"
                    onClick={onCancel}
                    variant="outline"
                    className="bg-black/60 border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 py-2 text-base font-semibold transition-all duration-300 cursor-pointer"
                    disabled={isSaving}
                >
                    Cancelar
                </Button>
                <Button
                    type="submit"
                    disabled={isSaving}
                    className="bg-yellow-500 text-black hover:bg-yellow-600 py-2 text-base font-semibold transition-all duration-300 cursor-pointer disabled:opacity-50"
                >
                    {isSaving ? (
                        <div className="flex items-center justify-center">
                            <Loader2 className="w-5 h-5 animate-spin mr-2" />
                            Salvando...
                        </div>
                    ) : (
                        <>
                            <Save className="mr-2 h-5 w-5" />
                            Salvar Contrato
                        </>
                    )}
                </Button>
            </div>
        </form>
    );
};

// Componente de Diálogo de Ativação/Desativação
const ToggleActiveDialog: React.FC<{ contract: EventContract, onToggleSuccess: () => void, userId: string }> = ({ contract, onToggleSuccess, userId }) => {
    const [isToggling, setIsToggling] = useState(false);
    const [isDialogOpen, setIsDialogOpen] = useState(false);

    const handleToggle = async () => {
        setIsToggling(true);
        const toastId = showLoading(`${contract.is_active ? 'Desativando' : 'Ativando'} contrato...`);

        try {
            let error;
            if (contract.is_active) {
                // Se estiver desativando, apenas atualiza o status
                const result = await supabase
                    .from('event_contracts')
                    .update({ is_active: false, updated_at: new Date().toISOString(), created_by: userId })
                    .eq('id', contract.id);
                error = result.error;
            } else {
                // Se estiver ativando, primeiro desativa todos os outros, depois ativa este
                // Desativa todos os contratos ativos primeiro
                const { error: deactivateError } = await supabase
                    .from('event_contracts')
                    .update({ is_active: false, updated_at: new Date().toISOString(), created_by: userId })
                    .eq('is_active', true);
                
                if (deactivateError) {
                    console.error("Erro ao desativar contratos antigos:", deactivateError);
                    throw new Error("Falha ao desativar contratos antigos: " + deactivateError.message);
                }

                // Ativa o contrato atual
                const result = await supabase
                    .from('event_contracts')
                    .update({ is_active: true, updated_at: new Date().toISOString(), created_by: userId })
                    .eq('id', contract.id);
                error = result.error;
            }
            
            if (error) {
                throw error;
            }

            dismissToast(toastId);
            showSuccess(`Contrato ${contract.is_active ? 'desativado' : 'ativado'} com sucesso.`);
            onToggleSuccess();
            setIsDialogOpen(false);

        } catch (e: any) {
            dismissToast(toastId);
            console.error("Erro ao alterar status do contrato:", e);
            showError(`Falha ao ${contract.is_active ? 'desativar' : 'ativar'} contrato: ${e.message || 'Erro desconhecido'}`);
        } finally {
            setIsToggling(false);
        }
    };

    return (
        <AlertDialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <AlertDialogTrigger asChild>
                <Button 
                    variant="outline" 
                    size="sm"
                    className={`h-8 px-3 ${contract.is_active ? 'bg-black/60 border-red-500/30 text-red-400 hover:bg-red-500/10' : 'bg-black/60 border-green-500/30 text-green-400 hover:bg-green-500/10'}`}
                >
                    <Power className="h-4 w-4" />
                </Button>
            </AlertDialogTrigger>
            <AlertDialogContent className="bg-black/90 border border-yellow-500/30 text-white">
                <AlertDialogHeader>
                    <AlertDialogTitle className="text-yellow-400">
                        {contract.is_active ? 'Desativar Contrato' : 'Ativar Contrato'}
                    </AlertDialogTitle>
                    <AlertDialogDescription className="text-gray-400">
                        {contract.is_active ? (
                            <>
                                Tem certeza que deseja desativar este contrato? Ele não será mais aplicado a novos eventos.
                                <br /><br />
                                Contrato: <span className="font-semibold text-white">{contract.title} (Versão {contract.version})</span>
                            </>
                        ) : (
                            <>
                                Tem certeza que deseja ativar este contrato? Ele se tornará o contrato padrão para novos eventos. O contrato atualmente ativo será desativado.
                                <br /><br />
                                Contrato: <span className="font-semibold text-white">{contract.title} (Versão {contract.version})</span>
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
                        className={contract.is_active ? "bg-red-600 text-white hover:bg-red-700" : "bg-green-600 text-white hover:bg-green-700"}
                        disabled={isToggling}
                    >
                        {isToggling ? <Loader2 className="h-4 w-4 animate-spin" /> : (contract.is_active ? 'Desativar' : 'Ativar')}
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
};

// Componente de Diálogo de Exclusão
const DeleteContractDialog: React.FC<{ contract: EventContract, onDeleteSuccess: () => void }> = ({ contract, onDeleteSuccess }) => {
    const [isDeleting, setIsDeleting] = useState(false);
    const [isDialogOpen, setIsDialogOpen] = useState(false);

    const handleDelete = async () => {
        setIsDeleting(true);
        const toastId = showLoading("Excluindo contrato...");

        try {
            // Verifica se o contrato está ativo antes de excluir
            if (contract.is_active) {
                dismissToast(toastId);
                showError("Não é possível excluir um contrato ativo. Desative-o primeiro.");
                setIsDialogOpen(false);
                setIsDeleting(false);
                return;
            }

            const { error } = await supabase
                .from('event_contracts')
                .delete()
                .eq('id', contract.id);

            if (error) {
                throw error;
            }

            dismissToast(toastId);
            showSuccess(`Contrato "${contract.title}" excluído com sucesso.`);
            onDeleteSuccess();
            setIsDialogOpen(false);

        } catch (e: any) {
            dismissToast(toastId);
            console.error("Erro ao excluir contrato:", e);
            showError(`Falha ao excluir contrato: ${e.message || 'Erro desconhecido'}`);
        } finally {
            setIsDeleting(false);
        }
    };

    return (
        <AlertDialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <AlertDialogTrigger asChild>
                <Button 
                    variant="outline" 
                    size="sm"
                    className="bg-black/60 border-red-500/30 text-red-400 hover:bg-red-500/10 h-8 px-3"
                >
                    <Trash2 className="h-4 w-4" />
                </Button>
            </AlertDialogTrigger>
            <AlertDialogContent className="bg-black/90 border border-yellow-500/30 text-white">
                <AlertDialogHeader>
                    <AlertDialogTitle className="text-red-400">
                        Excluir Contrato
                    </AlertDialogTitle>
                    <AlertDialogDescription className="text-gray-400">
                        Tem certeza que deseja excluir este contrato? Esta ação não pode ser desfeita.
                        <br /><br />
                        Contrato: <span className="font-semibold text-white">{contract.title} (Versão {contract.version})</span>
                        {contract.is_active && (
                            <>
                                <br /><br />
                                <span className="text-red-400 font-semibold">⚠️ Atenção: Este contrato está ativo. Desative-o antes de excluir.</span>
                            </>
                        )}
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel className="bg-black/60 border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10">
                        Cancelar
                    </AlertDialogCancel>
                    <AlertDialogAction 
                        onClick={handleDelete} 
                        className="bg-red-600 text-white hover:bg-red-700"
                        disabled={isDeleting || contract.is_active}
                    >
                        {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Excluir'}
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
};

// Componente para visualização do conteúdo do contrato
const ViewContentDialog: React.FC<{ contract: EventContract, onClose: () => void }> = ({ contract, onClose }) => {
    return (
        <Dialog open={true} onOpenChange={onClose}>
            <DialogContent className="sm:max-w-[800px] bg-black/90 border border-yellow-500/30 text-white p-6">
                <DialogHeader>
                    <DialogTitle className="text-yellow-500 text-2xl flex items-center">
                        <FileText className="h-6 w-6 mr-2" />
                        Visualizar Contrato: {contract.title}
                    </DialogTitle>
                    <DialogDescription className="text-gray-400">
                        Versão: <span className="font-semibold text-white">{contract.version}</span>
                    </DialogDescription>
                </DialogHeader>
                <div className="prose prose-invert max-h-[60vh] overflow-y-auto mt-4 p-4 border border-yellow-500/20 rounded-lg">
                    <div dangerouslySetInnerHTML={{ __html: contract.content }} />
                </div>
                <div className="flex justify-end pt-4 border-t border-yellow-500/20">
                    <Button 
                        onClick={onClose}
                        variant="outline"
                        className="bg-black/60 border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 py-2 text-base font-semibold transition-all duration-300 cursor-pointer"
                    >
                        Fechar
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
};

const AdminEventContracts: React.FC = () => {
    const navigate = useNavigate();
    const [userId, setUserId] = useState<string | undefined>(undefined);
    const { profile, isLoading: isLoadingProfile } = useProfile(userId);
    const { contracts, isLoading, isError, invalidateContracts } = useEventContracts(profile?.tipo_usuario_id === ADMIN_MASTER_USER_TYPE_ID);
    
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingContract, setEditingContract] = useState<EventContract | undefined>(undefined);
    const [viewingContract, setViewingContract] = useState<EventContract | undefined>(undefined);

    useEffect(() => {
        supabase.auth.getUser().then(({ data: { user } }) => {
            setUserId(user?.id);
        });
    }, []);
    
    const isAdminMaster = profile?.tipo_usuario_id === ADMIN_MASTER_USER_TYPE_ID;

    const handleOpenCreate = () => {
        setEditingContract(undefined);
        setIsModalOpen(true);
    };

    const handleOpenEdit = (contract: EventContract) => {
        setEditingContract(contract);
        setIsModalOpen(true);
    };

    const handleViewContent = (contract: EventContract) => {
        setViewingContract(contract);
    };

    const handleCloseModal = () => {
        setIsModalOpen(false);
        setEditingContract(undefined);
    };

    const handleCloseViewModal = () => {
        setViewingContract(undefined);
    };

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
                <p className="text-gray-400">Carregando contratos de evento...</p>
            </div>
        );
    }

    if (isError) {
        return <div className="text-red-400 text-center py-10">Erro ao carregar contratos de evento. Tente recarregar a página.</div>;
    }

    return (
        <div className="max-w-7xl mx-auto">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-8">
                <h1 className="text-2xl sm:text-3xl font-serif text-yellow-500 mb-4 sm:mb-0 flex items-center">
                    <FileText className="h-7 w-7 mr-3" />
                    Contratos de Eventos ({contracts.filter(c => c.is_active).length} ativos / {contracts.length} total)
                </h1>
                <div className="flex space-x-3">
                    <Button 
                        onClick={handleOpenCreate}
                        className="bg-yellow-500 text-black hover:bg-yellow-600 py-3 text-base font-semibold transition-all duration-300 cursor-pointer"
                    >
                        <Plus className="mr-2 h-5 w-5" />
                        Adicionar Contrato
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
                    Gerencie os termos e condições aplicados aos eventos. Apenas um contrato pode estar ativo por vez.
                </CardDescription>
                
                {contracts.length === 0 ? (
                    <div className="text-center py-10">
                        <AlertTriangle className="h-12 w-12 text-gray-600 mx-auto mb-4" />
                        <p className="text-gray-400 text-lg">Nenhum contrato cadastrado.</p>
                        <p className="text-gray-500 text-sm mt-2">Adicione o primeiro contrato para começar a utilizá-los nos eventos.</p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <Table className="w-full min-w-[700px]">
                            <TableHeader>
                                <TableRow className="border-b border-yellow-500/20 text-sm hover:bg-black/40">
                                    <TableHead className="text-left text-gray-400 font-semibold py-3 w-[15%]">Versão</TableHead>
                                    <TableHead className="text-left text-gray-400 font-semibold py-3 w-[40%]">Título</TableHead>
                                    <TableHead className="text-center text-gray-400 font-semibold py-3 w-[15%]">Status</TableHead>
                                    <TableHead className="text-right text-gray-400 font-semibold py-3 w-[30%]">Ações</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {contracts.map((contract) => (
                                    <TableRow 
                                        key={contract.id} 
                                        className={`border-b border-yellow-500/10 hover:bg-black/40 transition-colors text-sm ${!contract.is_active ? 'opacity-50' : ''}`}
                                    >
                                        <TableCell className="py-4 text-white font-medium">
                                            {contract.version}
                                        </TableCell>
                                        <TableCell className="py-4 text-white font-medium">
                                            {contract.title}
                                        </TableCell>
                                        <TableCell className="text-center py-4">
                                            <span className={`px-2 py-1 rounded text-xs font-semibold ${contract.is_active ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                                                {contract.is_active ? 'Ativo' : 'Inativo'}
                                            </span>
                                        </TableCell>
                                        <TableCell className="text-right py-4">
                                            <div className="flex items-center justify-end space-x-2">
                                                <Button 
                                                    variant="outline" 
                                                    size="sm"
                                                    className="bg-black/60 border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 h-8 px-3"
                                                    onClick={() => handleViewContent(contract)}
                                                >
                                                    <Eye className="h-4 w-4" />
                                                </Button>
                                                <Button 
                                                    variant="outline" 
                                                    size="sm"
                                                    className="bg-black/60 border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 h-8 px-3"
                                                    onClick={() => handleOpenEdit(contract)}
                                                >
                                                    <Edit className="h-4 w-4" />
                                                </Button>
                                                <ToggleActiveDialog contract={contract} onToggleSuccess={invalidateContracts} userId={userId!} />
                                                <DeleteContractDialog contract={contract} onDeleteSuccess={invalidateContracts} />
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                )}
            </Card>

            {/* Modal de Criação/Edição */}
            <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
                <DialogContent className="sm:max-w-[700px] bg-black/90 border border-yellow-500/30 text-white p-6">
                    <DialogHeader>
                        <DialogTitle className="text-yellow-500 text-2xl flex items-center">
                            <FileText className="h-6 w-6 mr-2" />
                            {editingContract ? 'Editar Contrato' : 'Adicionar Novo Contrato'}
                        </DialogTitle>
                        <DialogDescription className="text-gray-400">
                            Defina o conteúdo do contrato que será exibido aos organizadores de eventos. Apenas um contrato pode estar ativo por vez.
                        </DialogDescription>
                    </DialogHeader>
                    <ContractForm 
                        initialData={editingContract}
                        onSaveSuccess={() => {
                            handleCloseModal();
                            invalidateContracts();
                        }}
                        onCancel={handleCloseModal}
                        userId={userId!}
                    />
                </DialogContent>
            </Dialog>

            {/* Modal de Visualização de Conteúdo */}
            {viewingContract && (
                <ViewContentDialog contract={viewingContract} onClose={handleCloseViewModal} />
            )}
        </div>
    );
};

export default AdminEventContracts;

