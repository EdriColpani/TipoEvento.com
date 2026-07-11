import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input"; 
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, Loader2, QrCode, Tag, Clock, AlertTriangle, CheckCircle, XCircle, RefreshCw, Search, Save, DollarSign, Printer, ShieldOff } from 'lucide-react';
import { parseEdgeFunctionError } from '@/utils/edge-function-error';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from '@/components/ui/dialog';
import PrintableTicketSheet from '@/components/PrintableTicketSheet';
import { showSuccess, showError, showLoading, dismissToast } from '@/utils/toast';
import { supabase } from '@/integrations/supabase/client';
import { usePageAuth } from '@/hooks/use-page-auth';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import QrCodeModal from '@/components/QrCodeModal';
import { useProfile } from '@/hooks/use-profile';
import { isEventLifecycleEnded } from '@/utils/event-lifecycle';

const ADMIN_MASTER_USER_TYPE_ID = 1;

// Tipos de dados para a pulseira e analytics
interface WristbandDetails {
    id: string;
    code: string;
    access_type: string;
    status: 'active' | 'used' | 'lost' | 'cancelled' | 'pending'; // NOVO: Adicionado 'pending'
    created_at: string;
    manager_user_id: string;
    events: { title: string; date: string; time?: string | null; lifecycle_ended_at?: string | null; allow_printed_tickets?: boolean } | null;
    company_id: string;
    event_id: string; // Adicionando event_id para uso na lógica de atualização em massa
    price: number; // NOVO: Preço da pulseira
}

interface AnalyticsEntry {
    id: string;
    event_type: string;
    event_data: any;
    created_at: string;
    code_wristbands: string;
    status: 'active' | 'used' | 'lost' | 'cancelled' | 'pending'; // NOVO: Adicionado 'pending'
    client_user_id?: string | null;
    sequential_number: number | null; // Novo campo
}

const STATUS_OPTIONS = [
    { value: 'active', label: 'Ativa', icon: CheckCircle, color: 'text-green-500' },
    { value: 'pending', label: 'Pendente Pagamento', icon: AlertTriangle, color: 'text-yellow-500' }, // NOVO
    { value: 'used', label: 'Utilizada', icon: XCircle, color: 'text-gray-500' },
    { value: 'lost', label: 'Perdida', icon: AlertTriangle, color: 'text-red-500' },
    { value: 'cancelled', label: 'Cancelada', icon: XCircle, color: 'text-red-500' },
];

// Hook para buscar detalhes da pulseira e analytics
const fetchWristbandData = async (id: string): Promise<{ details: WristbandDetails, analytics: AnalyticsEntry[] }> => {
    // 1. Buscar detalhes da pulseira
    // Especificando relacionamento explícito via event_id para evitar erro PGRST201
    const { data: detailsData, error: detailsError } = await supabase
        .from('wristbands')
        .select(`
            id, code, access_type, status, created_at, manager_user_id, company_id, event_id, price,
            events!event_id (title, date, time, lifecycle_ended_at, allow_printed_tickets)
        `)
        .eq('id', id)
        .single();

    if (detailsError) throw detailsError;

    // 2. Buscar histórico de analytics
    const { data: analyticsData, error: analyticsError } = await supabase
        .from('wristband_analytics')
        .select(`
            *,
            sequential_number
        `) // Incluindo sequential_number
        .eq('wristband_id', id)
        .order('created_at', { ascending: false });

    if (analyticsError) throw analyticsError;

    // Normalizar eventos: garantir que seja um objeto único ou null, não array
    const normalizedDetails: WristbandDetails = {
        ...detailsData,
        events: Array.isArray(detailsData.events) 
            ? (detailsData.events[0] || null) 
            : (detailsData.events || null),
    } as WristbandDetails;

    return {
        details: normalizedDetails,
        analytics: analyticsData as AnalyticsEntry[],
    };
};

