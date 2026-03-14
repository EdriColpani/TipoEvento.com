import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ArrowLeft, Plus, Loader2, Key, Copy, CheckCircle, XCircle, Eye, EyeOff, Calendar, AlertTriangle, RefreshCw, Trash2, History, Edit, Share2, MessageCircle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { showSuccess, showError, showLoading, dismissToast } from '@/utils/toast';
import { useProfile } from '@/hooks/use-profile';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface ValidationApiKey {
    id: string;
    name: string;
    api_key?: string; // Só aparece quando criado
    event_id: string | null;
    event_title?: string;
    is_active: boolean;
    expires_at: string | null;
    last_used_at: string | null;
    created_at: string;
}

interface ValidationLog {
    id: string;
    wristband_code: string;
    validation_type: string;
    validation_status: string;
    validation_message: string;
    validated_by_name: string;
    created_at: string;
    event_title?: string;
}

const fetchValidationKeys = async (userId: string, isAdminMaster: boolean): Promise<ValidationApiKey[]> => {
    // A RLS no banco já filtra por empresa automaticamente
    // Não precisamos filtrar manualmente aqui
    const { data, error } = await supabase
        .from('validation_api_keys')
        .select(`
            id,
            name,
            event_id,
            is_active,
            expires_at,
            last_used_at,
            created_at,
            events!event_id (title)
        `)
        .order('created_at', { ascending: false });

    if (error) throw error;

    return data.map((key: any) => ({
        ...key,
        event_title: key.events?.title || null,
        // api_key não é buscada por segurança - só existe no estado local após criação
    }));
};

const fetchValidationLogs = async (apiKeyId: string): Promise<ValidationLog[]> => {
    const { data, error } = await supabase
        .from('validation_logs')
        .select(`
            id,
            wristband_code,
            validation_type,
            validation_status,
            validation_message,
            validated_by_name,
            created_at,
            event_id,
            events!event_id (title)
        `)
        .eq('api_key_id', apiKeyId)
        .order('created_at', { ascending: false })
        .limit(50);

    if (error) throw error;

    return data.map((log: any) => ({
        ...log,
        event_title: log.events?.title || null,
    }));
};

const fetchEvents = async (userId: string, isAdminMaster: boolean): Promise<{ id: string; title: string; date: string; time: string; duration: string | null }[]> => {
    let query = supabase
        .from('events')
        .select('id, title, date, time, duration')
        .order('title', { ascending: true });

    // Se não for Admin Master, filtra por empresa
    if (!isAdminMaster) {
        // Buscar company_id do usuário
        const { data: companyData, error: companyError } = await supabase
            .from('user_companies')
            .select('company_id')
            .eq('user_id', userId)
            .eq('is_primary', true)
            .limit(1)
            .single();

        if (companyError && companyError.code !== 'PGRST116') {
            throw new Error(companyError.message);
        }

        if (!companyData?.company_id) {
            return []; // Retorna vazio se não tiver empresa
        }

        query = query.eq('company_id', companyData.company_id);
    }

    const { data, error } = await query;

    if (error) throw error;
    return data;
};

