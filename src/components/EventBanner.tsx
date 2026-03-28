import React from 'react';
import { EventData } from '@/hooks/use-event-details';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';
import { formatEventDateForDisplay } from '@/utils/format-event-date';

interface EventBannerProps {
    event: EventData;
    minPriceDisplay: string;
    // Adicionando uma prop opcional para renderizar o botão de ação
    showActionButton?: boolean; 
}

const EventBanner: React.FC<EventBannerProps> = ({ event, minPriceDisplay, showActionButton = false }) => {
    const navigate = useNavigate();
    
    return (
        <section className="relative h-[450px] md:h-[600px] lg:h-[700px] overflow-hidden pt-20"> {/* Ajustado o padding-top */}
            <img
                src={event.image_url}
                alt={event.title}
                className="w-full h-full object-cover object-top"
            />
            {/* Overlay escuro com gradiente */}
            <div className="absolute inset-0 bg-gradient-to-r from-black/90 via-black/70 to-black/40"></div>
            
            <div className="absolute inset-0 flex items-end pb-16 pt-20"> {/* Alinha o conteúdo na parte inferior */}
                <div className="max-w-7xl mx-auto px-4 sm:px-6 w-full">
                    <div className="max-w-full lg:max-w-4xl">
                        {/* Categoria */}
                        <div className="inline-block bg-yellow-500 text-black px-4 py-1.5 rounded-lg text-sm sm:text-base font-semibold mb-4">
                            {event.category}
                        </div>
                        
                        {/* Título */}
                        <h1 className="text-4xl sm:text-6xl lg:text-7xl font-serif text-white mb-4 sm:mb-6 leading-tight drop-shadow-lg">
                            {event.title}
                        </h1>
                        
                        {/* Descrição */}
                        <p className="text-base sm:text-xl text-gray-200 mb-6 sm:mb-10 leading-relaxed line-clamp-3 drop-shadow-md">
                            {event.description}
                        </p>
                        
                        {/* Detalhes (Data, Horário, Local) */}
                        <div className="flex flex-wrap gap-x-10 gap-y-4 mb-8 sm:mb-12">
                            <div className="flex items-center">
                                <i className="fas fa-calendar-alt text-yellow-500 text-2xl mr-3"></i>
                                <div>
                                    <div className="text-xs text-gray-400">Data</div>
                                    <div className="text-lg font-bold text-white">{formatEventDateForDisplay(event.date) || '—'}</div>
                                </div>
                            </div>
                            <div className="flex items-center">
                                <i className="fas fa-clock text-yellow-500 text-2xl mr-3"></i>
                                <div>
                                    <div className="text-xs text-gray-400">Horário</div>
                                    <div className="text-lg font-bold text-white">{event.time}</div>
                                </div>
                            </div>
                            <div className="flex items-center">
                                <i className="fas fa-map-marker-alt text-yellow-500 text-2xl mr-3"></i>
                                <div>
                                    <div className="text-xs text-gray-400">Local</div>
                                    <div className="text-lg font-bold text-white">{event.location}</div>
                                </div>
                            </div>
                        </div>
                        
                        {/* Preço e Botão */}
                        <div className="flex flex-col sm:flex-row items-start sm:items-center space-y-4 sm:space-y-0 sm:space-x-6">
                            <span className="text-3xl sm:text-4xl font-bold text-yellow-500">
                                {minPriceDisplay}
                            </span>
                            {showActionButton && (
                                <Button 
                                    onClick={() => navigate(`/events/${event.id}`)}
                                    className="w-full sm:w-auto bg-yellow-500 text-black hover:bg-yellow-600 px-8 py-3 text-base sm:text-lg font-semibold transition-all duration-300 cursor-pointer hover:scale-105"
                                >
                                    Comprar Ingressos
                                </Button>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
};

export default EventBanner;