const useWristbandManagement = (id: string | undefined) => {
    const queryClient = useQueryClient();
    const query = useQuery<{ details: WristbandDetails, analytics: AnalyticsEntry[] }>({
        queryKey: ['wristbandManagement', id],
        queryFn: () => fetchWristbandData(id!),
        enabled: !!id,
        staleTime: 1000 * 10, // Manter dados frescos por 10 segundos
        // Removido onError - usar try/catch no queryFn ou tratar erro no componente
    });

    return {
        ...query,
        invalidate: () => queryClient.invalidateQueries({ queryKey: ['wristbandManagement', id] }),
        refetch: query.refetch, // Expondo o refetch
    };
};

// Função utilitária para formatar a entrada do usuário (apenas dígitos e vírgula, limitando a 2 casas decimais)
const formatPriceInput = (value: string): string => {
    // 1. Remove tudo que não for dígito ou vírgula
    let cleanValue = value.replace(/[^\d,]/g, '');
    
    // 2. Garante que haja no máximo uma vírgula
    const parts = cleanValue.split(',');
    if (parts.length > 2) {
        cleanValue = parts[0] + ',' + parts.slice(1).join('');
    }
    
    // 3. Limita a 2 casas decimais após a vírgula
    if (parts.length > 0 && cleanValue.includes(',')) {
        const decimalPart = cleanValue.split(',')[1];
        if (decimalPart && decimalPart.length > 2) {
            cleanValue = cleanValue.split(',')[0] + ',' + decimalPart.substring(0, 2);
        }
    }

    return cleanValue;
};


