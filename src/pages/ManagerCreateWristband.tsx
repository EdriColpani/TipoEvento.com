import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Loader2, QrCode, Tag, Calendar, Hash, DollarSign } from 'lucide-react';
import { showSuccess, showError, showLoading, dismissToast } from '@/utils/toast';
import { supabase } from '@/integrations/supabase/client';
import { usePageAuth } from '@/hooks/use-page-auth';
import { useManagerCompany } from '@/hooks/use-manager-company';
import { useManagerEvents, ManagerEvent } from '@/hooks/use-manager-events';
import { useProfile } from '@/hooks/use-profile';
import { assertCompanyPlanFeature } from '@/utils/plan-feature-guard';
import { useCompanyBilling } from '@/hooks/use-company-billing';
import { companyAllowsTicketSales, DEFAULT_MIN_EVENT_TICKETS } from '@/utils/company-billing-rules';
import { validateEventTicketMinimumOnIssue } from '@/utils/min-event-tickets-validation';
import EventBatchInventoryConsultPanel from '@/components/EventBatchInventoryConsultPanel';
import EventActivationReminderBanner from '@/components/EventActivationReminderBanner';

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
    const location = useLocation();
    const preselectedEventId =
        typeof (location.state as { eventId?: string } | null)?.eventId === 'string'
            ? (location.state as { eventId: string }).eventId
            : '';
    const { userId: authUserId, authPending } = usePageAuth();
    const userId = authUserId ?? null;
    const [formData, setFormData] = useState<WristbandFormData>({
        eventId: '',
        baseCode: '',
        quantity: 1,
        accessType: ACCESS_TYPES[0],
        price: '0,00', // Usando vírgula para padrão brasileiro
    });
    const [isSaving, setIsSaving] = useState(false);
    const [selectedEventInventoryMode, setSelectedEventInventoryMode] = useState<'unit_rows' | 'counter' | null>(null);
    /** Evita segundo INSERT (pulseira + analytics) antes do re-render do botão — mesmo padrão do cadastro de evento. */
    const submitInFlightRef = useRef(false);

    // Fetch manager's company ID and events
    const { profile } = useProfile(userId || undefined);
    const isAdminMaster = profile?.tipo_usuario_id === 1;
    const { company, isLoading: isLoadingCompany } = useManagerCompany(userId || undefined);
    const { billing, isLoading: isLoadingBilling } = useCompanyBilling(company?.id);
    const { events, isLoading: isLoadingEvents } = useManagerEvents(userId || undefined, isAdminMaster);
    const requiresPaidTickets = companyAllowsTicketSales(billing?.billing_plan);
    const companyMinEventTickets = billing?.min_event_tickets ?? DEFAULT_MIN_EVENT_TICKETS;

    const isLoading = authPending || isLoadingCompany || isLoadingEvents || isLoadingBilling;

    useEffect(() => {
        if (!preselectedEventId || isLoadingEvents) return;
        const exists = events.some((e) => e.id === preselectedEventId);
        if (exists) {
            setFormData((prev) =>
                prev.eventId === preselectedEventId ? prev : { ...prev, eventId: preselectedEventId },
            );
        }
    }, [preselectedEventId, events, isLoadingEvents]);

    useEffect(() => {
        if (!formData.eventId) {
            setSelectedEventInventoryMode(null);
            return;
        }

        let cancelled = false;
        void supabase
            .from('events')
            .select('inventory_mode')
            .eq('id', formData.eventId)
            .maybeSingle()
            .then(({ data, error }) => {
                if (cancelled) return;
                if (error) {
                    console.error('[ManagerCreateWristband] inventory_mode:', error);
                    setSelectedEventInventoryMode('unit_rows');
                    return;
                }
                setSelectedEventInventoryMode(
                    data?.inventory_mode === 'counter' ? 'counter' : 'unit_rows',
                );
            });

        return () => {
            cancelled = true;
        };
    }, [formData.eventId]);

    const isCounterInventoryEvent = selectedEventInventoryMode === 'counter';

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        const { id, value } = e.target;
        
        if (id === 'quantity') {
            const numValue = parseInt(value, 10);
            const capped = isCounterInventoryEvent
                ? numValue
                : Math.min(isNaN(numValue) ? 1 : numValue, 500);
            setFormData(prev => ({ ...prev, [id]: isNaN(numValue) || numValue < 1 ? 1 : capped }));
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

        if (isCounterInventoryEvent) {
            errors.push(
                'Este evento usa estoque por lote. Defina a quantidade nos lotes do evento — não emite ingressos um a um aqui.',
            );
        }
        
        if (!formData.eventId) errors.push("Selecione o evento.");
        if (!formData.baseCode.trim()) errors.push("O Código Base é obrigatório.");
        if (!isCounterInventoryEvent && (formData.quantity < 1 || formData.quantity > 500)) {
            errors.push("A quantidade deve ser entre 1 e 500 por emissão manual.");
        }
        if (!formData.accessType) errors.push("O Tipo de Acesso é obrigatório.");
        if (!company?.id) errors.push("O Perfil da Empresa não está cadastrado. Cadastre-o em Configurações.");
        
        if (isNaN(priceNumeric) || priceNumeric < 0) errors.push("O Valor deve ser um número positivo.");
        if (requiresPaidTickets && priceNumeric <= 0) {
            errors.push('No seu plano, o valor do ingresso deve ser maior que zero.');
        }

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

        if (submitInFlightRef.current) {
            return;
        }

        try {
            await assertCompanyPlanFeature(company.id, 'wristbands');

            const minError = await validateEventTicketMinimumOnIssue({
                eventId: formData.eventId,
                billingPlan: billing?.billing_plan,
                minEventTickets: companyMinEventTickets,
                quantityToAdd: formData.quantity,
                unitPrice: priceNumeric,
            });
            if (minError) {
                showError(minError);
                return;
            }
        } catch (preErr: unknown) {
            showError(preErr instanceof Error ? preErr.message : 'Erro ao validar ingressos.');
            return;
        }

        submitInFlightRef.current = true;
        setIsSaving(true);
        const toastId = showLoading(`Cadastrando ingresso e ${formData.quantity} ingressos...`);

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
                console.error('Falha ao inserir wristband_analytics:', analyticsError);
                if (String(analyticsError.code) === '23505') {
                    throw new Error(
                        'Esses códigos de ingresso já existem para este ingresso (envio duplicado). Recarregue a lista ou exclua duplicatas antigas no banco.',
                    );
                }
                throw analyticsError;
            }

            dismissToast(toastId);
            showSuccess(`Ingresso "${baseCodeClean}" cadastrado com ${formData.quantity} ingressos.`);
            
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
            showError(`Falha ao cadastrar ingresso: ${error.message || 'Erro desconhecido'}`);
        } finally {
            submitInFlightRef.current = false;
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
                    <p className="text-sm">Você precisa cadastrar o Perfil da Empresa antes de gerenciar ingressos.</p>
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

    if (requiresPaidTickets) {
        return (
            <div className="max-w-4xl mx-auto px-4 sm:px-0">
                <EventActivationReminderBanner />
                <div className="text-center py-16 rounded-2xl border border-cyan-400/40 bg-cyan-950/40 p-8">
                    <QrCode className="h-12 w-12 text-cyan-300 mx-auto mb-4" />
                    <h2 className="text-xl font-semibold text-white mb-3">Ingressos definidos nos lotes do evento</h2>
                    <p className="text-sm text-cyan-100/90 max-w-lg mx-auto mb-6 leading-relaxed">
                        Eventos pagos usam estoque por lote. Defina a quantidade ao cadastrar ou editar o evento
                        (Standard, VIP…) — os QR codes são gerados na venda. Não é mais necessário emitir ingressos
                        manualmente aqui.
                    </p>
                    <div className="flex flex-col sm:flex-row gap-3 justify-center">
                        <Button
                            onClick={() => navigate('/manager/events')}
                            className="bg-yellow-500 text-black hover:bg-yellow-600"
                        >
                            Ir para Meus Eventos
                        </Button>
                        <Button
                            onClick={() => navigate('/manager/wristbands')}
                            variant="outline"
                            className="bg-black/60 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10"
                        >
                            Ver estoque
                        </Button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="max-w-4xl mx-auto px-4 sm:px-0">
            <div className="flex items-center justify-between mb-8">
                <h1 className="text-2xl sm:text-3xl font-serif text-yellow-500 flex items-center">
                    <QrCode className="h-7 w-7 mr-3" />
                    Cadastro de Ingresso
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

            <EventActivationReminderBanner />

            <Card className="bg-black border border-yellow-500/30 rounded-2xl shadow-2xl shadow-yellow-500/10">
                <CardHeader>
                    <CardTitle className="text-white text-xl sm:text-2xl font-semibold">Detalhes do Ingresso</CardTitle>
                    <CardDescription className="text-gray-400 text-sm">
                        Cadastre um ingresso e defina quantos registros de uso inicial ele representa.
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

                        {formData.eventId && isCounterInventoryEvent && (
                            <EventBatchInventoryConsultPanel
                                eventId={formData.eventId}
                                variant="consultation"
                            />
                        )}

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
                                    className="bg-black/60 border-yellow-500/30 text-white placeholder-gray-500 focus:border-yellow-500 disabled:opacity-50"
                                    disabled={isCounterInventoryEvent}
                                    required={!isCounterInventoryEvent}
                                />
                                <p className="text-xs text-gray-500 mt-1">Este será o código único do ingresso.</p>
                            </div>
                            <div>
                                <label htmlFor="quantity" className="block text-sm font-medium text-white mb-2 flex items-center">
                                    <Hash className="h-4 w-4 mr-2 text-yellow-500" />
                                    Quantidade de ingressos *
                                </label>
                                <Input 
                                    id="quantity" 
                                    type="number"
                                    value={formData.quantity} 
                                    onChange={handleChange} 
                                    placeholder="1"
                                    className="bg-black/60 border-yellow-500/30 text-white placeholder-gray-500 focus:border-yellow-500 disabled:opacity-50"
                                    min={1}
                                    max={isCounterInventoryEvent ? undefined : 500}
                                    disabled={isCounterInventoryEvent}
                                    required={!isCounterInventoryEvent}
                                />
                                <p className="text-xs text-gray-400 mt-1">
                                    {isCounterInventoryEvent
                                        ? 'Use os lotes do evento para definir 50.000+ ingressos.'
                                        : 'Emissão manual: até 500 por vez (eventos gratuitos ou legado).'}
                                </p>
                            </div>
                            <div>
                                <label htmlFor="accessType" className="block text-sm font-medium text-white mb-2 flex items-center">
                                    <Tag className="h-4 w-4 mr-2 text-yellow-500" />
                                    Tipo de Acesso *
                                </label>
                                <Select
                                    onValueChange={(value) => handleSelectChange('accessType', value)}
                                    value={formData.accessType}
                                    disabled={isCounterInventoryEvent}
                                >
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
                        
                        {/* Valor do Ingresso */}
                        <div>
                            <label htmlFor="price" className="block text-sm font-medium text-white mb-2 flex items-center">
                                <DollarSign className="h-4 w-4 mr-2 text-yellow-500" />
                                Valor do Ingresso (R$) *
                            </label>
                            <Input 
                                id="price" 
                                value={formData.price} 
                                onChange={handleChange} 
                                onBlur={handlePriceBlur}
                                placeholder="0,00"
                                className="bg-black/60 border-yellow-500/30 text-white placeholder-gray-500 focus:border-yellow-500 disabled:opacity-50"
                                disabled={isCounterInventoryEvent}
                                required={!isCounterInventoryEvent}
                            />
                            <p className="text-xs text-gray-500 mt-1">O valor de venda ou custo deste ingresso.</p>
                        </div>

                        {/* Botões de Ação */}
                        <div className="pt-4 flex flex-col sm:flex-row space-y-4 sm:space-y-0 sm:space-x-4">
                            <Button
                                type="submit"
                                disabled={isSaving || isLoading || !company || isCounterInventoryEvent}
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
                                        Gerar e Gravar Ingresso
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