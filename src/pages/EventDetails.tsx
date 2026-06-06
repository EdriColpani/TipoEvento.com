import React, { useRef, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import AuthStatusMenu from '@/components/AuthStatusMenu';
import { Input } from '@/components/ui/input';
import { useEventDetails, EventDetailsData, TicketType } from '@/hooks/use-event-details';
import { Check, Loader2, ShoppingCart, Wallet } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { showError, showSuccess, showLoading, dismissToast } from '@/utils/toast'; // Importando showLoading/dismissToast
import { useAuthRedirect } from '@/hooks/use-auth-redirect';
import { supabase } from '@/integrations/supabase/client'; // Importando supabase
import { FunctionsHttpError } from '@supabase/supabase-js'; // Importando o tipo de erro específico
import { formatEventDateForDisplay } from '@/utils/format-event-date';
import { isEventOpenForNewSales } from '@/utils/event-sales-window';
import {
    fetchEventCreditEligibility,
    startCreditSpendCheckout,
} from '@/utils/credit-spend-checkout';
import EventLocationMap from '@/components/EventLocationMap';
import LandingFooter from '@/components/landing/LandingFooter';
import { useDevice } from '@/hooks/use-device';
import { useEventCheckoutQueue } from '@/hooks/use-event-checkout-queue';
import { generateRandomUuid } from '@/utils/random-id';

// Tipos de dados para os itens de compra
interface PurchaseItem {
    ticketTypeId: string; // ID da pulseira base (wristband ID)
    quantity: number;
    price: number;
    name: string; // Nome do tipo de ingresso
}

// Helper function to get the minimum price display
const getPriceDisplay = (price: number): string => {
    return `R$ ${price.toFixed(2).replace('.', ',')}`;
};

const getMinPriceDisplay = (price: number | null | undefined) => {
    if (price === null || price === undefined || price === 0) return 'Sem ingressos ativos';
    return `R$ ${price.toFixed(2).replace('.', ',')}`;
};

const EventDetails: React.FC = () => {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const location = useLocation();
    
    const { details, isLoading, isError } = useEventDetails(id);
    const { isAuthenticated, redirectToLogin } = useAuthRedirect();
    const { isMobile } = useDevice();
    
    const [selectedTickets, setSelectedTickets] = useState<{ [key: string]: number }>({});
    const [isProcessing, setIsProcessing] = useState(false);
    const [isCreditProcessing, setIsCreditProcessing] = useState(false);
    const checkoutIdempotencyKeyRef = useRef<string>(generateRandomUuid());
    const queue = useEventCheckoutQueue(id, isAuthenticated && !details?.event.listing_only);

    const creditBalanceQuery = useQuery({
        queryKey: ['client-credit-balance-event', id],
        queryFn: async () => {
            const { data, error } = await supabase.rpc('get_client_credit_balance');
            if (error) throw error;
            return data as { balance?: number; status?: string };
        },
        enabled: isAuthenticated && !!id,
        staleTime: 30_000,
    });

    const creditEligibilityQuery = useQuery({
        queryKey: ['event-credit-eligibility', id],
        queryFn: () => fetchEventCreditEligibility(id!),
        enabled: !!id,
        staleTime: 60_000,
    });

    const creditWalletMetaQuery = useQuery({
        queryKey: ['credit-wallet-status-event'],
        queryFn: async () => {
            const { data, error } = await supabase.rpc('get_credit_wallet_status');
            if (error) throw error;
            return data as { biometric_threshold?: number };
        },
        enabled: isAuthenticated,
        staleTime: 60_000,
    });

    const creditBalance = Number(creditBalanceQuery.data?.balance ?? 0);
    const creditWalletStatus = creditBalanceQuery.data?.status ?? 'active';
    const creditEligible = creditEligibilityQuery.data?.eligible === true
        && details?.event.credit_consumption_enabled === true;

    const handleTicketChange = (ticketId: string, quantity: number) => {
        setSelectedTickets(prev => ({
            ...prev,
            [ticketId]: Math.max(0, quantity)
        }));
    };

    const getTotalPrice = () => {
        if (!details) return 0;
        return Object.entries(selectedTickets).reduce((total, [ticketId, quantity]) => {
            const ticket = details.ticketTypes.find((t: TicketType) => t.id === ticketId);
            return total + (ticket ? ticket.price * quantity : 0);
        }, 0);
    };

    const getTotalTickets = () => {
        return Object.values(selectedTickets).reduce((total, quantity) => total + quantity, 0);
    };

    const getPurchaseItems = (): PurchaseItem[] => {
        if (!details) return [];
        return details.ticketTypes
            .filter(ticket => selectedTickets[ticket.id] > 0)
            .map(ticket => ({
                ticketTypeId: ticket.id,
                quantity: selectedTickets[ticket.id],
                price: ticket.price,
                name: ticket.name,
            }));
    };

    const validatePurchaseContext = (): boolean => {
        if (details && !details.event.is_active) {
            showError('Este evento não está disponível para novas compras.');
            return false;
        }
        if (details && !isEventOpenForNewSales(details.event.date, details.event.time)) {
            showError('O prazo para compra de ingressos deste evento foi encerrado.');
            return false;
        }
        if (getTotalTickets() === 0) {
            showError('Selecione pelo menos um ingresso para prosseguir.');
            return false;
        }
        if (!isAuthenticated) {
            showError('Você precisa estar logado para comprar ingressos.');
            redirectToLogin();
            return false;
        }
        if (!details || !id) return false;
        return true;
    };

    const totalPrice = getTotalPrice();
    const checkoutBlockedByQueue = queue.queueEnabled && !queue.canCheckout;
    const queueBanner = queue.queueEnabled && queue.status === 'waiting' ? (
        <div className="rounded-xl border border-cyan-500/40 bg-cyan-500/10 p-4 text-sm text-cyan-100 mb-4">
            <div className="font-semibold text-white mb-1">Fila virtual de compra</div>
            <p>
                Posição na fila: <strong>{queue.position}</strong>
                {queue.waitEstimateSeconds > 0 && (
                    <> · estimativa ~{Math.ceil(queue.waitEstimateSeconds / 60)} min</>
                )}
            </p>
            <p className="text-xs text-cyan-200/80 mt-1">A página atualiza automaticamente quando for sua vez.</p>
        </div>
    ) : null;
    const canPayWithCredit = creditEligible
        && creditWalletStatus === 'active'
        && creditBalance >= totalPrice
        && totalPrice > 0;
    
    const handleCheckout = async () => {
        if (!validatePurchaseContext()) return;

        if (queue.queueEnabled && !queue.canCheckout) {
            showError('Aguarde sua vez na fila virtual para comprar.');
            return;
        }

        const purchaseItems = getPurchaseItems();
        if (purchaseItems.length === 0) {
            showError("Nenhum item selecionado para a compra.");
            return;
        }

        setIsProcessing(true);
        const toastId = showLoading("Preparando pagamento e redirecionando...");

        try {
            // 2. Obter o token de autenticação do usuário logado
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) {
                dismissToast(toastId);
                showError("Sessão expirada. Faça login novamente.");
                navigate('/login', {
                    state: { from: `${location.pathname}${location.search}` },
                });
                return;
            }
            
            // 3. Chamar o Edge Function para criar a preferência de pagamento
            const response = await supabase.functions.invoke('create-payment-preference', {
                body: {
                    eventId: id,
                    clientOrigin: typeof window !== 'undefined' ? window.location.origin : '',
                    idempotencyKey: checkoutIdempotencyKeyRef.current,
                    queueSessionToken: queue.sessionToken ?? undefined,
                    purchaseItems: purchaseItems.map(item => ({
                        ticketTypeId: item.ticketTypeId,
                        quantity: item.quantity,
                        price: item.price,
                        name: item.name,
                    })),
                },
                headers: {
                    'Authorization': `Bearer ${session.access_token}`,
                    'x-idempotency-key': checkoutIdempotencyKeyRef.current,
                }
            });

            let errorMessage = "Falha ao iniciar o pagamento. Tente novamente.";

            if (response.error) {
                console.error("Edge Function error:", response.error);

                let payload = response.data as
                    | { error?: string; hint?: string; mpCode?: string }
                    | undefined;

                // Em respostas non-2xx, o supabase-js pode não preencher `data`.
                // Nesse caso, tentamos extrair o JSON diretamente do contexto do erro.
                if (
                    (!payload || typeof payload !== 'object') &&
                    response.error instanceof FunctionsHttpError
                ) {
                    try {
                        const contextPayload = await response.error.context.json();
                        if (contextPayload && typeof contextPayload === 'object') {
                            payload = contextPayload as { error?: string; hint?: string; mpCode?: string };
                        }
                    } catch (contextParseError) {
                        console.warn('Não foi possível ler o corpo do erro da Edge Function:', contextParseError);
                    }
                }

                if (payload && typeof payload === 'object' && typeof payload.error === 'string') {
                    errorMessage = payload.error;
                    if (payload.hint) {
                        errorMessage = `${payload.error} — ${payload.hint}`;
                    } else if (payload.mpCode === 'PA_UNAUTHORIZED_RESULT_FROM_POLICIES') {
                        errorMessage =
                            'Pagamento bloqueado pelo Mercado Pago (políticas). Verifique no painel MP as URLs permitidas e as credenciais de produção.';
                    }
                } else if (response.error.message) {
                    // Verifica se a mensagem de erro contém informações úteis
                    if (response.error.message.includes('404') || response.error.message.includes('not found')) {
                        errorMessage = "Serviço de pagamento não encontrado. Por favor, tente novamente mais tarde ou contate o suporte.";
                    } else if (response.error.message.includes('401') || response.error.message.includes('Unauthorized')) {
                        errorMessage = "Sessão expirada. Por favor, faça login novamente.";
                    } else if (response.error.message.includes('500') || response.error.message.includes('Internal')) {
                        errorMessage = "Erro interno do servidor. Por favor, tente novamente mais tarde.";
                    } else {
                        errorMessage = response.error.message;
                    }
                } else {
                    errorMessage = "Erro ao conectar com o serviço de pagamento. Verifique sua conexão e tente novamente.";
                }
                throw new Error(errorMessage);
            }
            
            const edgeData = response.data;

            if (!edgeData) {
                throw new Error("Resposta vazia do servidor de pagamento. Tente novamente.");
            }

            if (edgeData.error) {
                // Este caso lida se a Edge Function retornar um status 2xx, mas com um erro no corpo
                throw new Error(edgeData.error);
            }
            
            if (!edgeData.checkoutUrl) {
                throw new Error("URL de pagamento não foi gerada. Por favor, tente novamente ou contate o suporte.");
            }
            
            const checkoutUrl = edgeData.checkoutUrl;
            
            dismissToast(toastId);
            showSuccess("Redirecionando para o Mercado Pago...");
            checkoutIdempotencyKeyRef.current = generateRandomUuid();

            // 4. Redirecionar para a URL de checkout
            window.location.href = checkoutUrl;

        } catch (error: any) {
            if (toastId) {
                dismissToast(toastId);
            }
            console.error("Erro ao criar preferência de pagamento:", error);
            // Exibe a mensagem de erro detalhada (seja do Edge Function ou do Mercado Pago)
            showError(error.message || "Ocorreu um erro inesperado. Tente novamente.");
        } finally {
            setIsProcessing(false);
        }
    };

    const handleCreditCheckout = async () => {
        if (!validatePurchaseContext()) return;

        const purchaseItems = getPurchaseItems();
        if (purchaseItems.length === 0) {
            showError('Nenhum item selecionado para a compra.');
            return;
        }

        if (!creditEligible) {
            showError(creditEligibilityQuery.data?.reason || 'Pagamento com crédito indisponível para este evento.');
            return;
        }

        if (creditWalletStatus !== 'active') {
            showError('Sua carteira EventFest não está ativa.');
            return;
        }

        if (creditBalance < totalPrice) {
            showError(`Saldo insuficiente. Você tem ${getPriceDisplay(creditBalance)} e o total é ${getPriceDisplay(totalPrice)}.`);
            return;
        }

        setIsCreditProcessing(true);
        const toastId = showLoading('Processando pagamento com crédito EventFest...');

        try {
            const result = await startCreditSpendCheckout(id!, purchaseItems, {
                biometricThreshold: Number(creditWalletMetaQuery.data?.biometric_threshold ?? 200),
            });
            dismissToast(toastId);
            showSuccess(
                result.duplicate
                    ? 'Compra já havia sido processada. Seus ingressos estão disponíveis.'
                    : 'Ingressos adquiridos com crédito EventFest!',
            );
            navigate(`/tickets?status=success&credit_spend_id=${result.spendOrderId}`);
        } catch (error: unknown) {
            dismissToast(toastId);
            const message = error instanceof Error ? error.message : 'Erro ao pagar com crédito.';
            showError(message);
        } finally {
            setIsCreditProcessing(false);
        }
    };

    if (isLoading) {
        return (
            <div className="min-h-screen bg-black text-white flex items-center justify-center pt-20">
                <Loader2 className="h-10 w-10 animate-spin text-yellow-500" />
            </div>
        );
    }

    if (isError || !details) {
        return (
            <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center pt-20 px-4">
                <h1 className="text-4xl font-serif text-red-500 mb-4">Erro 404</h1>
                <p className="text-xl text-gray-400 mb-6">Evento não encontrado ou indisponível.</p>
                <Button onClick={() => navigate('/')} className="bg-yellow-500 text-black hover:bg-yellow-600">
                    Voltar para a Home
                </Button>
            </div>
        );
    }
    
    const { event, ticketTypes } = details;
    const isListingOnly = event.listing_only === true;
    const salesClosedInactive = !event.is_active;
    const salesClosedByDeadline = !isEventOpenForNewSales(event.date, event.time);
    const salesClosed = salesClosedInactive || salesClosedByDeadline;
    const minPriceDisplay = getMinPriceDisplay(event.min_price);
    
    const organizerName = event.companies?.corporate_name || 'N/A';
    const capacityDisplay = event.capacity > 0 ? event.capacity.toLocaleString('pt-BR') : 'N/A';
    const durationDisplay = event.duration || 'N/A';
    
    const bannerImageUrl = event.banner_image_url || event.image_url;

    return (
        <div className="min-h-screen bg-black text-white overflow-x-hidden">
            <header className="fixed top-0 left-0 right-0 z-[100] bg-black/80 backdrop-blur-md border-b border-yellow-500/20">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
                    <div className="flex items-center space-x-4 sm:space-x-8">
                        <div className="text-xl sm:text-2xl font-serif text-yellow-500 font-bold cursor-pointer" onClick={() => navigate('/')}>
                            EventFest
                        </div>
                        <nav className="hidden md:flex items-center space-x-8">
                            <button onClick={() => navigate('/')} className="text-white hover:text-yellow-500 transition-colors duration-300 cursor-pointer">Home</button>
                            <a href="/#eventos" className="text-white hover:text-yellow-500 transition-colors duration-300 cursor-pointer">Eventos</a>
                            <a href="/#categorias" className="text-white hover:text-yellow-500 transition-colors duration-300 cursor-pointer">Categorias</a>
                            <a href="/#contato" className="text-white hover:text-yellow-500 transition-colors duration-300 cursor-pointer">Contato</a>
                        </nav>
                    </div>
                    <div className="flex items-center space-x-3 sm:space-x-4">
                        <div className="relative hidden lg:block">
                            <Input 
                                type="search" 
                                placeholder="Buscar eventos..." 
                                className="bg-black/60 border-yellow-500/30 text-white placeholder-gray-500 focus:border-yellow-500 w-64 pl-4 pr-10 py-2 rounded-xl"
                            />
                            <i className="fas fa-search absolute right-4 top-1/2 transform -translate-y-1/2 text-yellow-500/60"></i>
                        </div>
                        <AuthStatusMenu />
                        <Button onClick={() => navigate('/')} className="border border-yellow-500 bg-transparent text-yellow-500 hover:bg-yellow-500 hover:text-black transition-all duration-300 cursor-pointer px-3 sm:px-4">
                            Voltar
                        </Button>
                    </div>
                </div>
            </header>
            {salesClosed && (
                <div
                    role="status"
                    className="fixed top-[4.25rem] left-0 right-0 z-[95] bg-orange-950/95 border-b border-orange-500/50 px-4 py-2.5 text-center text-sm text-orange-100"
                >
                    {salesClosedInactive
                        ? 'Este evento foi desativado pelo organizador e não está aceitando novas compras de ingressos.'
                        : 'O prazo para compra de ingressos deste evento foi encerrado (início do evento).'}
                </div>
            )}
            <section className={`${salesClosed ? 'pt-32' : 'pt-20'} pb-0 flex justify-center`}>
                <div className="relative w-full max-w-5xl h-[500px] overflow-hidden rounded-xl shadow-2xl shadow-yellow-500/20 mx-4 sm:mx-6">
                    <img
                        src={bannerImageUrl}
                        alt={event.title}
                        className="w-full h-full object-cover object-top"
                    />
                    <div className="absolute inset-0 bg-gradient-to-r from-black/90 via-black/70 to-black/40"></div>
                    <div className="absolute inset-0 flex items-center">
                        <div className="w-full px-4 sm:px-6">
                            <div className="max-w-full lg:max-w-3xl">
                                <div className="inline-block bg-yellow-500 text-black px-3 py-1 rounded-full text-xs sm:text-sm font-semibold mb-2 sm:mb-4">
                                    {event.category}
                                </div>
                                <h1 className="text-3xl sm:text-5xl lg:text-6xl font-serif text-white mb-3 sm:mb-6 leading-tight">
                                    {event.title}
                                </h1>
                                <p className="text-base sm:text-xl text-gray-200 mb-4 sm:mb-8 leading-relaxed line-clamp-3">
                                    {event.description}
                                </p>
                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6 mb-6 sm:mb-8">
                                    <div className="flex items-center">
                                        <i className="fas fa-calendar-alt text-yellow-500 text-xl sm:text-2xl mr-3 sm:mr-4"></i>
                                        <div>
                                            <div className="text-xs sm:text-sm text-gray-400">Data</div>
                                            <div className="text-sm sm:text-lg font-semibold text-white">{formatEventDateForDisplay(event.date) || '—'}</div>
                                        </div>
                                    </div>
                                    <div className="flex items-center">
                                        <i className="fas fa-clock text-yellow-500 text-xl sm:text-2xl mr-3 sm:mr-4"></i>
                                        <div>
                                            <div className="text-xs sm:text-sm text-gray-400">Horário</div>
                                            <div className="text-sm sm:text-lg font-semibold text-white">{event.time}</div>
                                        </div>
                                    </div>
                                    <div className="flex items-center">
                                        <i className="fas fa-map-marker-alt text-yellow-500 text-xl sm:text-2xl mr-3 sm:mr-4"></i>
                                        <div>
                                            <div className="text-xs sm:text-sm text-gray-400">Local</div>
                                            <div className="text-sm sm:text-lg font-semibold text-white">{event.location}</div>
                                        </div>
                                    </div>
                                </div>
                                <div className="flex flex-col sm:flex-row items-start sm:items-center space-y-4 sm:space-y-0 sm:space-x-6">
                                    {isListingOnly ? (
                                        <span className="text-2xl sm:text-3xl font-bold text-blue-400">
                                            Evento em divulgação — sem venda de ingressos online
                                        </span>
                                    ) : (
                                        <>
                                            <span className="text-2xl sm:text-4xl font-bold text-yellow-500">
                                                A partir de {minPriceDisplay}
                                            </span>
                                            {queueBanner}
                                            <Button 
                                                onClick={handleCheckout}
                                                disabled={isProcessing || getTotalTickets() === 0 || salesClosed || checkoutBlockedByQueue}
                                                className="w-full sm:w-auto bg-yellow-500 text-black hover:bg-yellow-600 px-6 sm:px-8 py-3 text-base sm:text-lg font-semibold transition-all duration-300 cursor-pointer hover:scale-105 disabled:opacity-50"
                                            >
                                                {isProcessing ? (
                                                    <Loader2 className="h-5 w-5 animate-spin mr-2" />
                                                ) : (
                                                    <ShoppingCart className="h-5 w-5 mr-2" />
                                                )}
                                                {isProcessing ? 'Processando...' : 'Comprar Ingressos'}
                                            </Button>
                                        </>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </section>
            <div className="w-full h-px bg-yellow-500"></div>
            <section className="py-12 sm:py-20 px-4 sm:px-6">
                <div className="max-w-7xl mx-auto">
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 lg:gap-12">
                        <div className="lg:col-span-2 space-y-8 sm:space-y-12 order-2 lg:order-1">
                            <div>
                                <h2 className="text-2xl sm:text-3xl font-serif text-yellow-500 mb-4 sm:mb-6">Sobre o Evento</h2>
                                <div className="bg-black/60 backdrop-blur-sm border border-yellow-500/30 rounded-2xl p-6 sm:p-8">
                                    <p className="text-gray-300 text-sm sm:text-lg leading-relaxed mb-6">
                                        {event.description}
                                    </p>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
                                        <div className="space-y-3 sm:space-y-4">
                                            <div className="flex items-center text-sm sm:text-base">
                                                <i className="fas fa-users text-yellow-500 mr-3"></i>
                                                <span className="text-white">Capacidade: {capacityDisplay}</span>
                                            </div>
                                            <div className="flex items-center text-sm sm:text-base">
                                                <i className="fas fa-clock text-yellow-500 mr-3"></i>
                                                <span className="text-white">Duração: {durationDisplay}</span>
                                            </div>
                                        </div>
                                        <div className="space-y-3 sm:space-y-4">
                                            <div className="flex items-center text-sm sm:text-base">
                                                <i className="fas fa-user-check text-yellow-500 mr-3"></i>
                                                <span className="text-white">Classificação: {event.min_age === 0 ? 'Livre' : `${event.min_age} anos`}</span>
                                            </div>
                                            <div className="flex items-center text-sm sm:text-base">
                                                <i className="fas fa-user-tie text-yellow-500 mr-3"></i>
                                                <span className="text-white">Organizador: {organizerName}</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            
                            <div>
                                <h3 className="text-xl sm:text-2xl font-serif text-yellow-500 mb-4 sm:mb-6">
                                    Destaques do Evento
                                </h3>
                                <div className="bg-black/60 backdrop-blur-sm border border-yellow-500/30 rounded-2xl p-6 sm:p-8">
                                    {event.highlights.length > 0 ? (
                                        <ul className="space-y-3">
                                            {event.highlights.map((highlight, index) => (
                                                <li
                                                    key={`${index}-${highlight}`}
                                                    className="flex items-start gap-3 text-gray-200 text-sm sm:text-base"
                                                >
                                                    <Check
                                                        className="h-5 w-5 text-yellow-500 flex-shrink-0 mt-0.5"
                                                        aria-hidden
                                                    />
                                                    <span>{highlight}</span>
                                                </li>
                                            ))}
                                        </ul>
                                    ) : (
                                        <p className="text-gray-400 text-sm sm:text-base">
                                            O organizador ainda não cadastrou destaques para este evento. Consulte a
                                            descrição em &quot;Sobre o evento&quot; acima.
                                        </p>
                                    )}
                                </div>
                            </div>
                            <div>
                                <h3 className="text-xl sm:text-2xl font-serif text-yellow-500 mb-4 sm:mb-6">Localização</h3>
                                <div className="bg-black/60 backdrop-blur-sm border border-yellow-500/30 rounded-2xl p-6 sm:p-8">
                                    <EventLocationMap
                                        location={event.location}
                                        address={event.address}
                                        lat={event.address_lat}
                                        lng={event.address_lng}
                                    />
                                </div>
                            </div>
                        </div>
                        <div className="lg:col-span-1 order-1 lg:order-2">
                            <div className="lg:sticky lg:top-24">
                                <div className="bg-black/80 backdrop-blur-sm border border-yellow-500/30 rounded-2xl p-6 sm:p-8">
                                    {isListingOnly ? (
                                        <div className="text-center space-y-4">
                                            <h3 className="text-xl sm:text-2xl font-serif text-blue-400">Divulgação</h3>
                                            <p className="text-gray-300 text-sm leading-relaxed">
                                                Este evento está publicado apenas para divulgação. Ingressos não são vendidos
                                                pela plataforma — consulte o organizador para mais informações.
                                            </p>
                                            <p className="text-gray-500 text-xs">
                                                Organizador: {organizerName}
                                            </p>
                                        </div>
                                    ) : (
                                    <>
                                    <h3 className="text-xl sm:text-2xl font-serif text-yellow-500 mb-6">Selecionar Ingressos</h3>
                                    <div className="space-y-6">
                                        {ticketTypes.length > 0 ? (
                                            ticketTypes.map((ticket: TicketType) => {
                                                const ticketPurchaseClosed =
                                                    salesClosed || ticket.salesOpen === false;
                                                return (
                                                <div key={ticket.id} className="bg-black/60 border border-yellow-500/20 rounded-xl p-4 sm:p-6">
                                                    <div className="flex justify-between items-start mb-4">
                                                        <div>
                                                            <h4 className="text-white font-semibold text-base sm:text-lg">{ticket.name}</h4>
                                                            <p className="text-gray-400 text-xs sm:text-sm mt-1">{ticket.description}</p>
                                                            {ticket.salesOpen === false && ticket.batchStartDate && (
                                                                <p className="text-amber-300/90 text-xs mt-2">
                                                                    Vendas deste lote a partir de{' '}
                                                                    {formatEventDateForDisplay(ticket.batchStartDate)}
                                                                    {ticket.batchEndDate
                                                                        ? ` até ${formatEventDateForDisplay(ticket.batchEndDate)}`
                                                                        : ''}
                                                                    .
                                                                </p>
                                                            )}
                                                        </div>
                                                        <div className="text-right flex-shrink-0 ml-4">
                                                            <div className="text-xl sm:text-2xl font-bold text-yellow-500">{getPriceDisplay(ticket.price)}</div>
                                                            <div className="text-xs sm:text-sm text-gray-400">{ticket.available} disponíveis</div>
                                                        </div>
                                                    </div>
                                                    <div className="flex items-center justify-between">
                                                        <span className="text-white text-sm sm:text-base">Quantidade:</span>
                                                        <div className="flex items-center space-x-3">
                                                            <button
                                                                onClick={() => handleTicketChange(ticket.id, (selectedTickets[ticket.id] || 0) - 1)}
                                                                className="w-7 h-7 sm:w-8 sm:h-8 bg-yellow-500/20 border border-yellow-500/40 rounded-full flex items-center justify-center text-yellow-500 hover:bg-yellow-500/30 transition-all duration-300 cursor-pointer"
                                                                disabled={ticket.available === 0 || (selectedTickets[ticket.id] || 0) === 0 || isProcessing || isCreditProcessing || ticketPurchaseClosed}
                                                            >
                                                                <i className="fas fa-minus text-xs"></i>
                                                            </button>
                                                            <span className="text-white font-semibold w-6 sm:w-8 text-center text-sm sm:text-base">
                                                                {selectedTickets[ticket.id] || 0}
                                                            </span>
                                                            <button
                                                                onClick={() => handleTicketChange(ticket.id, (selectedTickets[ticket.id] || 0) + 1)}
                                                                className="w-7 h-7 sm:w-8 sm:h-8 bg-yellow-500/20 border border-yellow-500/40 rounded-full flex items-center justify-center text-yellow-500 hover:bg-yellow-500/30 transition-all duration-300 cursor-pointer"
                                                                disabled={(selectedTickets[ticket.id] || 0) >= ticket.available || isProcessing || isCreditProcessing || ticketPurchaseClosed}
                                                            >
                                                                <i className="fas fa-plus text-xs"></i>
                                                            </button>
                                                        </div>
                                                    </div>
                                                </div>
                                                );
                                            })
                                        ) : (
                                            <div className="text-center p-4 bg-black/60 rounded-xl border border-red-500/30">
                                                <p className="text-red-400 text-sm">Nenhum tipo de ingresso ativo encontrado para este evento.</p>
                                            </div>
                                        )}
                                    </div>
                                    {getTotalTickets() > 0 && (
                                        <>
                                            <div className="border-t border-yellow-500/20 pt-6 mt-6">
                                                <div className="flex justify-between items-center mb-2">
                                                    <span className="text-white text-base">Total de Ingressos:</span>
                                                    <span className="text-white font-semibold text-base">{getTotalTickets()}</span>
                                                </div>
                                                <div className="flex justify-between items-center mb-6">
                                                    <span className="text-white text-lg sm:text-xl">Total a Pagar:</span>
                                                    <span className="text-yellow-500 text-xl sm:text-2xl font-bold">{getPriceDisplay(getTotalPrice())}</span>
                                                </div>
                                            </div>
                                            {queueBanner}
                                            <Button 
                                                onClick={handleCheckout}
                                                disabled={isProcessing || isCreditProcessing || getTotalTickets() === 0 || salesClosed || checkoutBlockedByQueue}
                                                className="w-full bg-yellow-500 text-black hover:bg-yellow-600 py-3 sm:py-4 text-base sm:text-lg font-semibold transition-all duration-300 cursor-pointer hover:scale-105 disabled:opacity-50"
                                            >
                                                {isProcessing ? (
                                                    <Loader2 className="h-5 w-5 animate-spin mr-2" />
                                                ) : (
                                                    <ShoppingCart className="h-5 w-5 mr-2" />
                                                )}
                                                {isProcessing ? 'Processando...' : 'Comprar com Mercado Pago'}
                                            </Button>
                                            {creditEligible && (
                                                <div className="mt-4 space-y-3">
                                                    <div className="flex items-center justify-between text-sm text-gray-300 px-1">
                                                        <span className="flex items-center gap-2">
                                                            <Wallet className="h-4 w-4 text-yellow-500" />
                                                            Saldo EventFest
                                                        </span>
                                                        <span className="font-semibold text-yellow-500">
                                                            {creditBalanceQuery.isLoading
                                                                ? '...'
                                                                : getPriceDisplay(creditBalance)}
                                                        </span>
                                                    </div>
                                                    <Button
                                                        type="button"
                                                        variant="outline"
                                                        onClick={handleCreditCheckout}
                                                        disabled={
                                                            isProcessing
                                                            || isCreditProcessing
                                                            || getTotalTickets() === 0
                                                            || salesClosed
                                                            || !canPayWithCredit
                                                        }
                                                        className="w-full bg-black/60 border-yellow-500/50 text-white hover:bg-yellow-500/10 hover:text-yellow-500 py-3 sm:py-4 text-base sm:text-lg font-semibold disabled:opacity-50"
                                                    >
                                                        {isCreditProcessing ? (
                                                            <Loader2 className="h-5 w-5 animate-spin mr-2" />
                                                        ) : (
                                                            <Wallet className="h-5 w-5 mr-2" />
                                                        )}
                                                        {isCreditProcessing
                                                            ? 'Processando...'
                                                            : 'Pagar com crédito EventFest'}
                                                    </Button>
                                                    {creditEligible && creditBalance < totalPrice && totalPrice > 0 && (
                                                        <p className="text-xs text-gray-400 text-center">
                                                            Saldo insuficiente para este pedido.{' '}
                                                            <button
                                                                type="button"
                                                                className="text-yellow-500 underline hover:text-yellow-400"
                                                                onClick={() => navigate('/wallet')}
                                                            >
                                                                Recarregar carteira
                                                            </button>
                                                        </p>
                                                    )}
                                                </div>
                                            )}
                                        </>
                                    )}
                                    <div className="mt-6 p-4 bg-black/40 rounded-xl">
                                        <div className="flex items-center text-yellow-500 mb-2">
                                            <i className="fas fa-shield-alt mr-2"></i>
                                            <span className="text-sm font-semibold">Compra Segura</span>
                                        </div>
                                        <p className="text-gray-400 text-xs">
                                            Seus dados estão protegidos e a compra é 100% segura.
                                        </p>
                                    </div>
                                    </>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </section>
            <footer className="bg-black border-t border-yellow-500/20 py-12 sm:py-16 px-4 sm:px-6">
                <div className="max-w-7xl mx-auto">
                    <LandingFooter isMobile={isMobile} />
                    <div className="border-t border-yellow-500/20 pt-6 text-center">
                        <p className="text-gray-400 text-sm">
                            © 2025 EventFest. Todos os direitos reservados.
                        </p>
                    </div>
                </div>
            </footer>
        </div>
    );
};

export default EventDetails;