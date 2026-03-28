"use client";

import React, { useState, useEffect, useRef } from 'react';
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Loader2, Edit, Save, CheckSquare, XSquare, AlertTriangle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useProfile } from '@/hooks/use-profile';
import { showSuccess, showError, showLoading, dismissToast } from '@/utils/toast';
import { normalizeContractContentForDisplay } from '@/utils/contractContent';
import { useQuery, useQueryClient } from '@tanstack/react-query';

interface MultiLineEditorProps {
    onAgree: (agreed: boolean) => void;
    initialAgreedState?: boolean;
    showAgreementCheckbox?: boolean; // Nova prop
    termsType?: 'general' | 'manager_registration'; // Tipo em terms_and_conditions (quando não usa external)
    /** Quando definido, ignora a tabela terms_and_conditions e exibe este conteúdo (ex.: contrato ativo em event_contracts). */
    externalContent?: string;
    externalTitle?: string;
}

const ADMIN_MASTER_USER_TYPE_ID = 1;

// Hook para buscar os termos e condições, agora com filtro por tipo
const fetchTermsAndConditions = async (type: 'general' | 'manager_registration') => {
    const { data, error } = await supabase
        .from('terms_and_conditions')
        .select('*')
        .eq('type', type) // Filtra pelo novo campo 'type'
        .order('updated_at', { ascending: false })
        .limit(1)
        .single();

    if (error && error.code !== 'PGRST116') { // PGRST116 = No rows found
        throw error;
    }
    return data;
};

