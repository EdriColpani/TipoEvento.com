import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import AuthStatusMenu from '@/components/AuthStatusMenu';
import { Input } from '@/components/ui/input';
import { useEventDetails, EventDetailsData, TicketType } from '@/hooks/use-event-details';
import { Loader2, ShoppingCart } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { showError, showSuccess, showLoading, dismissToast } from '@/utils/toast'; // Importando showLoading/dismissToast
import { useAuthRedirect } from '@/hooks/use-auth-redirect';
import { supabase } from '@/integrations/supabase/client'; // Importando supabase
import { FunctionsHttpError } from '@supabase/supabase-js'; // Importando o tipo de erro específico

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
    
    const { details, isLoading, isError } = useEventDetails(id);
    const { isAuthenticated, redirectToLogin } = useAuthRedirect();
    
    const [selectedTickets, setSelectedTickets] = useState<{ [key: string]: number }>({});
    const [isProcessing, setIsProcessing] = useState(false); // Novo estado para o spinner

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
    
    const handleCheckout = async () => {
        const totalTickets = getTotalTickets();
        
        if (totalTickets === 0) {
            showError("Selecione pelo menos um ingresso para prosseguir.");
            return;
        }
        
        if (!isAuthenticated) {
            showError("Você precisa estar logado para comprar ingressos.");
            redirectToLogin();
            return;
        }
        
        if (!details || !id) return;

        // 1. Preparar itens de compra
        const purchaseItems: PurchaseItem[] = details.ticketTypes
            .filter(ticket => selectedTickets[ticket.id] > 0)
            .map(ticket => ({
                ticketTypeId: ticket.id,
                quantity: selectedTickets[ticket.id],
                price: ticket.price,
                name: ticket.name,
            }));
            
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
                navigate('/login');
                return;
            }
            
            // 3. Chamar o Edge Function para criar a preferência de pagamento
            const response = await supabase.functions.invoke('create-payment-preference', {
                body: {
                    eventId: id,
                    purchaseItems: purchaseItems.map(item => ({
                        ticketTypeId: item.ticketTypeId,
                        quantity: item.quantity,
                        price: item.price,
                        name: item.name,
                    })),
                },
                headers: {
                    'Authorization': `Bearer ${session.access_token}`,
                }
            });

            let errorMessage = "Falha ao iniciar o pagamento. Tente novamente.";

            if (response.error) {
                console.error("Edge Function error:", response.error);
                
                // Se for um FunctionsHttpError, tenta obter o erro específico do corpo da resposta
                if (response.data && typeof response.data === 'object' && 'error' in response.data) {
                    errorMessage = (response.data as { error: string }).error;
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
                            Mazoy
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
            <section className="pt-20 pb-0 flex justify-center">
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
                                            <div className="text-sm sm:text-lg font-semibold text-white">{new Date(event.date).toLocaleDateString('pt-BR')}</div>
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
                                    <span className="text-2xl sm:text-4xl font-bold text-yellow-500">
                                        A partir de {minPriceDisplay}
                                    </span>
                                    <Button 
                                        onClick={handleCheckout}
                                        disabled={isProcessing || getTotalTickets() === 0}
                                        className="w-full sm:w-auto bg-yellow-500 text-black hover:bg-yellow-600 px-6 sm:px-8 py-3 text-base sm:text-lg font-semibold transition-all duration-300 cursor-pointer hover:scale-105 disabled:opacity-50"
                                    >
                                        {isProcessing ? (
                                            <Loader2 className="h-5 w-5 animate-spin mr-2" />
                                        ) : (
                                            <ShoppingCart className="h-5 w-5 mr-2" />
                                        )}
                                        {isProcessing ? 'Processando...' : 'Comprar Ingressos'}
                                    </Button>
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
                                <h3 className="text-xl sm:text-2xl font-serif text-yellow-500 mb-4 sm:mb-6">Destaques do Evento</h3>
                                <div className="bg-black/60 backdrop-blur-sm border border-yellow-500/30 rounded-2xl p-6 sm:p-8">
                                    <div className="text-gray-400">
                                        {/* Placeholder para destaques, pois não temos este campo no DB */}
                                        <p>Destaques não disponíveis no momento. Consulte a descrição.</p>
                                    </div>
                                </div>
                            </div>
                            <div>
                                <h3 className="text-xl sm:text-2xl font-serif text-yellow-500 mb-4 sm:mb-6">Localização</h3>
                                <div className="bg-black/60 backdrop-blur-sm border border-yellow-500/30 rounded-2xl p-6 sm:p-8">
                                    <div className="flex items-start space-x-4 mb-6">
                                        <i className="fas fa-map-marker-alt text-yellow-500 text-xl mt-1 flex-shrink-0"></i>
                                        <div>
                                            <h4 className="text-white font-semibold text-base sm:text-lg mb-2">{event.location}</h4>
                                            <p className="text-gray-300 text-sm sm:text-base">{event.address}</p>
                                        </div>
                                    </div>
                                    <div className="bg-black/40 rounded-xl h-48 sm:h-64 flex items-center justify-center">
                                        <div className="text-center">
                                            <i className="fas fa-map text-yellow-500 text-3xl sm:text-4xl mb-4"></i>
                                            <p className="text-gray-400 text-sm">Mapa interativo em breve</p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div className="lg:col-span-1 order-1 lg:order-2">
                            <div className="lg:sticky lg:top-24">
                                <div className="bg-black/80 backdrop-blur-sm border border-yellow-500/30 rounded-2xl p-6 sm:p-8">
                                    <h3 className="text-xl sm:text-2xl font-serif text-yellow-500 mb-6">Selecionar Ingressos</h3>
                                    <div className="space-y-6">
                                        {ticketTypes.length > 0 ? (
                                            ticketTypes.map((ticket: TicketType) => (
                                                <div key={ticket.id} className="bg-black/60 border border-yellow-500/20 rounded-xl p-4 sm:p-6">
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
                                                                disabled={ticket.available === 0 || (selectedTickets[ticket.id] || 0) === 0 || isProcessing}
                                                            >
                                                                <i className="fas fa-minus text-xs"></i>
                                                            </button>
                                                            <span className="text-white font-semibold w-6 sm:w-8 text-center text-sm sm:text-base">
                                                                {selectedTickets[ticket.id] || 0}
                                                            </span>
                                                            <button
                                                                onClick={() => handleTicketChange(ticket.id, (selectedTickets[ticket.id] || 0) + 1)}
                                                                className="w-7 h-7 sm:w-8 sm:h-8 bg-yellow-500/20 border border-yellow-500/40 rounded-full flex items-center justify-center text-yellow-500 hover:bg-yellow-500/30 transition-all duration-300 cursor-pointer"
                                                                disabled={(selectedTickets[ticket.id] || 0) >= ticket.available || isProcessing}
                                                            >
                                                                <i className="fas fa-plus text-xs"></i>
                                                            </button>
                                                        </div>
                                                    </div>
                                                </div>
                                            ))
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
                                            <Button 
                                                onClick={handleCheckout}
                                                disabled={isProcessing || getTotalTickets() === 0}
                                                className="w-full bg-yellow-500 text-black hover:bg-yellow-600 py-3 sm:py-4 text-base sm:text-lg font-semibold transition-all duration-300 cursor-pointer hover:scale-105 disabled:opacity-50"
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
                                    <div className="mt-6 p-4 bg-black/40 rounded-xl">
                                        <div className="flex items-center text-yellow-500 mb-2">
                                            <i className="fas fa-shield-alt mr-2"></i>
                                            <span className="text-sm font-semibold">Compra Segura</span>
                                        </div>
                                        <p className="text-gray-400 text-xs">
                                            Seus dados estão protegidos e a compra é 100% segura.
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </section>
            <footer className="bg-black border-t border-yellow-500/20 py-12 sm:py-16 px-4 sm:px-6">
                <div className="max-w-7xl mx-auto">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-10 sm:mb-12">
                        <div className="col-span-2 md:col-span-1">
                            <div className="text-xl sm:text-2xl font-serif text-yellow-500 font-bold mb-4">
                                Mazoy
                            </div>
                            <p className="text-gray-400 text-sm leading-relaxed">
                                A plataforma premium para eventos exclusivos e experiências inesquecíveis.
                            </p>
                        </div>
                        <div>
                            <h4 className="text-white font-semibold mb-4 text-base sm:text-lg">Links Úteis</h4>
                            <ul className="space-y-2 text-sm">
                                <li><a href="#" className="text-gray-400 hover:text-yellow-500 transition-colors cursor-pointer">Sobre Nós</a></li>
                                <li><a href="#" className="text-400 hover:text-yellow-500 transition-colors cursor-pointer">Como Funciona</a></li>
                                <li><a href="#" className="text-gray-400 hover:text-yellow-500 transition-colors cursor-pointer">Termos de Uso</a></li>
                                <li><a href="#" className="text-gray-400 hover:text-yellow-500 transition-colors cursor-pointer">Privacidade</a></li>
                            </ul>
                        </div>
                        <div>
                            <h4 className="text-white font-semibold mb-4 text-base sm:text-lg">Suporte</h4>
                            <ul className="space-y-2 text-sm">
                                <li><a href="#" className="text-gray-400 hover:text-yellow-500 transition-colors cursor-pointer">Central de Ajuda</a></li>
                                <li><a href="#" className="text-gray-400 hover:text-yellow-500 transition-colors cursor-pointer">Contato</a></li>
                                <li><a href="#" className="text-gray-400 hover:text-yellow-500 transition-colors cursor-pointer">FAQ</a></li>
                                <li><a href="#" className="text-gray-400 hover:text-yellow-500 transition-colors cursor-pointer">Feedback</a></li>
                            </ul>
                        </div>
                        <div>
                            <h4 className="text-white font-semibold mb-4 text-base sm:text-lg">Redes Sociais</h4>
                            <div className="flex space-x-4">
                                <a href="#" className="text-yellow-500 hover:text-yellow-600 transition-colors cursor-pointer">
                                    <i className="fab fa-instagram text-xl sm:text-2xl"></i>
                                </a>
                                <a href="#" className="text-yellow-500 hover:text-yellow-600 transition-colors cursor-pointer">
                                    <i className="fab fa-facebook text-xl sm:text-2xl"></i>
                                </a>
                                <a href="#" className="text-yellow-500 hover:text-yellow-600 transition-colors cursor-pointer">
                                    <i className="fab fa-twitter text-xl sm:text-2xl"></i>
                                </a>
                                <a href="#" className="text-yellow-500 hover:text-yellow-600 transition-colors cursor-pointer">
                                    <i className="fab fa-linkedin text-xl sm:text-2xl"></i>
                                </a>
                            </div>
                        </div>
                    </div>
                    <div className="border-t border-yellow-500/20 pt-6 text-center">
                        <p className="text-gray-400 text-sm">
                            © 2025 Mazoy. Todos os direitos reservados.
                        </p>
                    </div>
                </div>
            </footer>
        </div>
    );
};

export default EventDetails;