const ManagerValidationKeys: React.FC = () => {
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const [userId, setUserId] = useState<string | undefined>(undefined);
    const [showCreateDialog, setShowCreateDialog] = useState(false);
    const [showLogsDialog, setShowLogsDialog] = useState(false);
    const [showEditDialog, setShowEditDialog] = useState(false);
    const [selectedApiKeyId, setSelectedApiKeyId] = useState<string | null>(null);
    const [editingKey, setEditingKey] = useState<ValidationApiKey | null>(null);
    const [newKeyName, setNewKeyName] = useState('');
    const [newKeyEventId, setNewKeyEventId] = useState<string>('');
    const [newKeyExpiresAt, setNewKeyExpiresAt] = useState('');
    const [editKeyName, setEditKeyName] = useState('');
    const [editKeyEventId, setEditKeyEventId] = useState<string>('');
    const [editKeyExpiresAt, setEditKeyExpiresAt] = useState('');
    const [revealedKeys, setRevealedKeys] = useState<Set<string>>(new Set());
    const [storedApiKeys, setStoredApiKeys] = useState<Map<string, string>>(new Map()); // Armazena chaves criadas nesta sessão

    useEffect(() => {
        supabase.auth.getUser().then(({ data: { user } }) => {
            setUserId(user?.id);
        });
    }, []);

    const { profile } = useProfile(userId);
    const isAdminMaster = profile?.tipo_usuario_id === 1;

    const { data: keys, isLoading: isLoadingKeys, refetch: refetchKeys } = useQuery({
        queryKey: ['validationApiKeys', userId, isAdminMaster],
        queryFn: () => fetchValidationKeys(userId!, isAdminMaster),
        enabled: !!userId,
    });

    const { data: events } = useQuery({
        queryKey: ['managerEventsForKeys', userId, isAdminMaster],
        queryFn: () => fetchEvents(userId!, isAdminMaster),
        enabled: !!userId,
    });

    // Função para calcular data de expiração baseada no evento
    const calculateExpirationDate = (eventId: string | null) => {
        if (!eventId || !events) return '';
        
        const selectedEvent = events.find(e => e.id === eventId);
        if (!selectedEvent || !selectedEvent.date) return '';

        // Pega a data do evento
        const eventDate = new Date(selectedEvent.date);
        
        // Se tiver hora, adiciona a hora
        if (selectedEvent.time) {
            const [hours, minutes] = selectedEvent.time.split(':').map(Number);
            eventDate.setHours(hours || 23, minutes || 59, 59, 999);
        } else {
            // Se não tiver hora, coloca fim do dia
            eventDate.setHours(23, 59, 59, 999);
        }

        // Se tiver duração, adiciona a duração (assumindo formato "X horas" ou "Xh")
        if (selectedEvent.duration) {
            const durationMatch = selectedEvent.duration.match(/(\d+)/);
            if (durationMatch) {
                const hours = parseInt(durationMatch[1]);
                eventDate.setHours(eventDate.getHours() + hours);
            }
        }

        // Formata para datetime-local (YYYY-MM-DDTHH:mm)
        const year = eventDate.getFullYear();
        const month = String(eventDate.getMonth() + 1).padStart(2, '0');
        const day = String(eventDate.getDate()).padStart(2, '0');
        const hours = String(eventDate.getHours()).padStart(2, '0');
        const minutes = String(eventDate.getMinutes()).padStart(2, '0');
        
        return `${year}-${month}-${day}T${hours}:${minutes}`;
    };

    // Quando selecionar evento na criação, atualiza a data de expiração
    useEffect(() => {
        if (newKeyEventId && events) {
            const expirationDate = calculateExpirationDate(newKeyEventId);
            setNewKeyExpiresAt(expirationDate);
        } else {
            setNewKeyExpiresAt('');
        }
    }, [newKeyEventId, events]);

    // Quando selecionar evento na edição, atualiza a data de expiração
    useEffect(() => {
        if (editKeyEventId && events) {
            const expirationDate = calculateExpirationDate(editKeyEventId);
            setEditKeyExpiresAt(expirationDate);
        } else {
            setEditKeyExpiresAt('');
        }
    }, [editKeyEventId, events]);

    const { data: logs, isLoading: isLoadingLogs } = useQuery({
        queryKey: ['validationLogs', selectedApiKeyId],
        queryFn: () => fetchValidationLogs(selectedApiKeyId!),
        enabled: !!selectedApiKeyId && showLogsDialog,
    });

    const handleCreateKey = async () => {
        if (!newKeyName.trim()) {
            showError('Nome do colaborador é obrigatório.');
            return;
        }

        if (!newKeyEventId) {
            showError('É obrigatório selecionar um evento.');
            return;
        }

        if (!newKeyExpiresAt) {
            showError('Data de expiração não foi calculada. Verifique se o evento tem data definida.');
            return;
        }

        if (!userId) {
            showError('Usuário não autenticado.');
            return;
        }

        const toastId = showLoading('Criando chave de acesso...');

        try {
            const { data: sess } = await supabase.auth.getSession();
            if (!sess.session) {
                dismissToast(toastId);
                showError('Sessão expirada. Entre de novo no gestor.');
                return;
            }
            await supabase.auth.refreshSession();
            const { data: sess2 } = await supabase.auth.getSession();
            const token = sess2.session?.access_token;
            if (!token) {
                dismissToast(toastId);
                showError('Não foi possível obter o token de sessão. Entre de novo.');
                return;
            }
            const { data: edgeData, error: edgeError } = await supabase.functions.invoke(
                'create-validation-key',
                {
                    body: {
                        name: newKeyName.trim(),
                        event_id: newKeyEventId,
                        expires_at: newKeyExpiresAt,
                        created_by: userId,
                    },
                    headers: { Authorization: `Bearer ${token}` },
                },
            );

            if (edgeError) {
                dismissToast(toastId);
                console.error('Erro ao chamar Edge Function:', edgeError);
                throw new Error(
                    edgeError.message ||
                        'Erro ao criar chave. No Supabase: Edge Functions → create-validation-key → desligar Verify JWT.',
                );
            }

            const payload = edgeData as { success?: boolean; error?: string; hint?: string } | null;
            if (!payload?.success) {
                dismissToast(toastId);
                const msg =
                    payload?.error ||
                    'Erro ao criar chave. Se persistir: Dashboard → Edge Functions → create-validation-key → Details → Verify JWT = OFF.';
                throw new Error(msg);
            }

            const insertedData = (edgeData as { key?: { id: string; api_key?: string } }).key;

            if (!insertedData) {
                dismissToast(toastId);
                throw new Error('Chave criada mas não foi possível recuperar os dados.');
            }

            // Fechar toast de loading antes de mostrar sucesso
            dismissToast(toastId);
            
            showSuccess('Chave de acesso criada com sucesso!');
            
            // Armazenar a chave no estado local (ela não será retornada nas próximas consultas)
            // A chave em texto plano vem da Edge Function
            if (insertedData.api_key) {
                setStoredApiKeys(prev => new Map(prev).set(insertedData.id, insertedData.api_key));
            }
            
            // Mostrar a chave ao usuário
            setRevealedKeys(new Set([insertedData.id]));
            setShowCreateDialog(false);
            setNewKeyName('');
            setNewKeyEventId('');
            setNewKeyExpiresAt('');
            
            // Refetch keys para atualizar a lista
            await refetchKeys();

        } catch (error: any) {
            dismissToast(toastId);
            console.error('Erro completo ao criar chave:', error);
            showError(`Erro ao criar chave: ${error.message || 'Erro desconhecido'}`);
        }
    };

    const handleToggleActive = async (keyId: string, currentStatus: boolean) => {
        const toastId = showLoading(currentStatus ? 'Desativando chave...' : 'Ativando chave...');

        try {
            const { error } = await supabase
                .from('validation_api_keys')
                .update({ is_active: !currentStatus })
                .eq('id', keyId);

            if (error) throw error;

            dismissToast(toastId);
            showSuccess(`Chave ${!currentStatus ? 'ativada' : 'desativada'} com sucesso!`);
            refetchKeys();

        } catch (error: any) {
            dismissToast(toastId);
            showError(`Erro ao atualizar chave: ${error.message}`);
        }
    };

    const handleEditKey = (key: ValidationApiKey) => {
        setEditingKey(key);
        setEditKeyName(key.name);
        setEditKeyEventId(key.event_id || '');
        setEditKeyExpiresAt(key.expires_at ? format(new Date(key.expires_at), "yyyy-MM-dd'T'HH:mm") : '');
        setShowEditDialog(true);
    };

    const handleSaveEdit = async () => {
        if (!editingKey) return;

        if (!editKeyName.trim()) {
            showError('Nome do colaborador é obrigatório.');
            return;
        }

        if (!editKeyEventId) {
            showError('É obrigatório selecionar um evento.');
            return;
        }

        if (!editKeyExpiresAt) {
            showError('Data de expiração não foi calculada. Verifique se o evento tem data definida.');
            return;
        }

        const toastId = showLoading('Salvando alterações...');

        try {
            const updateData: any = {
                name: editKeyName.trim(),
                event_id: editKeyEventId || null,
            };

            if (editKeyExpiresAt) {
                updateData.expires_at = editKeyExpiresAt;
            } else {
                updateData.expires_at = null;
            }

            const { error } = await supabase
                .from('validation_api_keys')
                .update(updateData)
                .eq('id', editingKey.id);

            if (error) throw error;

            dismissToast(toastId);
            showSuccess('Chave atualizada com sucesso!');
            setShowEditDialog(false);
            setEditingKey(null);
            refetchKeys();

        } catch (error: any) {
            dismissToast(toastId);
            showError(`Erro ao atualizar chave: ${error.message}`);
        }
    };

    const handleDeleteKey = async (keyId: string) => {
        if (!confirm('Tem certeza que deseja excluir esta chave? Esta ação não pode ser desfeita.')) {
            return;
        }

        const toastId = showLoading('Excluindo chave...');

        try {
            const { error } = await supabase
                .from('validation_api_keys')
                .delete()
                .eq('id', keyId);

            if (error) throw error;

            dismissToast(toastId);
            showSuccess('Chave excluída com sucesso!');
            refetchKeys();

        } catch (error: any) {
            dismissToast(toastId);
            showError(`Erro ao excluir chave: ${error.message}`);
        }
    };

    const copyToClipboard = async (text: string) => {
        try {
            // Verificar se a API Clipboard está disponível
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(text);
                showSuccess('Chave copiada para a área de transferência!');
            } else {
                // Fallback para navegadores que não suportam Clipboard API
                const textArea = document.createElement('textarea');
                textArea.value = text;
                textArea.style.position = 'fixed';
                textArea.style.left = '-999999px';
                textArea.style.top = '-999999px';
                document.body.appendChild(textArea);
                textArea.focus();
                textArea.select();
                
                try {
                    const successful = document.execCommand('copy');
                    if (successful) {
                        showSuccess('Chave copiada para a área de transferência!');
                    } else {
                        throw new Error('Falha ao copiar usando execCommand');
                    }
                } finally {
                    document.body.removeChild(textArea);
                }
            }
        } catch (error) {
            console.error('Erro ao copiar chave:', error);
            showError('Erro ao copiar chave. Tente selecionar e copiar manualmente.');
        }
    };

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'success': return 'text-green-500';
            case 'invalid': return 'text-red-500';
            case 'not_paid': return 'text-yellow-500';
            case 'already_used': return 'text-orange-500';
            default: return 'text-gray-500';
        }
    };

    if (!userId) {
        return (
            <div className="max-w-7xl mx-auto text-center py-20">
                <Loader2 className="h-10 w-10 animate-spin text-yellow-500 mx-auto mb-4" />
                <p className="text-gray-400">Carregando...</p>
            </div>
        );
    }

    return (
        <div className="max-w-7xl mx-auto">
            <div className="flex items-center justify-between mb-8">
                <h1 className="text-2xl sm:text-3xl font-serif text-yellow-500 flex items-center">
                    <Key className="h-7 w-7 mr-3" />
                    Chaves de Acesso para Validação
                </h1>
                <Button 
                    onClick={() => navigate('/manager/dashboard')}
                    variant="outline"
                    className="bg-black/60 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 text-sm"
                >
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Voltar
                </Button>
            </div>

            <Card className="bg-black border border-yellow-500/30 rounded-2xl shadow-2xl shadow-yellow-500/10 p-6 mb-6">
                <div className="flex items-center justify-between mb-6">
                    <div>
                        <CardTitle className="text-white text-xl mb-2">Suas Chaves de Acesso</CardTitle>
                        <CardDescription className="text-gray-400">
                            Gerencie as chaves de acesso para o aplicativo de validação de ingressos.
                        </CardDescription>
                    </div>
                    <Button
                        onClick={() => setShowCreateDialog(true)}
                        className="bg-yellow-500 text-black hover:bg-yellow-600"
                    >
                        <Plus className="mr-2 h-4 w-4" />
                        Nova Chave
                    </Button>
                </div>

                {isLoadingKeys ? (
                    <div className="text-center py-10">
                        <Loader2 className="h-8 w-8 animate-spin text-yellow-500 mx-auto mb-4" />
                        <p className="text-gray-400">Carregando chaves...</p>
                    </div>
                ) : !keys || keys.length === 0 ? (
                    <div className="text-center py-10">
                        <Key className="h-12 w-12 text-gray-600 mx-auto mb-4" />
                        <p className="text-gray-400 text-lg">Nenhuma chave criada ainda.</p>
                        <p className="text-gray-500 text-sm mt-2">Crie sua primeira chave para liberar o acesso ao app de validação.</p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <Table className="w-full min-w-[800px]">
                            <TableHeader>
                                <TableRow className="border-b border-yellow-500/20 text-sm hover:bg-black/40">
                                    <TableHead className="text-left text-gray-400 font-semibold py-3">Colaborador</TableHead>
                                    <TableHead className="text-left text-gray-400 font-semibold py-3">Evento</TableHead>
                                    <TableHead className="text-center text-gray-400 font-semibold py-3">Status</TableHead>
                                    <TableHead className="text-center text-gray-400 font-semibold py-3">Expiração</TableHead>
                                    <TableHead className="text-center text-gray-400 font-semibold py-3">Último Uso</TableHead>
                                    <TableHead className="text-right text-gray-400 font-semibold py-3">Ações</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {keys.map((key) => {
                                    const isRevealed = revealedKeys.has(key.id);
                                    const isExpired = key.expires_at && new Date(key.expires_at) < new Date();
                                    // Buscar a chave no estado local (se foi criada nesta sessão)
                                    const apiKeyToShow = storedApiKeys.get(key.id) || key.api_key;

                                    return (
                                        <TableRow key={key.id} className="border-b border-yellow-500/10 hover:bg-black/40 text-sm">
                                            <TableCell className="py-4">
                                                <div className="text-white font-medium">{key.name}</div>
                                                
                                                {/* Chave de acesso (só aparece quando revelada) */}
                                                {apiKeyToShow && isRevealed && (
                                                    <div className="mt-2 flex items-center space-x-2">
                                                        <code className="text-xs bg-black/60 px-2 py-1 rounded text-yellow-500 font-mono break-all">
                                                            {apiKeyToShow}
                                                        </code>
                                                        <Button
                                                            size="sm"
                                                            variant="ghost"
                                                            onClick={async () => await copyToClipboard(apiKeyToShow)}
                                                            className="h-6 w-6 p-0 text-yellow-500 hover:text-yellow-400 flex-shrink-0"
                                                            title="Copiar chave"
                                                        >
                                                            <Copy className="h-3 w-3" />
                                                        </Button>
                                                    </div>
                                                )}
                                                
                                                {/* Botão para mostrar chave (só aparece se a chave existir mas não estiver revelada) */}
                                                {!isRevealed && apiKeyToShow && (
                                                    <div className="mt-2">
                                                        <Button
                                                            size="sm"
                                                            variant="ghost"
                                                            onClick={() => setRevealedKeys(new Set([...revealedKeys, key.id]))}
                                                            className="h-6 text-xs text-yellow-500 hover:text-yellow-400"
                                                            title="Mostrar chave"
                                                        >
                                                            <Eye className="h-3 w-3 mr-1" />
                                                            Mostrar chave
                                                        </Button>
                                                    </div>
                                                )}
                                                
                                                {/* URL do Validador - SEMPRE VISÍVEL */}
                                                {key.is_active && (
                                                    <div className="mt-3 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
                                                        <div className="flex items-center justify-between mb-2">
                                                            <span className="text-xs font-semibold text-yellow-500">URL do Validador:</span>
                                                        </div>
                                                        <a 
                                                            href="/validator" 
                                                            target="_blank" 
                                                            rel="noopener noreferrer" 
                                                            className="text-sm text-blue-400 hover:text-blue-300 hover:underline font-mono break-all block mb-3"
                                                        >
                                                            {`${window.location.origin}/validator`}
                                                        </a>
                                                        
                                                        {/* Botões de Compartilhamento */}
                                                        {apiKeyToShow && (
                                                            <div className="space-y-2">
                                                                <div className="text-xs text-gray-400 mb-1">Chave de acesso: <span className="font-mono text-yellow-500">{apiKeyToShow}</span></div>
                                                                <div className="flex gap-2">
                                                                    <Button
                                                                        size="sm"
                                                                        variant="outline"
                                                                        onClick={async () => await copyToClipboard(apiKeyToShow)}
                                                                        className="flex-1 text-xs bg-black/60 border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10"
                                                                        title="Copiar chave"
                                                                    >
                                                                        <Copy className="h-3 w-3 mr-1" />
                                                                        Copiar Chave
                                                                    </Button>
                                                                    <Button
                                                                        size="sm"
                                                                        variant="outline"
                                                                        onClick={() => {
                                                                            const message = `Chave de acesso para validação: ${apiKeyToShow}\n\nAcesse: ${window.location.origin}/validator`;
                                                                            const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(message)}`;
                                                                            window.open(whatsappUrl, '_blank');
                                                                        }}
                                                                        className="flex-1 text-xs bg-green-500/20 border-green-500/30 text-green-400 hover:bg-green-500/30"
                                                                        title="Compartilhar via WhatsApp"
                                                                    >
                                                                        <MessageCircle className="h-3 w-3 mr-1" />
                                                                        WhatsApp
                                                                    </Button>
                                                                    <Button
                                                                        size="sm"
                                                                        variant="outline"
                                                                        onClick={() => {
                                                                            const message = `Chave de acesso: ${apiKeyToShow}\nAcesse: ${window.location.origin}/validator`;
                                                                            const smsUrl = `sms:?body=${encodeURIComponent(message)}`;
                                                                            window.location.href = smsUrl;
                                                                        }}
                                                                        className="flex-1 text-xs bg-blue-500/20 border-blue-500/30 text-blue-400 hover:bg-blue-500/30"
                                                                        title="Compartilhar via SMS"
                                                                    >
                                                                        <Share2 className="h-3 w-3 mr-1" />
                                                                        SMS
                                                                    </Button>
                                                                </div>
                                                            </div>
                                                        )}
                                                        {!apiKeyToShow && (
                                                            <p className="text-xs text-gray-500 text-center">
                                                                Revele a chave para compartilhar
                                                            </p>
                                                        )}
                                                    </div>
                                                )}
                                            </TableCell>
                                            <TableCell className="py-4">
                                                <span className="text-gray-300">
                                                    {key.event_title || 'Todos os eventos'}
                                                </span>
                                            </TableCell>
                                            <TableCell className="text-center py-4">
                                                <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
                                                    !key.is_active || isExpired
                                                        ? 'bg-red-500/20 text-red-400'
                                                        : 'bg-green-500/20 text-green-400'
                                                }`}>
                                                    {!key.is_active ? 'Desativada' : isExpired ? 'Expirada' : 'Ativa'}
                                                </span>
                                            </TableCell>
                                            <TableCell className="text-center py-4">
                                                {key.expires_at ? (
                                                    <span className={`text-xs ${
                                                        isExpired ? 'text-red-400' : 'text-gray-400'
                                                    }`}>
                                                        {format(new Date(key.expires_at), 'dd/MM/yyyy', { locale: ptBR })}
                                                    </span>
                                                ) : (
                                                    <span className="text-xs text-gray-500">Sem expiração</span>
                                                )}
                                            </TableCell>
                                            <TableCell className="text-center py-4">
                                                {key.last_used_at ? (
                                                    <span className="text-xs text-gray-400">
                                                        {format(new Date(key.last_used_at), 'dd/MM/yyyy HH:mm', { locale: ptBR })}
                                                    </span>
                                                ) : (
                                                    <span className="text-xs text-gray-500">Nunca usado</span>
                                                )}
                                            </TableCell>
                                            <TableCell className="text-right py-4">
                                                <div className="flex items-center justify-end space-x-2">
                                                    {key.api_key && !isRevealed && (
                                                        <Button
                                                            size="sm"
                                                            variant="ghost"
                                                            onClick={() => setRevealedKeys(new Set([...revealedKeys, key.id]))}
                                                            className="h-8 text-yellow-500 hover:text-yellow-400"
                                                            title="Mostrar chave"
                                                        >
                                                            <Eye className="h-4 w-4" />
                                                        </Button>
                                                    )}
                                                    <Button
                                                        size="sm"
                                                        variant="ghost"
                                                        onClick={() => handleEditKey(key)}
                                                        className="h-8 text-yellow-500 hover:text-yellow-400"
                                                        title="Editar chave"
                                                    >
                                                        <Edit className="h-4 w-4" />
                                                    </Button>
                                                    <Button
                                                        size="sm"
                                                        variant="ghost"
                                                        onClick={() => {
                                                            setSelectedApiKeyId(key.id);
                                                            setShowLogsDialog(true);
                                                        }}
                                                        className="h-8 text-blue-500 hover:text-blue-400"
                                                        title="Ver logs"
                                                    >
                                                        <History className="h-4 w-4" />
                                                    </Button>
                                                    <Button
                                                        size="sm"
                                                        variant="ghost"
                                                        onClick={() => handleToggleActive(key.id, key.is_active)}
                                                        className={`h-8 ${
                                                            key.is_active
                                                                ? 'text-red-500 hover:text-red-400'
                                                                : 'text-green-500 hover:text-green-400'
                                                        }`}
                                                        title={key.is_active ? 'Desativar' : 'Ativar'}
                                                    >
                                                        {key.is_active ? <XCircle className="h-4 w-4" /> : <CheckCircle className="h-4 w-4" />}
                                                    </Button>
                                                    <Button
                                                        size="sm"
                                                        variant="ghost"
                                                        onClick={() => handleDeleteKey(key.id)}
                                                        className="h-8 text-red-500 hover:text-red-400"
                                                        title="Excluir"
                                                    >
                                                        <Trash2 className="h-4 w-4" />
                                                    </Button>
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

            {/* Dialog de Criação */}
            <Dialog open={showCreateDialog} onOpenChange={() => {
                // Não permite fechar ao clicar fora ou pressionar ESC
                // Só fecha quando o botão Cancelar for clicado
            }}>
                <DialogContent 
                    className="bg-black border border-yellow-500/30 text-white max-w-md"
                    onInteractOutside={(e) => {
                        // Previne o fechamento ao clicar fora
                        e.preventDefault();
                    }}
                    onEscapeKeyDown={(e) => {
                        // Previne o fechamento com ESC
                        e.preventDefault();
                    }}
                >
                    <DialogHeader>
                        <DialogTitle className="text-yellow-500">Nova Chave de Acesso</DialogTitle>
                        <DialogDescription className="text-gray-400">
                            Crie uma chave de acesso para liberar o uso do aplicativo de validação de ingressos.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-300 mb-2">
                                Nome do Colaborador/Operador *
                            </label>
                            <Input
                                value={newKeyName}
                                onChange={(e) => setNewKeyName(e.target.value)}
                                placeholder="Ex: João Silva - Portaria"
                                className="bg-black/60 border-yellow-500/30 text-white"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-300 mb-2">
                                Evento Específico *
                            </label>
                            <Select 
                                value={newKeyEventId || undefined} 
                                onValueChange={(value) => setNewKeyEventId(value || '')}
                            >
                                <SelectTrigger className="bg-black/60 border-yellow-500/30 text-white">
                                    <SelectValue placeholder="Selecione um evento" />
                                </SelectTrigger>
                                <SelectContent className="bg-black border-yellow-500/30 text-white">
                                    {events && events.length > 0 ? (
                                        events.map((event) => (
                                            <SelectItem key={event.id} value={event.id}>
                                                {event.title} {event.date ? `(${format(new Date(event.date), 'dd/MM/yyyy', { locale: ptBR })})` : ''}
                                            </SelectItem>
                                        ))
                                    ) : (
                                        <SelectItem value="no-events" disabled>
                                            Nenhum evento disponível
                                        </SelectItem>
                                    )}
                                </SelectContent>
                            </Select>
                            {!newKeyEventId && (
                                <p className="text-xs text-yellow-400 mt-1">
                                    * É obrigatório selecionar um evento. A chave expirará automaticamente quando o evento terminar.
                                </p>
                            )}
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-300 mb-2">
                                Data de Expiração *
                            </label>
                            <Input
                                type="datetime-local"
                                value={newKeyExpiresAt}
                                readOnly
                                className="bg-black/40 border-yellow-500/30 text-gray-400 cursor-not-allowed"
                                placeholder="Será preenchida automaticamente ao selecionar o evento"
                            />
                            {newKeyEventId && newKeyExpiresAt && (
                                <p className="text-xs text-gray-400 mt-1">
                                    Data calculada automaticamente com base na data e duração do evento selecionado.
                                </p>
                            )}
                        </div>
                        <div className="p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg text-xs text-gray-300">
                            <AlertTriangle className="h-4 w-4 inline mr-2 text-yellow-500" />
                            <strong>Importante:</strong> A chave será exibida apenas uma vez. Certifique-se de copiá-la e compartilhá-la com segurança.
                        </div>
                    </div>
                    <DialogFooter>
                        <Button
                        variant="outline"
                        onClick={() => setShowCreateDialog(false)}
                        className="bg-black/60 border-yellow-500/30 text-yellow-500"
                        >
                            Cancelar
                        </Button>
                        <Button
                            onClick={handleCreateKey}
                            className="bg-yellow-500 text-black hover:bg-yellow-600"
                        >
                            Criar Chave
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Dialog de Edição */}
            <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
                <DialogContent className="bg-black border border-yellow-500/30 text-white max-w-md">
                    <DialogHeader>
                        <DialogTitle className="text-yellow-500">Editar Chave de Acesso</DialogTitle>
                        <DialogDescription className="text-gray-400">
                            Altere as informações da chave de acesso.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-300 mb-2">
                                Nome do Colaborador/Operador *
                            </label>
                            <Input
                                value={editKeyName}
                                onChange={(e) => setEditKeyName(e.target.value)}
                                placeholder="Ex: João Silva - Portaria"
                                className="bg-black/60 border-yellow-500/30 text-white"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-300 mb-2">
                                Evento Específico *
                            </label>
                            <Select 
                                value={editKeyEventId || undefined} 
                                onValueChange={(value) => setEditKeyEventId(value || '')}
                            >
                                <SelectTrigger className="bg-black/60 border-yellow-500/30 text-white">
                                    <SelectValue placeholder="Selecione um evento" />
                                </SelectTrigger>
                                <SelectContent className="bg-black border-yellow-500/30 text-white">
                                    {events && events.length > 0 ? (
                                        events.map((event) => (
                                            <SelectItem key={event.id} value={event.id}>
                                                {event.title} {event.date ? `(${format(new Date(event.date), 'dd/MM/yyyy', { locale: ptBR })})` : ''}
                                            </SelectItem>
                                        ))
                                    ) : (
                                        <SelectItem value="no-events" disabled>
                                            Nenhum evento disponível
                                        </SelectItem>
                                    )}
                                </SelectContent>
                            </Select>
                            {!editKeyEventId && (
                                <p className="text-xs text-yellow-400 mt-1">
                                    * É obrigatório selecionar um evento. A chave expirará automaticamente quando o evento terminar.
                                </p>
                            )}
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-300 mb-2">
                                Data de Expiração *
                            </label>
                            <Input
                                type="datetime-local"
                                value={editKeyExpiresAt}
                                readOnly
                                className="bg-black/40 border-yellow-500/30 text-gray-400 cursor-not-allowed"
                                placeholder="Será preenchida automaticamente ao selecionar o evento"
                            />
                            {editKeyEventId && editKeyExpiresAt && (
                                <p className="text-xs text-gray-400 mt-1">
                                    Data calculada automaticamente com base na data e duração do evento selecionado.
                                </p>
                            )}
                        </div>
                    </div>
                    <DialogFooter>
                        <Button
                            variant="outline"
                            onClick={() => {
                                setShowEditDialog(false);
                                setEditingKey(null);
                            }}
                            className="bg-black/60 border-yellow-500/30 text-yellow-500"
                        >
                            Cancelar
                        </Button>
                        <Button
                            onClick={handleSaveEdit}
                            className="bg-yellow-500 text-black hover:bg-yellow-600"
                        >
                            Salvar Alterações
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Dialog de Logs */}
            <Dialog open={showLogsDialog} onOpenChange={setShowLogsDialog}>
                <DialogContent className="bg-black border border-yellow-500/30 text-white max-w-4xl max-h-[80vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle className="text-yellow-500">Logs de Validação</DialogTitle>
                        <DialogDescription className="text-gray-400">
                            Histórico de validações realizadas com esta chave.
                        </DialogDescription>
                    </DialogHeader>
                    {isLoadingLogs ? (
                        <div className="text-center py-10">
                            <Loader2 className="h-8 w-8 animate-spin text-yellow-500 mx-auto mb-4" />
                            <p className="text-gray-400">Carregando logs...</p>
                        </div>
                    ) : !logs || logs.length === 0 ? (
                        <div className="text-center py-10">
                            <History className="h-12 w-12 text-gray-600 mx-auto mb-4" />
                            <p className="text-gray-400">Nenhum log encontrado.</p>
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow className="border-b border-yellow-500/20">
                                        <TableHead className="text-gray-400">Data/Hora</TableHead>
                                        <TableHead className="text-gray-400">Código</TableHead>
                                        <TableHead className="text-gray-400">Tipo</TableHead>
                                        <TableHead className="text-gray-400">Status</TableHead>
                                        <TableHead className="text-gray-400">Mensagem</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {logs.map((log) => (
                                        <TableRow key={log.id} className="border-b border-yellow-500/10">
                                            <TableCell className="text-xs text-gray-400">
                                                {format(new Date(log.created_at), 'dd/MM/yyyy HH:mm:ss', { locale: ptBR })}
                                            </TableCell>
                                            <TableCell className="font-mono text-xs text-yellow-500">
                                                {log.wristband_code}
                                            </TableCell>
                                            <TableCell className="text-xs text-gray-300">
                                                {log.validation_type === 'entry' ? 'Entrada' : 'Saída'}
                                            </TableCell>
                                            <TableCell>
                                                <span className={`text-xs font-semibold ${getStatusColor(log.validation_status)}`}>
                                                    {log.validation_status}
                                                </span>
                                            </TableCell>
                                            <TableCell className="text-xs text-gray-400">
                                                {log.validation_message}
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    )}
                </DialogContent>
            </Dialog>
        </div>
    );
};

export default ManagerValidationKeys;

