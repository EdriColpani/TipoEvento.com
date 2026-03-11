import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input"; 
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, Loader2, QrCode, Tag, Clock, AlertTriangle, CheckCircle, XCircle, RefreshCw, Search, Save, DollarSign } from 'lucide-react';
import { showSuccess, showError, showLoading, dismissToast } from '@/utils/toast';
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import QrCodeModal from '@/components/QrCodeModal';

// Tipos de dados para a pulseira e analytics
interface WristbandDetails {
    id: string;
    code: string;
    access_type: string;
    status: 'active' | 'used' | 'lost' | 'cancelled' | 'pending'; // NOVO: Adicionado 'pending'
    created_at: string;
    manager_user_id: string;
    events: { title: string; date: string } | null;
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
            events!event_id (title, date)
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
    const { data, isLoading, isError, invalidate, refetch } = useWristbandManagement(id);
    const [newStatus, setNewStatus] = useState<WristbandDetails['status'] | string>('');
    const [newPrice, setNewPrice] = useState<string>(''); 
    const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [isQrCodeModalOpen, setIsQrCodeModalOpen] = useState(false);
    const [selectedAnalyticsEntry, setSelectedAnalyticsEntry] = useState<AnalyticsEntry | null>(null); 

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
            showSuccess(`Status e/ou Preço atualizados com sucesso! ${isMassOperation ? `(${updateCount} pulseiras do evento foram desativadas)` : ''}`);
            
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

    if (isLoading) {
        return (
            <div className="max-w-7xl mx-auto text-center py-20">
                <Loader2 className="h-10 w-10 animate-spin text-yellow-500 mx-auto mb-4" />
                <p className="text-gray-400">Carregando detalhes da pulseira...</p>
            </div>
        );
    }

    if (isError || !data?.details) {
        return (
            <div className="max-w-7xl mx-auto text-center py-20">
                <AlertTriangle className="h-10 w-10 text-red-500 mx-auto mb-4" />
                <p className="text-red-400">Pulseira não encontrada ou erro de carregamento.</p>
                <Button onClick={() => navigate('/manager/wristbands')} className="mt-4 bg-yellow-500 text-black hover:bg-yellow-600">
                    Voltar para a Lista
                </Button>
            </div>
        );
    }

    const { details, analytics } = data;
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
                    Gerenciar Pulseira: <span className="ml-2 text-white">{details.code}</span>
                </h1>
                <Button 
                    onClick={() => navigate('/manager/wristbands')}
                    variant="outline"
                    className="bg-black/60 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 text-sm"
                >
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Voltar para a Lista
                </Button>
            </div>

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
                                Valor da Pulseira
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
                                    disabled={isUpdatingStatus}
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
                                <Select onValueChange={setNewStatus} value={newStatus}>
                                    <SelectTrigger className="w-full bg-black/60 border-yellow-500/30 text-white focus:ring-yellow-500 h-10">
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
                                        Atenção: Mudar o status de uma pulseira ATIVA para {newStatus === 'lost' ? 'PERDIDA' : 'CANCELADA'} 
                                        resultará na desativação de TODAS as pulseiras deste evento, se nenhuma tiver sido vendida.
                                    </p>
                                </div>
                            )}

                            {/* Botões de Ação (Ajustados) */}
                            <div className="flex space-x-4 pt-2">
                                <Button
                                    onClick={handleStatusUpdate}
                                    disabled={isUpdatingStatus || !hasChanges}
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
                        
                        {/* Campo de Pesquisa */}
                        <div className="relative mb-6">
                            <Input 
                                type="search" 
                                placeholder="Pesquisar por código da pulseira ou tipo de evento..." 
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
                                            <TableHead className="text-center text-gray-400 font-semibold py-3 w-[15%]">Nº Pulseira</TableHead>
                                            <TableHead className="text-left text-gray-400 font-semibold py-3 w-[20%]">Código Pulseira</TableHead>
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
                                                        <Button
                                                            variant="outline"
                                                            size="sm"
                                                            className="bg-black/60 border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 h-8 px-3"
                                                            onClick={() => {
                                                                setSelectedAnalyticsEntry(entry);
                                                                setIsQrCodeModalOpen(true);
                                                            }}
                                                        >
                                                            <QrCode className="h-4 w-4" />
                                                        </Button>
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
                />
            )}
        </div>
    );
};

export default ManagerManageWristband;