const MultiLineEditor: React.FC<MultiLineEditorProps> = ({
    onAgree,
    initialAgreedState = false,
    showAgreementCheckbox = true,
    termsType = 'general',
    externalContent,
    externalTitle,
}) => {
    const useExternal = externalContent !== undefined;
    const queryClient = useQueryClient();
    const { data: termsData, isLoading: isLoadingTerms, isError: isErrorTerms, refetch } = useQuery({
        queryKey: ['termsAndConditions', termsType], // Inclui termsType na chave de cache
        queryFn: () => fetchTermsAndConditions(termsType),
        enabled: !useExternal,
        staleTime: 1000 * 60 * 60, // Cache por 1 hora
        onError: (error) => {
            console.error(`Erro ao carregar termos e condições (${termsType}):`, error);
            showError(`Erro ao carregar os termos e condições (${termsType}). Tente recarregar a página.`);
        }
    });

    const [userId, setUserId] = useState<string | undefined>(undefined);
    const { profile, isLoading: isLoadingProfile } = useProfile(userId);
    
    const [isEditing, setIsEditing] = useState(false);
    const [editedContent, setEditedContent] = useState<string>('');
    const [isSaving, setIsSaving] = useState(false);
    const [hasScrolledToEnd, setHasScrolledToEnd] = useState(false);
    const [agreed, setAgreed] = useState(initialAgreedState);

    const contentRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        supabase.auth.getUser().then(({ data: { user } }) => {
            setUserId(user?.id);
        });
    }, []);

    useEffect(() => {
        if (termsData?.content) {
            setEditedContent(termsData.content);
        } else {
            setEditedContent(''); // Limpa o conteúdo se não houver termos para o tipo
        }
    }, [termsData]);

    const isAdminMaster = profile?.tipo_usuario_id === ADMIN_MASTER_USER_TYPE_ID;
    const isClient = profile?.tipo_usuario_id === 3; // Tipo 3 é cliente

    const handleScroll = () => {
        if (contentRef.current) {
            const { scrollTop, scrollHeight, clientHeight } = contentRef.current;
            // Considera que o usuário rolou até o final se estiver a 10px do fim
            if (scrollHeight - scrollTop <= clientHeight + 10) {
                setHasScrolledToEnd(true);
            }
        }
    };

    const handleCheckboxChange = (checked: boolean) => {
        setAgreed(checked);
        onAgree(checked);
    };

    const handleSave = async () => {
        if (!userId || !isAdminMaster) {
            showError("Você não tem permissão para editar os termos.");
            return;
        }
        if (!editedContent.trim()) {
            showError("O conteúdo dos termos não pode estar vazio.");
            return;
        }

        setIsSaving(true);
        const toastId = showLoading("Salvando termos e condições...");

        try {
            const { error } = await supabase
                .from('terms_and_conditions')
                .upsert(
                    { 
                        id: termsData?.id, // Se existir, atualiza; senão, insere um novo
                        content: editedContent, 
                        updated_by: userId,
                        updated_at: new Date().toISOString(),
                        type: termsType, // Garante que o tipo seja salvo corretamente
                    },
                    { onConflict: 'type' } // Conflito agora é no 'type' para garantir unicidade por tipo
                );

            if (error) {
                throw error;
            }

            dismissToast(toastId);
            showSuccess("Termos e condições atualizados com sucesso!");
            setIsEditing(false);
            queryClient.invalidateQueries({ queryKey: ['termsAndConditions', termsType] }); // Invalida a query para forçar a re-busca
            refetch(); // Rebusca os termos para garantir que o cache seja atualizado

        } catch (e: any) {
            dismissToast(toastId);
            console.error("Erro ao salvar termos:", e);
            showError(`Falha ao salvar termos: ${e.message || 'Erro desconhecido'}`);
        } finally {
            setIsSaving(false);
        }
    };

    if ((!useExternal && isLoadingTerms) || isLoadingProfile) {
        return (
            <div className="text-center py-10">
                <Loader2 className="h-8 w-8 animate-spin text-yellow-500 mx-auto mb-4" />
                <p className="text-gray-400">Carregando termos e condições...</p>
            </div>
        );
    }

    if (!useExternal && (isErrorTerms || !termsData)) {
        // Se não houver termos para o tipo, e for Admin Master, permite editar para criar
        if (isAdminMaster && !isEditing) {
            return (
                <div className="bg-yellow-500/20 border border-yellow-500/30 text-yellow-400 p-6 rounded-xl space-y-4">
                    <h3 className="text-white text-xl">Termos de Uso ({termsType === 'general' ? 'Gerais' : 'Registro de Gestor'}) não encontrados.</h3>
                    <p className="text-gray-300 text-sm">Clique em "Editar Termos" para criar o conteúdo inicial.</p>
                    <Button 
                        onClick={() => setIsEditing(true)}
                        variant="outline"
                        className="bg-black/60 border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 text-sm h-9 px-4"
                    >
                        <Edit className="mr-2 h-4 w-4" />
                        Criar Termos
                    </Button>
                </div>
            );
        } else if (!isAdminMaster) {
            return (
                <div className="bg-red-500/20 border border-red-500/30 text-red-400 p-6 rounded-xl">
                    <h3 className="text-red-400 text-xl">Erro ao Carregar Termos</h3>
                    <p className="text-gray-400 text-sm">Não foi possível carregar os termos e condições. Por favor, tente novamente mais tarde.</p>
                </div>
            );
        }
    }

    const editorTitle = useExternal
        ? (externalTitle || 'Termos e Condições')
        : (termsType === 'general' ? 'Termos e Condições Gerais' : 'Termos de Registro de Gestor');

    return (
        <div className="space-y-6">
            <div className="flex flex-row items-center justify-between space-y-0 pb-4">
                {/* Título e botão de edição só aparecem se não for um pop-up */}
                {!showAgreementCheckbox && ( // Se não for para mostrar o checkbox, significa que é o editor principal
                    <h2 className="text-white text-xl sm:text-2xl font-semibold flex items-center">
                        <CheckSquare className="h-6 w-6 mr-3 text-yellow-500" />
                        {editorTitle}
                    </h2>
                )}
                {isAdminMaster && !showAgreementCheckbox && ( // Botão de edição só para Admin Master e se não for pop-up
                    <Button 
                        onClick={() => setIsEditing(!isEditing)}
                        variant="outline"
                        className="bg-black/60 border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 text-sm h-9 px-4"
                        disabled={isSaving}
                    >
                        {isEditing ? (
                            <>
                                <XSquare className="mr-2 h-4 w-4" />
                                Cancelar Edição
                            </>
                        ) : (
                            <>
                                <Edit className="mr-2 h-4 w-4" />
                                Editar Termos
                            </>
                        )}
                    </Button>
                )}
            </div>
            <div 
                ref={contentRef}
                onScroll={isClient && showAgreementCheckbox ? handleScroll : undefined} // Apenas clientes precisam rolar até o final se o checkbox for visível
                className="max-h-96 overflow-y-auto bg-black/60 border border-yellow-500/20 rounded-xl text-gray-300 text-sm leading-relaxed whitespace-pre-wrap"
            >
                {isEditing ? (
                    <Textarea
                        value={editedContent}
                        onChange={(e) => setEditedContent(e.target.value)}
                        className="w-full h-full bg-transparent border-none focus:ring-0 text-white resize-none p-4"
                        rows={15}
                        disabled={isSaving}
                    />
                ) : (
                    <div className="p-4">
                        {useExternal
                            ? normalizeContractContentForDisplay(externalContent || 'Nenhum termo disponível.')
                            : normalizeContractContentForDisplay(
                                  termsData?.content || 'Nenhum termo disponível para este tipo.',
                              )}
                    </div>
                )}
            </div>

            {isAdminMaster && isEditing && (
                <div className="flex justify-end">
                    <Button
                        onClick={handleSave}
                        disabled={isSaving || !editedContent.trim()}
                        className="bg-yellow-500 text-black hover:bg-yellow-600 py-2 text-base font-semibold transition-all duration-300 cursor-pointer disabled:opacity-50 h-10"
                    >
                        {isSaving ? (
                            <div className="flex items-center justify-center">
                                <Loader2 className="w-5 h-5 animate-spin mr-2" />
                                Salvando...
                            </div>
                        ) : (
                            <>
                                <Save className="w-4 h-4 mr-2" />
                                Salvar Alterações
                            </>
                        )}
                    </Button>
                </div>
            )}

            {showAgreementCheckbox && ( // Renderiza o checkbox apenas se a prop for true
                <div className="flex items-center space-x-3 pt-4 border-t border-yellow-500/10">
                    <Checkbox 
                        id="agreeTerms" 
                        checked={agreed}
                        onCheckedChange={handleCheckboxChange}
                        disabled={isClient && !hasScrolledToEnd} // Desabilitado para clientes até rolar
                        className="border-yellow-500 data-[state=checked]:bg-yellow-500 data-[state=checked]:text-black"
                    />
                    <label htmlFor="agreeTerms" className="text-sm font-medium text-white leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                        Eu li e concordo com os Termos e Condições.
                    </label>
                </div>
            )}
            {isClient && showAgreementCheckbox && !hasScrolledToEnd && ( // Mensagem de rolar só para clientes e se o checkbox for visível
                <p className="text-xs text-red-400 mt-2 flex items-center">
                    <AlertTriangle className="h-3 w-3 mr-1" />
                    Role até o final para habilitar a opção de concordar.
                </p>
            )}
        </div>
    );
};

export default MultiLineEditor;