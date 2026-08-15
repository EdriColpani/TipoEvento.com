import React, { useRef, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Button } from "@/components/ui/button";
import { useEventDetails, EventDetailsData, TicketType } from '@/hooks/use-event-details';
import { Check, Loader2, ShoppingCart, Wallet } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { showError, showSuccess, showLoading, dismissToast } from '@/utils/toast';
import { useAuthUserId } from '@/hooks/use-auth-user-id';
import { getAuthAccessToken } from '@/utils/auth-session-cache';
import { callRpcRest } from '@/utils/supabase-rest-rpc';
import { invokeEdgeFunctionRest } from '@/utils/edge-function-rest';
import { formatEventDateForDisplay, formatEventTimeForDisplay } from '@/utils/format-event-date';
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
    const { userId, sessionReady } = useAuthUserId();
    const isAuthenticated = sessionReady && Boolean(userId);
    const { isMobile } = useDevice();
    
    const [selectedTickets, setSelectedTickets] = useState<{ [key: string]: number }>({});
    const [isProcessing, setIsProcessing] = useState(false);
    const [isCreditProcessing, setIsCreditProcessing] = useState(false);
    const checkoutIdempotencyKeyRef = useRef<string>(generateRandomUuid());
    const queue = useEventCheckoutQueue(id, isAuthenticated && !details?.event.listing_only);

    const creditBalanceQuery = useQuery({
        queryKey: ['client-credit-balance-event', id],
        queryFn: () =>
            callRpcRest<{ balance?: number; status?: string }>('get_client_credit_balance', {}, 10_000),
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
        queryFn: () =>
            callRpcRest<{ biometric_threshold?: number }>('get_credit_wallet_status', {}, 10_000),
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
            navigate('/login', {
                state: { from: `${location.pathname}${location.search}`, eventState: location.state },
            });
            return false;
        }
        if (!details || !id) return false;
        return true;
    };

    const totalPrice = getTotalPrice();
    const queueCheckoutActive = isAuthenticated && !details?.event.listing_only;
    const checkoutBlockedByQueue = queueCheckoutActive && !queue.canCheckout;
    const queueBanner =
        queue.status === 'joining' || queue.status === 'idle' ? (
            <div className="rounded-xl border border-cyan-500/40 bg-cyan-500/10 p-4 text-sm text-cyan-100 mb-4">
                <div className="font-semibold text-white mb-1">Preparando fila virtual...</div>
                <p className="text-xs text-cyan-200/80">Aguarde alguns segundos antes de comprar.</p>
            </div>
        ) : queue.status === 'error' ? (
            <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-100 mb-4">
                <div className="font-semibold text-white mb-1">Fila virtual indisponível</div>
                <p>{queue.error ?? 'Recarregue a página para tentar novamente.'}</p>
            </div>
        ) : queue.queueEnabled && queue.status === 'waiting' ? (
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

        if (!queue.canCheckout) {
            if (queue.status === 'waiting') {
                showError('Aguarde sua vez na fila virtual para comprar.');
            } else if (queue.status === 'error') {
                showError(queue.error ?? 'Erro na fila virtual. Recarregue a página.');
            } else {
                showError('Aguarde a fila virtual liberar sua compra.');
            }
            return;
        }

        if (!queue.sessionToken) {
            showError('Sessão da fila não encontrada. Recarregue a página.');
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
            const accessToken = getAuthAccessToken();
            if (!accessToken) {
                dismissToast(toastId);
                showError("Sessão expirada. Faça login novamente.");
                navigate('/login', {
                    state: { from: `${location.pathname}${location.search}` },
                });
                return;
            }

            // fetch + timeout: supabase.functions.invoke pode ficar pendurado no getSession
            // e a UI nunca sai de "Processando...".
            const edgeData = await invokeEdgeFunctionRest<{
                checkoutUrl?: string;
                error?: string;
                hint?: string;
                mpCode?: string;
            }>(
                'create-payment-preference',
                {
                    eventId: id,
                    clientOrigin: typeof window !== 'undefined' ? window.location.origin : '',
                    idempotencyKey: checkoutIdempotencyKeyRef.current,
                    queueSessionToken: queue.sessionToken ?? undefined,
                    purchaseItems: purchaseItems.map((item) => ({
                        ticketTypeId: item.ticketTypeId,
                        quantity: item.quantity,
                        price: item.price,
                        name: item.name,
                    })),
                },
                {
                    timeoutMs: 45_000,
                    idempotencyKey: checkoutIdempotencyKeyRef.current,
                },
            );

            if (!edgeData) {
                throw new Error('Resposta vazia do servidor de pagamento. Tente novamente.');
            }

            if (edgeData.error) {
                let errorMessage = edgeData.error;
                if (edgeData.hint) {
                    errorMessage = `${edgeData.error} — ${edgeData.hint}`;
                } else if (edgeData.mpCode === 'PA_UNAUTHORIZED_RESULT_FROM_POLICIES') {
                    errorMessage =
                        'Pagamento bloqueado pelo Mercado Pago (políticas). Verifique no painel MP as URLs permitidas e as credenciais de produção.';
                }
                throw new Error(errorMessage);
            }

            if (!edgeData.checkoutUrl) {
                throw new Error(
                    'URL de pagamento não foi gerada. Por favor, tente novamente ou contate o suporte.',
                );
            }

            dismissToast(toastId);
            showSuccess('Redirecionando para o Mercado Pago...');
            checkoutIdempotencyKeyRef.current = generateRandomUuid();
            window.location.href = edgeData.checkoutUrl;
        } catch (error: unknown) {
            dismissToast(toastId);
            console.error('Erro ao criar preferência de pagamento:', error);
            const message =
                error instanceof Error ? error.message : 'Ocorreu um erro inesperado. Tente novamente.';
            if (message.includes('Sessão expirada')) {
                showError(message);
                navigate('/login', {
                    state: { from: `${location.pathname}${location.search}` },
                });
            } else {
                showError(message);
            }
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
            console.error('Erro ao pagar com crédito EventFest:', error);
            const message = error instanceof Error ? error.message : 'Erro ao pagar com crédito.';
            if (message.includes('Faça login') || message.includes('Sessão expirada')) {
                showError(message);
                navigate('/login', {
                    state: { from: `${location.pathname}${location.search}` },
                });
            } else {
                showError(message);
            }
        } finally {
            setIsCreditProcessing(false);
        }
    };

    if (isLoading) {
        return (
            <div className="min-h-screen bg-black text-white flex items-center justify-center">
                <Loader2 className="h-10 w-10 animate-spin text-yellow-500" />
            </div>
        );
    }

    if (isError || !details) {
        return (
            <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center px-4">
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
        <div className="min-h-screen bg-black text-white">
            {salesClosed && (
                <div
                    role="status"
                    className="bg-orange-950/95 border-b border-orange-500/50 px-4 py-2.5 text-center text-sm text-orange-100"
                >
                    {salesClosedInactive
                        ? 'Este evento foi desativado pelo organizador e não está aceitando novas compras de ingressos.'
                        : 'O prazo para compra de ingressos deste evento foi encerrado (início do evento).'}
                </div>
            )}
            <section className="pb-0 flex justify-center">
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
                                <h1 className="text-3xl sm:text-5xl lg:text-6xl font-serif text-white mb-3 sm:mb-6 leading-tight line-clamp-3 break-words">
                                    {event.title}
                                </h1>
                                <p className="text-base sm:text-xl text-gray-200 mb-4 sm:mb-8 leading-relaxed line-clamp-3 break-words">
                                    {event.description}
                                </p>
                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6 mb-6 sm:mb-8">
                                    <div className="flex items-center min-w-0">
                                        <i className="fas fa-calendar-alt text-yellow-500 text-xl sm:text-2xl mr-3 sm:mr-4 shrink-0"></i>
                                        <div className="min-w-0">
                                            <div className="text-xs sm:text-sm text-gray-400">Data</div>
                                            <div className="text-sm sm:text-lg font-semibold text-white truncate">
                                                {formatEventDateForDisplay(event.date) || '—'}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex items-center min-w-0">
                                        <i className="fas fa-clock text-yellow-500 text-xl sm:text-2xl mr-3 sm:mr-4 shrink-0"></i>
                                        <div className="min-w-0">
                                            <div className="text-xs sm:text-sm text-gray-400">Horário</div>
                                            <div className="text-sm sm:text-lg font-semibold text-white truncate">
                                                {formatEventTimeForDisplay(event.time)}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex items-center min-w-0">
                                        <i className="fas fa-map-marker-alt text-yellow-500 text-xl sm:text-2xl mr-3 sm:mr-4 shrink-0"></i>
                                        <div className="min-w-0">
                                            <div className="text-xs sm:text-sm text-gray-400">Local</div>
                                            <div className="text-sm sm:text-lg font-semibold text-white truncate" title={event.location}>
                                                {event.location}
                                            </div>
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
                                                {event.min_price != null && event.min_price > 0
                                                    ? `A partir de ${minPriceDisplay}`
                                                    : minPriceDisplay}
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
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 lg:gap-12 lg:items-start">
                        <div className="lg:col-span-2 space-y-8 sm:space-y-12 order-2 lg:order-1">
                            <div>
                                <h2 className="text-2xl sm:text-3xl font-serif text-yellow-500 mb-4 sm:mb-6 min-h-[2.5rem] sm:min-h-[3rem] flex items-end">
                                    Sobre o Evento
                                </h2>
                                <div className="bg-black/60 backdrop-blur-sm border border-yellow-500/30 rounded-2xl p-6 sm:p-8">
                                    <p className="text-gray-300 text-sm sm:text-base leading-relaxed mb-6 break-words whitespace-pre-wrap">
                                        {event.description}
                                    </p>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6 border-t border-yellow-500/20 pt-6">
                                        <div className="space-y-3 sm:space-y-4">
                                            <div className="flex items-start text-sm sm:text-base min-w-0">
                                                <i className="fas fa-users text-yellow-500 mr-3 mt-0.5 shrink-0"></i>
                                                <span className="text-white break-words">Capacidade: {capacityDisplay}</span>
                                            </div>
                                            <div className="flex items-start text-sm sm:text-base min-w-0">
                                                <i className="fas fa-clock text-yellow-500 mr-3 mt-0.5 shrink-0"></i>
                                                <span className="text-white break-words">Duração: {durationDisplay}</span>
                                            </div>
                                        </div>
                                        <div className="space-y-3 sm:space-y-4">
                                            <div className="flex items-start text-sm sm:text-base min-w-0">
                                                <i className="fas fa-user-check text-yellow-500 mr-3 mt-0.5 shrink-0"></i>
                                                <span className="text-white break-words">
                                                    Classificação: {event.min_age === 0 ? 'Livre' : `${event.min_age} anos`}
                                                </span>
                                            </div>
                                            <div className="flex items-start text-sm sm:text-base min-w-0">
                                                <i className="fas fa-user-tie text-yellow-500 mr-3 mt-0.5 shrink-0"></i>
                                                <span className="text-white break-words" title={organizerName}>
                                                    Organizador: {organizerName}
                                                </span>
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
                            <div className="lg:sticky lg:top-32 xl:top-36">
                                <h2 className="text-2xl sm:text-3xl font-serif text-yellow-500 mb-4 sm:mb-6 min-h-[2.5rem] sm:min-h-[3rem] flex items-end">
                                    {isListingOnly ? 'Divulgação' : 'Selecionar Ingressos'}
                                </h2>
                                <div className="bg-black/80 backdrop-blur-sm border border-yellow-500/30 rounded-2xl p-6 sm:p-8">
                                    {isListingOnly ? (
                                        <div className="text-center space-y-4">
                                            <p className="text-gray-300 text-sm leading-relaxed">
                                                Este evento está publicado apenas para divulgação. Ingressos não são vendidos
                                                pela plataforma — consulte o organizador para mais informações.
                                            </p>
                                            <p className="text-gray-500 text-xs break-words">
                                                Organizador: {organizerName}
                                            </p>
                                        </div>
                                    ) : (
                                    <>
                                    <div className="space-y-6">
                                        {ticketTypes.length > 0 ? (
                                            ticketTypes.map((ticket: TicketType) => (
                                                <div
                                                    key={ticket.id}
                                                    className="bg-black/60 border border-yellow-500/20 rounded-xl p-4 sm:p-6"
                                                >
                                                    <div className="flex justify-between items-start mb-4">
                                                        <div>
                                                            <h4 className="text-white font-semibold text-base sm:text-lg">{ticket.name}</h4>
                                                            <p className="text-gray-400 text-xs sm:text-sm mt-1">{ticket.description}</p>
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
                                                                disabled={ticket.available === 0 || (selectedTickets[ticket.id] || 0) === 0 || isProcessing || isCreditProcessing || salesClosed}
                                                            >
                                                                <i className="fas fa-minus text-xs"></i>
                                                            </button>
                                                            <span className="text-white font-semibold w-6 sm:w-8 text-center text-sm sm:text-base">
                                                                {selectedTickets[ticket.id] || 0}
                                                            </span>
                                                            <button
                                                                onClick={() => handleTicketChange(ticket.id, (selectedTickets[ticket.id] || 0) + 1)}
                                                                className="w-7 h-7 sm:w-8 sm:h-8 bg-yellow-500/20 border border-yellow-500/40 rounded-full flex items-center justify-center text-yellow-500 hover:bg-yellow-500/30 transition-all duration-300 cursor-pointer"
                                                                disabled={(selectedTickets[ticket.id] || 0) >= ticket.available || isProcessing || isCreditProcessing || salesClosed}
                                                            >
                                                                <i className="fas fa-plus text-xs"></i>
                                                            </button>
                                                        </div>
                                                    </div>
                                                </div>
                                            ))
                                        ) : (
                                            <div className="text-center p-4 bg-black/60 rounded-xl border border-amber-500/30">
                                                <p className="text-amber-200/90 text-sm">
                                                    Nenhum ingresso disponível para venda no momento.
                                                    {salesClosed
                                                        ? ' As vendas deste evento foram encerradas.'
                                                        : ' Aguarde a abertura do próximo lote ou verifique as datas configuradas.'}
                                                </p>
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