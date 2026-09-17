"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import useEmblaCarousel, { EmblaCarouselType } from 'embla-carousel-react';
import { Card, CardContent } from "@/components/ui/card";
import { PublicEvent } from '@/hooks/use-public-events';
import { Button } from '@/components/ui/button';
import { ArrowRight, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface EventCarouselProps {
    events: PublicEvent[];
}

const AUTOPLAY_DELAY = 6000; // 6 segundos

// Helper function to get the minimum price display
const getMinPriceDisplay = (price: number | null): string => {
    if (price === null || price === 0) return 'Grátis';
    // Formata para R$ X.XX, usando vírgula como separador decimal
    return `R$ ${price.toFixed(2).replace('.', ',')}`;
};

const EventCarousel = ({ events }: EventCarouselProps) => {
    const navigate = useNavigate();
    
    // Limita a 20 eventos
    const featuredEvents = events.slice(0, 20);

    const [emblaRef, emblaApi] = useEmblaCarousel({ 
        loop: true,
        align: 'start',
        slidesToScroll: 1,
        breakpoints: {
            '(min-width: 640px)': { slidesToScroll: 2 },
            '(min-width: 1024px)': { slidesToScroll: 3 },
        },
        watchDrag: true,
    });
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [scrollSnaps, setScrollSnaps] = useState<number[]>([]);
    const [prevBtnDisabled, setPrevBtnDisabled] = useState(true);
    const [nextBtnDisabled, setNextBtnDisabled] = useState(true);


    // --- Lógica de Auto-Play ---
    const autoplay = useCallback(() => {
        if (!emblaApi) return;
        if (emblaApi.canScrollNext()) {
            emblaApi.scrollNext();
        } else {
            emblaApi.scrollTo(0);
        }
    }, [emblaApi]);

    useEffect(() => {
        if (!emblaApi) return;

        const timer = setInterval(autoplay, AUTOPLAY_DELAY);

        return () => {
            clearInterval(timer);
        };
    }, [emblaApi, autoplay]);

    // --- Lógica de Navegação e Indicadores ---
    const onSelect = useCallback((emblaApi: EmblaCarouselType) => {
        setSelectedIndex(emblaApi.selectedScrollSnap());
        setPrevBtnDisabled(!emblaApi.canScrollPrev());
        setNextBtnDisabled(!emblaApi.canScrollNext());
    }, []);

    const onInit = useCallback((emblaApi: EmblaCarouselType) => {
        setScrollSnaps(emblaApi.scrollSnapList());
    }, []);

    useEffect(() => {
        if (!emblaApi) return;
        onInit(emblaApi);
        onSelect(emblaApi);
        emblaApi.on('reInit', onInit);
        emblaApi.on('select', onSelect);
    }, [emblaApi, onInit, onSelect]);

    const scrollTo = useCallback((index: number) => {
        emblaApi && emblaApi.scrollTo(index);
    }, [emblaApi]);
    
    const scrollPrev = useCallback(() => {
        emblaApi && emblaApi.scrollPrev();
    }, [emblaApi]);

    const scrollNext = useCallback(() => {
        emblaApi && emblaApi.scrollNext();
    }, [emblaApi]);


    if (featuredEvents.length === 0) {
        return (
            <div className="flex items-center justify-center h-full bg-black/60 border border-yellow-500/30 rounded-2xl shadow-2xl shadow-yellow-500/20">
                <div className="text-center p-8">
                    <i className="fas fa-star text-yellow-500 text-4xl mb-4"></i>
                    <h2 className="text-xl sm:text-2xl font-serif text-white mb-2">Destaques Premium</h2>
                    <p className="text-gray-400 text-sm">Nenhum evento em destaque encontrado.</p>
                </div>
            </div>
        );
    }

    return (
        <div className="relative">
            <div className="overflow-hidden" ref={emblaRef}>
                <div className="flex touch-pan-y ml-[-1rem]"> {/* Ajuste de margem para compensar o padding/gap */}
                    {featuredEvents.map((event, index) => (
                        <div 
                            key={event.id} 
                            className="pl-4 basis-full sm:basis-1/2 lg:basis-1/3 flex-shrink-0 min-w-0"
                        >
                            <Card 
                                className="bg-black/60 backdrop-blur-sm border border-yellow-500/30 rounded-2xl overflow-hidden h-full cursor-pointer hover:border-yellow-500/60 transition-all duration-300 group"
                                // CORRIGIDO: Navega para a tela de detalhes do evento
                                onClick={() => navigate(`/events/${event.id}`)}
                            >
                                <CardContent className="flex flex-col p-0">
                                    <div className="relative aspect-video overflow-hidden bg-black">
                                        <img
                                            src={event.image_url}
                                            alt={event.title}
                                            className="w-full h-full object-contain object-center group-hover:scale-105 transition-transform duration-500"
                                        />
                                        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent p-4 flex flex-col justify-end">
                                            <span className="bg-yellow-500 text-black px-3 py-1 rounded-full text-xs font-semibold mb-2 self-start">
                                                {event.category}
                                            </span>
                                            <h3 className="text-xl font-serif text-white line-clamp-2 group-hover:text-yellow-400 transition-colors">
                                                {event.title}
                                            </h3>
                                        </div>
                                    </div>
                                    <div className="p-4 space-y-2">
                                        <div className="flex items-center text-sm text-gray-300">
                                            <i className="fas fa-calendar-alt mr-2 text-yellow-500"></i>
                                            {event.date}
                                        </div>
                                        <div className="flex items-center text-sm text-gray-300">
                                            <i className="fas fa-map-marker-alt mr-2 text-yellow-500"></i>
                                            {event.location}
                                        </div>
                                        <div className="flex justify-between items-center pt-2">
                                            <span className="text-xl font-bold text-yellow-500 whitespace-nowrap">
                                                {getMinPriceDisplay(event.min_price)}
                                            </span>
                                            <Button 
                                                variant="default" 
                                                className="bg-yellow-500 text-black hover:bg-yellow-600 px-4 py-2 text-xs"
                                                // CORRIGIDO: Botão também navega para a tela de detalhes do evento
                                                onClick={(e) => {
                                                    e.stopPropagation(); // Evita que o clique no botão acione o clique do card
                                                    navigate(`/events/${event.id}`);
                                                }}
                                            >
                                                Detalhes <ArrowRight className="h-3 w-3 ml-1" />
                                            </Button>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        </div>
                    ))}
                </div>
            </div>
            
            {/* Setas de Navegação Customizadas */}
            <Button
                variant="outline"
                className="absolute left-4 top-1/2 transform -translate-y-1/2 z-10 text-yellow-500 border-yellow-500 hover:bg-yellow-500/10 w-10 h-10 p-0 rounded-full"
                onClick={scrollPrev}
                disabled={prevBtnDisabled && featuredEvents.length > 1}
            >
                <ChevronLeft className="h-5 w-5" />
            </Button>
            <Button
                variant="outline"
                className="absolute right-4 top-1/2 transform -translate-y-1/2 z-10 text-yellow-500 border-yellow-500 hover:bg-yellow-500/10 w-10 h-10 p-0 rounded-full"
                onClick={scrollNext}
                disabled={nextBtnDisabled && featuredEvents.length > 1}
            >
                <ChevronRight className="h-5 w-5" />
            </Button>

            {/* Indicadores (Bolinhas) */}
            <div className="absolute bottom-[-2rem] left-0 right-0 flex justify-center space-x-2 z-10">
                {scrollSnaps.map((_, index) => (
                    <button
                        key={index}
                        onClick={() => scrollTo(index)}
                        className={cn(
                            "w-3 h-3 rounded-full transition-all duration-300",
                            index === selectedIndex ? "bg-yellow-500 w-6" : "bg-gray-500/50 hover:bg-yellow-500/50"
                        )}
                    />
                ))}
            </div>
        </div>
    );
};

export default EventCarousel;