const ManagerManageWristband: React.FC = () => {
    const navigate = useNavigate();
    const { id } = useParams<{ id: string }>();
    const { userId, authPending } = usePageAuth();
    const { profile } = useProfile(userId);
    const isAdminMaster = profile?.tipo_usuario_id === ADMIN_MASTER_USER_TYPE_ID;
    const { data, isLoading, isError, invalidate, refetch } = useWristbandManagement(id);
    const [newStatus, setNewStatus] = useState<WristbandDetails['status'] | string>('');
    const [newPrice, setNewPrice] = useState<string>(''); 
    const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [isQrCodeModalOpen, setIsQrCodeModalOpen] = useState(false);
    const [printEntry, setPrintEntry] = useState<AnalyticsEntry | null>(null);
    const [selectedAnalyticsEntry, setSelectedAnalyticsEntry] = useState<AnalyticsEntry | null>(null);
    const [revokingAnalyticsId, setRevokingAnalyticsId] = useState<string | null>(null);

    const canRevokeAppQr = (entry: AnalyticsEntry) =>
        entry.status === 'active' &&
        ['purchase', 'checkout_pending', 'creation'].includes(entry.event_type);

    const handleRevokeAppQr = async (entry: AnalyticsEntry) => {
        if (!canRevokeAppQr(entry)) return;
        const confirmed = window.confirm(
            'Invalidar o QR do aplicativo deste ingresso?\n\nO cliente precisará abrir o ingresso no app de novo. O ingresso impresso (se houver) continua com o QR fixo até ser usado na entrada.',
        );
        if (!confirmed) return;

        setRevokingAnalyticsId(entry.id);
        const toastId = showLoading('Invalidando QR do app…');
        try {
            const { data, error } = await supabase.functions.invoke('revoke-entry-qr', {
                body: { analyticsId: entry.id },
            });
            if (error) {
                throw new Error(await parseEdgeFunctionError(error, data));
            }
            showSuccess(
                (data as { message?: string })?.message ?? 'QR do aplicativo invalidado.',
            );
            await invalidate();
        } catch (e: unknown) {
            showError(e instanceof Error ? e.message : 'Não foi possível invalidar o QR.');
        } finally {
            dismissToast(toastId);
            setRevokingAnalyticsId(null);
        }
    };

    useEffect(() => {
        if (data?.details) {
            setNewStatus(data.details.status);
            // Formata o preço para exibição (ex: 150.00 -> 150,00)
            setNewPrice(data.details.price.toFixed(2).replace('.', ','));
        }
    }, [data]);
    
    const handlePriceChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const formattedPrice = formatPriceInput(e.target.value);
        setNewPrice(formattedPrice);
    };
    
    const handlePriceBlur = () => {
        // Converte para float usando ponto, e formata para duas casas decimais com vírgula
        const numericValue = parseFloat(newPrice.replace(',', '.') || '0');
        if (isNaN(numericValue)) {
            setNewPrice('0,00');
        } else {
            setNewPrice(numericValue.toFixed(2).replace('.', ','));
        }
    };

    const handleStatusUpdate = async () => {
        if (!id || !data?.details) return;

        const ev = data.details.events;
        const eventEnded =
            Boolean(ev?.lifecycle_ended_at) || isEventLifecycleEnded(ev?.date, ev?.time);
        if (eventEnded && !isAdminMaster) {
            showError('Evento encerrado: alterações só pelo administrador.');
            return;
        }
        
        const statusChanged = newStatus !== data.details.status;
        
        // Converte o preço de volta para float (usando ponto) para salvar no DB
        const priceNumeric = parseFloat(newPrice.replace(',', '.') || '0');
        const priceChanged = priceNumeric !== data.details.price;

        if (!statusChanged && !priceChanged) {
            showError("Nenhuma alteração detectada. Altere o status ou o preço.");
            return;
        }
        
        // Validação básica do preço
        if (isNaN(priceNumeric) || priceNumeric < 0) {
            showError("Preço inválido. Insira um valor numérico positivo.");
            return;
        }

        // Verifica se a operação é uma desativação em massa (de 'active' para 'lost' ou 'cancelled')
        const isMassDeactivation = statusChanged && data.details.status === 'active' && (newStatus === 'lost' || newStatus === 'cancelled');
        const eventId = data.details.event_id;

        
        setIsUpdatingStatus(true);
        const toastId = showLoading("Gravando alterações...");

        try {
            let updateCount = 1;
            let isMassOperation = false;
            
            if (isMassDeactivation) {
                // Se for desativação em massa, usamos a Edge Function
                const { data: edgeData, error: edgeError } = await supabase.functions.invoke('update-wristband-status-mass', {
                    body: {
                        event_id: eventId,
                        new_status: newStatus,
                    },
                });

                if (edgeError) {
                    throw new Error(edgeError.message);
                }
                
                if (edgeData.error) {
                    throw new Error(edgeData.error);
                }

                updateCount = edgeData.count || 0;
                isMassOperation = true;

            } else {
                // Se for atualização individual (incluindo status e/ou preço)
                
                const updatePayload: Partial<WristbandDetails> = {};
                if (statusChanged) {
                    updatePayload.status = newStatus as WristbandDetails['status'];
                }
                if (priceChanged) {
                    updatePayload.price = priceNumeric;
                }
                
                // 1. Atualizar status/preço na tabela principal (wristbands)
                const { error: updateWristbandError } = await supabase
                    .from('wristbands')
                    .update(updatePayload)
                    .eq('id', id);

                if (updateWristbandError) throw updateWristbandError;

                // 2. Se o status mudou, atualizar status na tabela de analytics
                if (statusChanged) {
                    const { error: updateAnalyticsError } = await supabase
                        .from('wristband_analytics')
                        .update({ status: newStatus })
                        .eq('wristband_id', id);
                    
                    if (updateAnalyticsError) {
                        console.error("Warning: Failed to update status in analytics table:", updateAnalyticsError);
                    }
                }
            }

            dismissToast(String(toastId));
            showSuccess(`Status e/ou Preço atualizados com sucesso! ${isMassOperation ? `(${updateCount} ingressos do evento foram desativados)` : ''}`);
            
            // Força a re-busca dos dados para refletir a mudança na grade de analytics e nos detalhes
            refetch(); 

        } catch (e: any) {
            dismissToast(String(toastId));
            console.error("Update error:", e);
            showError(`Falha ao gravar alterações: ${e.message || 'Erro desconhecido'}`);
        } finally {
            setIsUpdatingStatus(false);
        }
    };
    
    // Função auxiliar para obter o status do evento de analytics
    const getAnalyticsStatus = (entry: AnalyticsEntry) => {
        // Regra de negócio para gestão:
        // se já existe cliente vinculado, consideramos "vendido" na visão operacional.
        if (entry.client_user_id) return 'used';
        return entry.status || 'N/A';
    };

    const getStatusClasses = (status: string) => {
        switch (status) {
            case 'active': return 'bg-green-500/20 text-green-400';
            case 'used': return 'bg-gray-500/20 text-gray-400';
            case 'lost': return 'bg-red-500/20 text-red-400';
            case 'cancelled': return 'bg-red-500/20 text-red-400';
            case 'pending': return 'bg-yellow-500/20 text-yellow-400'; // NOVO
            default: return 'bg-yellow-500/20 text-yellow-400';
        }
    };

    if (authPending) {
        return (
            <div className="max-w-7xl mx-auto text-center py-20">
                <Loader2 className="h-10 w-10 animate-spin text-yellow-500 mx-auto mb-4" />
                <p className="text-gray-400">Verificando autenticação…</p>
            </div>
        );
    }

    if (isLoading) {
        return (
            <div className="max-w-7xl mx-auto text-center py-20">
                <Loader2 className="h-10 w-10 animate-spin text-yellow-500 mx-auto mb-4" />
                <p className="text-gray-400">Carregando detalhes do ingresso...</p>
            </div>
        );
    }

    if (isError || !data?.details) {
        return (
            <div className="max-w-7xl mx-auto text-center py-20">
                <AlertTriangle className="h-10 w-10 text-red-500 mx-auto mb-4" />
                <p className="text-red-400">Ingresso não encontrado ou erro de carregamento.</p>
                <Button onClick={() => navigate('/manager/wristbands')} className="mt-4 bg-yellow-500 text-black hover:bg-yellow-600">
                    Voltar para a Lista
                </Button>
            </div>
        );
    }

    const { details, analytics } = data;
    const eventEnded =
        Boolean(details.events?.lifecycle_ended_at) ||
        isEventLifecycleEnded(details.events?.date, details.events?.time);
    const editsLocked = eventEnded && !isAdminMaster;
    const currentStatusOption = STATUS_OPTIONS.find(opt => opt.value === details.status);
    
    // Filtragem dos analytics
    const filteredAnalytics = analytics.filter(entry => 
        entry.event_type.toLowerCase().includes(searchTerm.toLowerCase()) ||
        entry.code_wristbands?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        JSON.stringify(entry.event_data).toLowerCase().includes(searchTerm.toLowerCase())
    );

    // Componente auxiliar para exibir a linha de informação
    const InfoRow: React.FC<{ label: string, value: React.ReactNode }> = ({ label, value }) => (
        <div className="flex justify-between items-center">
            <span className="text-gray-400">{label}:</span>
            <span className="text-white font-medium text-right truncate max-w-[60%]">{value}</span>
        </div>
    );
    
    // Verifica se houve alguma alteração para habilitar o botão de salvar
    const priceNumeric = parseFloat(newPrice.replace(',', '.') || '0');
    const hasChanges = newStatus !== details.status || priceNumeric !== details.price;


    const translateStatus = (status: string) => {
        switch (status) {
            case 'used': return 'Vendido';
            case 'active': return 'Ativo';
            case 'lost': return 'Perdido';
            case 'cancelled': return 'Cancelado';
            case 'pending': return 'Pendente';
            default: return status.charAt(0).toUpperCase() + status.slice(1);
        }
    };

    return (
        <div className="max-w-7xl mx-auto">
            <div className="flex items-center justify-between mb-8">
                <h1 className="text-2xl sm:text-3xl font-serif text-yellow-500 flex items-center">
                    <QrCode className="h-7 w-7 mr-3" />
                    Gerenciar Ingresso: <span className="ml-2 text-white">{details.code}</span>
                </h1>
                <Button 
                    onClick={() => navigate('/manager/wristbands')}
                    variant="outline"
                    className="bg-black/60 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 text-sm"
                >
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Voltar
                </Button>
            </div>

            {editsLocked && (
                <div className="mb-6 flex items-start gap-3 rounded-xl border border-amber-500/40 bg-amber-950/50 p-4 text-sm text-amber-50">
                    <AlertTriangle className="h-5 w-5 text-amber-300 shrink-0 mt-0.5" />
                    <div>
                        <p className="font-semibold text-white mb-1">Evento encerrado</p>
                        <p className="text-amber-100/90 text-xs leading-relaxed">
                            Este evento já foi realizado (mais de 1 dia após o horário de início). Status e preço
                            não podem ser alterados. Somente o administrador pode editar.
                        </p>
                    </div>
                </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Coluna de Detalhes e Status (CONSOLIDADA) */}
                <div className="lg:col-span-1 space-y-6">
                    <Card className="bg-black border border-yellow-500/30 rounded-2xl shadow-2xl shadow-yellow-500/10 p-6">
                        <CardTitle className="text-white text-xl mb-4 flex items-center">
                            <Tag className="h-5 w-5 mr-2 text-yellow-500" />
                            Informações e Status
                        </CardTitle>
                        
                        {/* Informações Básicas (Layout ajustado) */}
                        <div className="space-y-2 text-sm pb-4 border-b border-yellow-500/10 mb-4">
                            <InfoRow label="Evento" value={details.events?.title || 'N/A'} />
                            <InfoRow label="Tipo de Acesso" value={<span className="text-yellow-500">{details.access_type}</span>} />
                            <InfoRow label="Criação" value={new Date(details.created_at).toLocaleDateString('pt-BR')} />
                            <InfoRow label="Cadastrado por" value={`${details.manager_user_id.substring(0, 8)}...`} />
                        </div>

                        {/* Gerenciamento de Preço */}
                        <div className="space-y-4 pt-4 border-t border-yellow-500/10">
                            <h3 className="text-lg font-semibold text-white flex items-center">
                                <DollarSign className="h-5 w-5 mr-2 text-yellow-500" />
                                Valor do Ingresso
                            </h3>
                            <div>
                                <label htmlFor="price" className="block text-sm font-medium text-gray-400 mb-2">Preço Atual (R$)</label>
                                <Input 
                                    id="price" 
                                    type="text"
                                    value={newPrice} 
                                    onChange={handlePriceChange} 
                                    onBlur={handlePriceBlur}
                                    placeholder="0,00"
                                    className="bg-black/60 border-yellow-500/30 text-white placeholder-gray-500 focus:border-yellow-500"
                                    disabled={isUpdatingStatus || editsLocked}
                                />
                            </div>
                        </div>

                        {/* Gerenciamento de Status */}
                        <div className="space-y-4 pt-4 border-t border-yellow-500/10">
                            <div className="flex justify-between items-center mb-2">
                                <span className="text-gray-400 text-sm flex items-center">
                                    <RefreshCw className="h-4 w-4 mr-2 text-yellow-500" />
                                    Status Atual:
                                </span>
                                <span className={`px-3 py-1 rounded-full text-xs font-semibold ${currentStatusOption?.color} bg-yellow-500/10`}>
                                    {currentStatusOption?.label}
                                </span>
                            </div>
                            
                            <div>
                                <label htmlFor="status" className="block text-sm font-medium text-white mb-2">Alterar Status</label>
                                <Select onValueChange={setNewStatus} value={newStatus} disabled={editsLocked}>
                                    <SelectTrigger className="w-full bg-black/60 border-yellow-500/30 text-white focus:ring-yellow-500 h-10 disabled:opacity-50">
                                        <SelectValue placeholder="Selecione o novo status" />
                                    </SelectTrigger>
                                    <SelectContent className="bg-black border-yellow-500/30 text-white">
                                        {STATUS_OPTIONS.map(option => (
                                            <SelectItem key={option.value} value={option.value} className="hover:bg-yellow-500/10 cursor-pointer">
                                                <div className="flex items-center">
                                                    <option.icon className={`h-4 w-4 mr-2 ${option.color}`} />
                                                    {option.label}
                                                </div>
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            
                            {/* Aviso de Ação em Massa */}
                            {details.status === 'active' && (newStatus === 'lost' || newStatus === 'cancelled') && (
                                <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-xs text-gray-300 flex items-start space-x-2">
                                    <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0 text-red-400" />
                                    <p>
                                        Atenção: Mudar o status de um ingresso ATIVO para {newStatus === 'lost' ? 'PERDIDO' : 'CANCELADO'} 
                                        resultará na desativação de TODOS os ingressos deste evento, se nenhum tiver sido vendido.
                                    </p>
                                </div>
                            )}

                            {/* Botões de Ação (Ajustados) */}
                            <div className="flex space-x-4 pt-2">
                                <Button
                                    onClick={handleStatusUpdate}
                                    disabled={isUpdatingStatus || !hasChanges || editsLocked}
                                    className="flex-1 bg-yellow-500 text-black hover:bg-yellow-600 py-2 text-base font-semibold transition-all duration-300 cursor-pointer disabled:opacity-50 h-10"
                                >
                                    {isUpdatingStatus ? (
                                        <Loader2 className="w-5 h-5 animate-spin mr-2" />
                                    ) : (
                                        <>
                                            <Save className="w-4 h-4 mr-2" />
                                            Salvar Alterações
                                        </>
                                    )}
                                </Button>
                                <Button
                                    onClick={() => navigate('/manager/wristbands')}
                                    variant="outline"
                                    className="flex-1 bg-black/60 border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 py-2 text-base font-semibold transition-all duration-300 cursor-pointer h-10"
                                    disabled={isUpdatingStatus}
                                >
                                    <ArrowLeft className="w-4 h-4 mr-2" />
                                    Voltar
                                </Button>
                            </div>
                        </div>
                    </Card>
                </div>

                {/* Coluna de Histórico de Analytics (Grid/Tabela) */}
                <div className="lg:col-span-2">
                    <Card className="bg-black border border-yellow-500/30 rounded-2xl shadow-2xl shadow-yellow-500/10 p-6">
                        <CardTitle className="text-white text-xl mb-4 flex items-center">
                            <Clock className="h-5 w-5 mr-2 text-yellow-500" />
                            Histórico de Uso (Analytics)
                        </CardTitle>
                        <CardDescription className="text-gray-400 text-sm mb-4">
                            Rastreamento de entradas, saídas e mudanças de status.
                        </CardDescription>
                        {details.events?.allow_printed_tickets && (
                            <p className="text-sm text-blue-200/90 mb-4 rounded-lg border border-blue-500/30 bg-blue-500/10 p-3">
                                Evento com <strong>ingresso impresso + app</strong>: use Imprimir para QR fixo no
                                papel; o cliente usa QR dinâmico no celular na portaria.
                            </p>
                        )}

                        {/* Campo de Pesquisa */}
                        <div className="relative mb-6">
                            <Input 
                                type="search" 
                                placeholder="Pesquisar por código do ingresso ou tipo de evento..." 
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="bg-black/60 border-yellow-500/30 text-white placeholder-gray-500 focus:border-yellow-500 w-full pl-10 py-3 rounded-xl"
                            />
                            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-yellow-500/60" />
                        </div>

                        <div className="max-h-[500px] overflow-y-auto">
                            {filteredAnalytics.length === 0 ? (
                                <div className="text-center py-8 text-gray-500">
                                    Nenhum registro encontrado.
                                </div>
                            ) : (
                                <Table className="w-full min-w-[600px]">
                                    <TableHeader>
                                        <TableRow className="border-b border-yellow-500/20 text-sm hover:bg-black/40">
                                            <TableHead className="text-left text-gray-400 font-semibold py-3 w-[25%]">Evento</TableHead>
                                            <TableHead className="text-center text-gray-400 font-semibold py-3 w-[15%]">Nº Ingresso</TableHead>
                                            <TableHead className="text-left text-gray-400 font-semibold py-3 w-[20%]">Código Ingresso</TableHead>
                                            <TableHead className="text-center text-gray-400 font-semibold py-3 w-[15%]">Status</TableHead>
                                            <TableHead className="text-right text-gray-400 font-semibold py-3 w-[20%]">Data/Hora</TableHead>
                                            <TableHead className="text-right text-gray-400 font-semibold py-3 w-[15%]">Ações</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {filteredAnalytics.map((entry) => {
                                            const eventTitle = details.events?.title || 'N/A';
                                            const eventDate = details.events?.date || '';
                                            const wristbandCode = entry.code_wristbands || details.code;
                                            const status = getAnalyticsStatus(entry);
                                            const statusClasses = getStatusClasses(status);

                                            return (
                                                <TableRow 
                                                    key={entry.id} 
                                                    className="border-b border-yellow-500/10 hover:bg-black/40 transition-colors text-sm"
                                                >
                                                    <TableCell className="py-3 text-white font-medium truncate max-w-[150px]">
                                                        {eventTitle}
                                                    </TableCell>
                                                    <TableCell className="text-center py-3 text-yellow-500 font-medium">
                                                        {entry.sequential_number !== null ? entry.sequential_number : '-'}
                                                    </TableCell>
                                                    <TableCell className="py-3 text-yellow-500 font-medium">
                                                        {wristbandCode}
                                                    </TableCell>
                                                    <TableCell className="text-center py-3">
                                                        <span className={`px-3 py-1 rounded-full text-xs font-semibold ${statusClasses}`}>
                                                            {translateStatus(status)}
                                                        </span>
                                                    </TableCell>
                                                    <TableCell className="py-3 text-right text-gray-500 text-xs">
                                                        {new Date(entry.created_at).toLocaleString('pt-BR')}
                                                    </TableCell>
                                                    <TableCell className="text-right py-3">
                                                        <div className="flex justify-end gap-1">
                                                            <Button
                                                                variant="outline"
                                                                size="sm"
                                                                className="bg-black/60 border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 h-8 px-2"
                                                                title="Ver QR fixo (impresso/portaria)"
                                                                onClick={() => {
                                                                    setSelectedAnalyticsEntry(entry);
                                                                    setIsQrCodeModalOpen(true);
                                                                }}
                                                            >
                                                                <QrCode className="h-4 w-4" />
                                                            </Button>
                                                            {details.events?.allow_printed_tickets && (
                                                                <Button
                                                                    variant="outline"
                                                                    size="sm"
                                                                    className="bg-black/60 border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 h-8 px-2"
                                                                    title="Imprimir ingresso"
                                                                    onClick={() => setPrintEntry(entry)}
                                                                >
                                                                    <Printer className="h-4 w-4" />
                                                                </Button>
                                                            )}
                                                            {canRevokeAppQr(entry) && (
                                                                <Button
                                                                    variant="outline"
                                                                    size="sm"
                                                                    className="bg-black/60 border-orange-500/40 text-orange-400 hover:bg-orange-500/10 h-8 px-2"
                                                                    title="Invalidar QR do app (screenshot/compartilhamento)"
                                                                    disabled={revokingAnalyticsId === entry.id}
                                                                    onClick={() => handleRevokeAppQr(entry)}
                                                                >
                                                                    {revokingAnalyticsId === entry.id ? (
                                                                        <Loader2 className="h-4 w-4 animate-spin" />
                                                                    ) : (
                                                                        <ShieldOff className="h-4 w-4" />
                                                                    )}
                                                                </Button>
                                                            )}
                                                        </div>
                                                    </TableCell>
                                                </TableRow>
                                            );
                                        })}
                                    </TableBody>
                                </Table>
                            )}
                        </div>
                    </Card>
                </div>
            </div>
            {isQrCodeModalOpen && selectedAnalyticsEntry && (
                <QrCodeModal
                    isOpen={isQrCodeModalOpen}
                    onClose={() => setIsQrCodeModalOpen(false)}
                    eventName={details.events?.title || 'Evento Desconhecido'}
                    eventDate={details.events?.date || ''}
                    wristbandCode={selectedAnalyticsEntry.code_wristbands || details.code}
                    scanValue={selectedAnalyticsEntry.id}
                    singleUseNotice
                />
            )}

            <Dialog open={Boolean(printEntry)} onOpenChange={(open) => !open && setPrintEntry(null)}>
                <DialogContent className="bg-black/95 border border-yellow-500/30 text-white max-w-md">
                    <DialogHeader>
                        <DialogTitle className="text-yellow-400">Imprimir ingresso</DialogTitle>
                        <DialogDescription className="text-gray-400">
                            QR fixo para leitura na portaria (modo impresso).
                        </DialogDescription>
                    </DialogHeader>
                    {printEntry && (
                        <PrintableTicketSheet
                            eventName={details.events?.title || 'Evento'}
                            eventDate={details.events?.date || ''}
                            accessType={details.access_type}
                            wristbandCode={printEntry.code_wristbands || details.code}
                            scanValue={printEntry.id}
                        />
                    )}
                </DialogContent>
            </Dialog>
        </div>
    );
};

export default ManagerManageWristband;