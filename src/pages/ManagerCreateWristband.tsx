import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Loader2, QrCode, Tag, User, Calendar, Hash, DollarSign } from 'lucide-react';
import { showSuccess, showError, showLoading, dismissToast } from '@/utils/toast';
import { supabase } from '@/integrations/supabase/client';
import { useManagerCompany } from '@/hooks/use-manager-company';
import { useManagerEvents, ManagerEvent } from '@/hooks/use-manager-events';

interface WristbandFormData {
    eventId: string;
    baseCode: string; // Código principal da pulseira
    quantity: number; // Quantidade de registros de analytics a gerar
    accessType: string;
    price: string; // Novo campo para o valor da pulseira
}

const ACCESS_TYPES = [
    'Standard',
    'VIP',
    'Staff',
    'Press',
    'Organizador'
];

// Função utilitária para converter string formatada (ex: "150,00") para float (ex: 150.00)
const parsePriceToNumeric = (value: string): number => {
    const cleanValue = value.replace(/[^\d,]/g, '').replace(',', '.');
    return parseFloat(cleanValue) || 0;
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


const ManagerCreateWristband: React.FC = () => {
    const navigate = useNavigate();
    const [userId, setUserId] = useState<string | null>(null);
    const [formData, setFormData] = useState<WristbandFormData>({
        eventId: '',
        baseCode: '',
        quantity: 1,
        accessType: ACCESS_TYPES[0],
        price: '0,00', // Usando vírgula para padrão brasileiro
    });
    const [isSaving, setIsSaving] = useState(false);

    // Fetch current user ID
    useEffect(() => {
        supabase.auth.getUser().then(({ data: { user } }) => {
            setUserId(user?.id || null);
        });
    }, []);

    // Fetch manager's company ID and events
    const { company, isLoading: isLoadingCompany } = useManagerCompany(userId || undefined);
    const { events, isLoading: isLoadingEvents } = useManagerEvents(userId || undefined);

    const isLoading = isLoadingCompany || isLoadingEvents || !userId;

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        const { id, value } = e.target;
        
        if (id === 'quantity') {
            const numValue = parseInt(value);
            setFormData(prev => ({ ...prev, [id]: isNaN(numValue) || numValue < 1 ? 1 : numValue }));
        } else if (id === 'price') {
            const formattedPrice = formatPriceInput(value);
            setFormData(prev => ({ ...prev, [id]: formattedPrice }));
        } else {
            setFormData(prev => ({ ...prev, [id]: value }));
        }
    };

    const handlePriceBlur = () => {
        // Formata o preço para duas casas decimais ao perder o foco
        const numericValue = parsePriceToNumeric(formData.price);
        setFormData(prev => ({ ...prev, price: numericValue.toFixed(2).replace('.', ',') }));
    };

    const handleSelectChange = (field: keyof Omit<WristbandFormData, 'quantity' | 'baseCode' | 'price'>, value: string) => {
        setFormData(prev => ({ ...prev, [field]: value }));
    };

    const validateForm = (priceNumeric: number) => {
        const errors: string[] = [];
        
        if (!formData.eventId) errors.push("Selecione o evento.");
        if (!formData.baseCode.trim()) errors.push("O Código Base é obrigatório.");
        if (formData.quantity < 1 || formData.quantity > 500) errors.push("A quantidade deve ser entre 1 e 500.");
        if (!formData.accessType) errors.push("O Tipo de Acesso é obrigatório.");
        if (!company?.id) errors.push("O Perfil da Empresa não está cadastrado. Cadastre-o em Configurações.");
        
        if (isNaN(priceNumeric) || priceNumeric < 0) errors.push("O Valor deve ser um número positivo.");

        if (errors.length > 0) {
            showError(`Por favor, corrija os seguintes erros: ${errors.join(' ')}`);
            return false;
        }
        return true;
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        
        const priceNumeric = parsePriceToNumeric(formData.price);
        if (!validateForm(priceNumeric) || !company?.id || !userId) return;

        setIsSaving(true);
        const toastId = showLoading(`Cadastrando pulseira e ${formData.quantity} registros de analytics...`);

        try {
            const baseCodeClean = formData.baseCode.trim().toUpperCase().replace(/[^A-Z0-9-]/g, '');
            
            // 1. Inserir APENAS UM registro na tabela wristbands
            const wristbandData = {
                event_id: formData.eventId,
                company_id: company.id,
                manager_user_id: userId,
                code: baseCodeClean, // Usando o Código Base como o código principal
                access_type: formData.accessType,
                status: 'active',
                price: priceNumeric, // Salvando o preço
            };

            const { data: insertedWristband, error: insertError } = await supabase
                .from('wristbands')
                .insert([wristbandData])
                .select('id, code')
                .single();

            if (insertError) {
                if (insertError.code === '23505') { // Unique violation (código da pulseira já existe)
                    throw new Error("O Código Base informado já está em uso. Tente um código diferente.");
                }
                throw insertError;
            }
            
            const wristbandId = insertedWristband.id;
            
            // 2. Inserir N registros de analytics (baseado na quantidade) — código único BASE-NNN
            const analyticsToInsert = [];
            for (let i = 0; i < formData.quantity; i++) {
                const uniqueCode = `${insertedWristband.code}-${String(i + 1).padStart(3, '0')}`;
                analyticsToInsert.push({
                    wristband_id: wristbandId,
                    event_type: 'creation',
                    client_user_id: null,
                    code_wristbands: uniqueCode,
                    status: 'active',
                    sequential_number: i + 1,
                    event_data: {
                        code: uniqueCode,
                        access_type: formData.accessType,
                        price: priceNumeric,
                        manager_id: userId,
                        event_id: formData.eventId,
                        initial_status: 'active',
                        sequential_entry: i + 1,
                    },
                });
            }

            const { error: analyticsError } = await supabase
                .from('wristband_analytics')
                .insert(analyticsToInsert);

            if (analyticsError) {
                console.error("Warning: Failed to insert analytics records:", analyticsError);
            }

            dismissToast(toastId);
            showSuccess(`Pulseira "${baseCodeClean}" cadastrada com ${formData.quantity} registros de analytics...`);
            
            // Limpar formulário após sucesso
            setFormData(prev => ({ 
                eventId: prev.eventId,
                baseCode: '',
                quantity: 1,
                accessType: ACCESS_TYPES[0],
                price: '0,00',
            }));

        } catch (error: any) {
            dismissToast(toastId);
            console.error("Erro ao cadastrar pulseira:", error);
            showError(`Falha ao cadastrar pulseira: ${error.message || 'Erro desconhecido'}`);
        } finally {
            setIsSaving(false);
        }
    };

    if (isLoading) {
        return (
            <div className="max-w-4xl mx-auto px-4 sm:px-0 text-center py-20">
                <Loader2 className="h-10 w-10 animate-spin text-yellow-500 mx-auto mb-4" />
                <p className="text-gray-400">Carregando dados do gestor e eventos...</p>
            </div>
        );
    }

    if (!company) {
        return (
            <div className="max-w-4xl mx-auto px-4 sm:px-0 text-center py-20">
                <div className="bg-red-500/20 border border-red-500/50 text-red-400 p-6 rounded-xl mb-8">
                    <i className="fas fa-exclamation-triangle text-2xl mb-3"></i>
                    <h3 className="font-semibold text-white mb-2">Perfil da Empresa Necessário</h3>
                    <p className="text-sm">Você precisa cadastrar o Perfil da Empresa antes de gerenciar pulseiras.</p>
                    <Button 
                        onClick={() => navigate('/manager/settings/company-profile')}
                        className="mt-4 bg-yellow-500 text-black hover:bg-yellow-600"
                    >
                        Ir para Perfil da Empresa
                    </Button>
                </div>
            </div>
        );
    }

    return (
        <div className="max-w-4xl mx-auto px-4 sm:px-0">
            <div className="flex items-center justify-between mb-8">
                <h1 className="text-2xl sm:text-3xl font-serif text-yellow-500 flex items-center">
                    <QrCode className="h-7 w-7 mr-3" />
                    Cadastro de Pulseira
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

            <Card className="bg-black border border-yellow-500/30 rounded-2xl shadow-2xl shadow-yellow-500/10">
                <CardHeader>
                    <CardTitle className="text-white text-xl sm:text-2xl font-semibold">Detalhes da Pulseira</CardTitle>
                    <CardDescription className="text-gray-400 text-sm">
                        Cadastre uma pulseira e defina quantos registros de uso inicial ela representa.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <form onSubmit={handleSubmit} className="space-y-6">
                        
                        {/* Evento */}
                        <div>
                            <label htmlFor="eventId" className="block text-sm font-medium text-white mb-2 flex items-center">
                                <Calendar className="h-4 w-4 mr-2 text-yellow-500" />
                                Evento Associado *
                            </label>
                            <Select onValueChange={(value) => handleSelectChange('eventId', value)} value={formData.eventId}>
                                <SelectTrigger className="w-full bg-black/60 border-yellow-500/30 text-white focus:ring-yellow-500">
                                    <SelectValue placeholder="Selecione o Evento" />
                                </SelectTrigger>
                                <SelectContent className="bg-black border-yellow-500/30 text-white">
                                    {events.length === 0 ? (
                                        <div className="px-2 py-1.5 text-sm text-gray-400">Nenhum evento cadastrado</div>
                                    ) : (
                                        events.map((event: ManagerEvent) => (
                                            <SelectItem key={event.id} value={event.id} className="hover:bg-yellow-500/10 cursor-pointer">
                                                {event.title}
                                            </SelectItem>
                                        ))
                                    )}
                                </SelectContent>
                            </Select>
                        </div>

                        {/* Código Base, Quantidade e Tipo de Acesso */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                            <div>
                                <label htmlFor="baseCode" className="block text-sm font-medium text-white mb-2 flex items-center">
                                    <QrCode className="h-4 w-4 mr-2 text-yellow-500" />
                                    Código Base *
                                </label>
                                <Input 
                                    id="baseCode" 
                                    value={formData.baseCode} 
                                    onChange={handleChange} 
                                    placeholder="Ex: CONCERTO-VIP-A1"
                                    className="bg-black/60 border-yellow-500/30 text-white placeholder-gray-500 focus:border-yellow-500"
                                    required
                                />
                                <p className="text-xs text-gray-500 mt-1">Este será o código único da pulseira.</p>
                            </div>
                            <div>
                                <label htmlFor="quantity" className="block text-sm font-medium text-white mb-2 flex items-center">
                                    <Hash className="h-4 w-4 mr-2 text-yellow-500" />
                                    Quantidade de Registros *
                                </label>
                                <Input 
                                    id="quantity" 
                                    type="number"
                                    value={formData.quantity} 
                                    onChange={handleChange} 
                                    placeholder="1"
                                    className="bg-black/60 border-yellow-500/30 text-white placeholder-gray-500 focus:border-yellow-500"
                                    min={1}
                                    max={500}
                                    required
                                />
                                <p className="text-xs text-gray-500 mt-1">O número de registros de 'criação' no histórico será igual a esta quantidade (máx. 500).</p>
                            </div>
                            <div>
                                <label htmlFor="accessType" className="block text-sm font-medium text-white mb-2 flex items-center">
                                    <Tag className="h-4 w-4 mr-2 text-yellow-500" />
                                    Tipo de Acesso *
                                </label>
                                <Select onValueChange={(value) => handleSelectChange('accessType', value)} value={formData.accessType}>
                                    <SelectTrigger className="w-full bg-black/60 border-yellow-500/30 text-white focus:ring-yellow-500">
                                        <SelectValue placeholder="Selecione o Tipo" />
                                    </SelectTrigger>
                                    <SelectContent className="bg-black border-yellow-500/30 text-white">
                                        {ACCESS_TYPES.map(type => (
                                            <SelectItem key={type} value={type} className="hover:bg-yellow-500/10 cursor-pointer">
                                                {type}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                        
                        {/* Valor da Pulseira */}
                        <div>
                            <label htmlFor="price" className="block text-sm font-medium text-white mb-2 flex items-center">
                                <DollarSign className="h-4 w-4 mr-2 text-yellow-500" />
                                Valor da Pulseira (R$) *
                            </label>
                            <Input 
                                id="price" 
                                value={formData.price} 
                                onChange={handleChange} 
                                onBlur={handlePriceBlur}
                                placeholder="0,00"
                                className="bg-black/60 border-yellow-500/30 text-white placeholder-gray-500 focus:border-yellow-500"
                                required
                            />
                            <p className="text-xs text-gray-500 mt-1">O valor de venda ou custo desta pulseira.</p>
                        </div>

                        {/* Associação de Cliente (Aviso atualizado) */}
                        <div className="pt-4 border-t border-yellow-500/10">
                            <div className="flex items-start p-3 bg-black/40 rounded-xl border border-yellow-500/20">
                                <User className="h-5 w-5 mr-3 text-yellow-500 flex-shrink-0" />
                                <div>
                                    <p className="text-white font-medium text-sm">Associação de Cliente</p>
                                    <p className="text-gray-400 text-xs mt-1">
                                        A coluna para associação de cliente foi criada na tabela de analytics. A interface para associar a um cliente será implementada em uma próxima atualização.
                                    </p>
                                </div>
                            </div>
                        </div>

                        {/* Botões de Ação */}
                        <div className="pt-4 flex flex-col sm:flex-row space-y-4 sm:space-y-0 sm:space-x-4">
                            <Button
                                type="submit"
                                disabled={isSaving || isLoading || !company}
                                className="flex-1 bg-yellow-500 text-black hover:bg-yellow-600 py-3 text-lg font-semibold transition-all duration-300 cursor-pointer disabled:opacity-50"
                            >
                                {isSaving ? (
                                    <div className="flex items-center justify-center">
                                        <Loader2 className="w-5 h-5 animate-spin mr-2" />
                                        Gravando...
                                    </div>
                                ) : (
                                    <>
                                        <i className="fas fa-save mr-2"></i>
                                        Gerar e Gravar Pulseira
                                    </>
                                )}
                            </Button>
                            <Button
                                type="button"
                                onClick={() => navigate('/manager/wristbands')}
                                variant="outline"
                                className="flex-1 bg-black/60 border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 py-3 text-lg font-semibold transition-all duration-300 cursor-pointer"
                                disabled={isSaving}
                            >
                                <ArrowLeft className="mr-2 h-5 w-5" />
                                Voltar para a Lista
                            </Button>
                        </div>
                    </form>
                </CardContent>
            </Card>
        </div>
    );
};

export default ManagerCreateWristband;