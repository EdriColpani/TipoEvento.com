import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useEventDetails } from '@/hooks/use-event-details';
import { Loader2 } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { showError } from '@/utils/toast';
import { formatEventDateForDisplay } from '@/utils/format-event-date';

// Helper function to get the minimum price display
const getMinPriceDisplay = (price: number | null): string => {
    if (price === null || price === 0) return 'Grátis';
    return `R$ ${price.toFixed(2).replace('.', ',')}`;
};

const FinalizarCompra: React.FC = () => {
    const location = useLocation();
    const navigate = useNavigate();
    
    // 1. Obter o ID do evento do estado de navegação
    const eventId = location.state?.eventId as string | undefined;

    // 2. Buscar os detalhes do evento
    const { details, isLoading, isError } = useEventDetails(eventId);

    if (!eventId) {
        // Se não houver ID, redireciona para a home
        React.useEffect(() => {
            showError("Nenhum evento selecionado para a compra.");
            navigate('/', { replace: true });
        }, [navigate]);
        
        return (
            <div className="min-h-screen bg-black text-white flex items-center justify-center">
                <Loader2 className="h-10 w-10 animate-spin text-yellow-500" />
            </div>
        );
    }

    if (isLoading) {
        return (
            <div className="min-h-screen bg-black text-white flex items-center justify-center">
                <Loader2 className="h-10 w-10 animate-spin text-yellow-500" />
            </div>
        );
    }

    if (isError || !details) {
        return (
            <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center pt-20 px-4">
                <h1 className="text-4xl font-serif text-red-500 mb-4">Erro</h1>
                <p className="text-xl text-gray-400 mb-6">Não foi possível carregar os detalhes do evento.</p>
                <Button onClick={() => navigate('/')} className="bg-yellow-500 text-black hover:bg-yellow-600">
                    Voltar para a Home
                </Button>
            </div>
        );
    }
    
    const { event, ticketTypes } = details;
    // Usando event.min_price que agora é calculado no hook
    const minPriceDisplay = getMinPriceDisplay(event.min_price);

    return (
        <div className="min-h-screen bg-black text-white">
            {/* Banner do Evento (Replicando o estilo da imagem) */}
            <section className="relative h-[400px] md:h-[500px] lg:h-[600px] overflow-hidden">
                <img
                    src={event.image_url}
                    alt={event.title}
                    className="w-full h-full object-cover object-top"
                />
                {/* Overlay escuro com gradiente */}
                <div className="absolute inset-0 bg-gradient-to-r from-black/90 via-black/70 to-black/40"></div>
                
                <div className="absolute inset-0 flex items-center">
                    <div className="max-w-7xl mx-auto px-4 sm:px-6 w-full">
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
                                <span className="text-2xl sm:text-4xl font-bold text-yellow-500">
                                    A partir de {minPriceDisplay}
                                </span>
                                <Button 
                                    onClick={() => navigate('/')}
                                    className="w-full sm:w-auto bg-yellow-500 text-black hover:bg-yellow-600 px-6 sm:px-8 py-3 text-base sm:text-lg font-semibold transition-all duration-300 cursor-pointer hover:scale-105"
                                >
                                    Voltar para Eventos
                                </Button>
                            </div>
                        </div>
                    </div>
                </div>
            </section>
            
            {/* Conteúdo principal da finalização de compra */}
            <main className="py-12 sm:py-20 px-4 sm:px-6 max-w-7xl mx-auto">
                <h2 className="text-3xl font-serif text-white mb-8">Finalizar Compra</h2>
                <p className="text-gray-400">Conteúdo do checkout será implementado aqui.</p>
            </main>
        </div>
    );
};

export default FinalizarCompra;