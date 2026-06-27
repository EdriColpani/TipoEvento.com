import React, { useState, useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useCarouselBanners } from '@/hooks/use-carousel-banners';
import { useCarouselSettings } from '@/hooks/use-carousel-settings';
import { useNavigate } from 'react-router-dom';

// Dimensões Máximas Solicitadas
const MAX_WIDTH = 770;
const MAX_HEIGHT = 450;
const ASPECT_RATIO_FIXED = MAX_WIDTH / MAX_HEIGHT; // 1.711...

const HORIZONTAL_PADDING = 40; // 20px left + 20px right (do padding do containerRef)
const BANNER_MARGIN = 40; // Margem extra de 20px de cada lado para o banner central

// Cores de borda para visualização (usando cores Tailwind)
const BORDER_COLORS = [
    'border-yellow-500/50', // Distância 1
    'border-blue-500/50',   // Distância 2
    'border-green-500/50',  // Distância 3
    'border-red-500/50',    // Distância 4
];

const Carousel3D: React.FC = () => {
    const navigate = useNavigate();
    const { banners: allItems, isLoading, isError } = useCarouselBanners();
    const { settings } = useCarouselSettings();
    
    const [currentIndex, setCurrentIndex] = useState(0);
    const [containerWidth, setContainerWidth] = useState(0);
    const containerRef = useRef<HTMLDivElement>(null);
    
    const totalItems = allItems.length;

    // 1. Medir a largura do contêiner (área interna do p-5)
    useEffect(() => {
        const updateWidth = () => {
            if (containerRef.current) {
                // containerWidth é a largura interna do div com p-5
                setContainerWidth(containerRef.current.offsetWidth - HORIZONTAL_PADDING);
            }
        };
        
        updateWidth();
        window.addEventListener('resize', updateWidth);
        return () => window.removeEventListener('resize', updateWidth);
    }, []);

    // Sincroniza o índice quando os itens mudam
    useEffect(() => {
        if (totalItems > 0) {
            setCurrentIndex(prev => Math.min(prev, totalItems - 1));
        } else {
            setCurrentIndex(0);
        }
    }, [totalItems]);
    
    // --- ROTAÇÃO AUTOMÁTICA ---
    useEffect(() => {
        if (totalItems <= 1) return;

        // Usa o tempo de rotação das configurações, com fallback para 8 segundos (8000ms)
        const rotationTime = (settings.rotation_time_seconds > 0 ? settings.rotation_time_seconds : 8) * 1000;

        const interval = setInterval(() => {
            setCurrentIndex(prev => (prev + 1) % totalItems);
        }, rotationTime);

        return () => clearInterval(interval);
    }, [totalItems, settings.rotation_time_seconds]);
    
    // --- CÁLCULO RESPONSIVO COM LIMITE MÁXIMO ---
    
    // 1. Calcula a largura máxima que o banner pode ter dentro do contêiner
    const responsiveWidth = containerWidth > 0 ? containerWidth - BANNER_MARGIN : MAX_WIDTH;
    
    // 2. Define a largura base (limitada ao MAX_WIDTH)
    const baseWidth = Math.min(responsiveWidth, MAX_WIDTH);
    
    // 3. Calcula a altura base mantendo a proporção 770:450
    const baseHeight = baseWidth / ASPECT_RATIO_FIXED;
    
    // Fator de translação: 18% da largura base para garantir que os banners laterais se sobreponham
    const TRANSLATION_FACTOR = baseWidth * 0.18; 
    
    // Define quantos itens renderizar (Aumentado para 9, mas limitado a 7 em telas pequenas)
    const maxRendered = containerWidth < 640 ? 7 : 9; 

    if (isLoading || isError || totalItems === 0) {
        return null;
    }
    
    // --- Lógica de Renderização dos Itens Visíveis ---
    const itemsToRender: Array<{
        item: (typeof allItems)[number];
        realIndex: number;
        offset: number;
    }> = [];

    if (totalItems <= maxRendered) {
        // Poucos slides: um por índice, centralizado no atual (evita offset -4 fora da tela).
        for (let realIndex = 0; realIndex < totalItems; realIndex++) {
            const offset = realIndex - currentIndex;
            itemsToRender.push({ item: allItems[realIndex], realIndex, offset });
        }
    } else {
        const startOffset = -Math.floor(maxRendered / 2);

        for (let i = 0; i < maxRendered; i++) {
            const offset = startOffset + i;
            const realIndex = (currentIndex + offset + totalItems) % totalItems;

            if (itemsToRender.some((entry) => entry.realIndex === realIndex)) continue;

            itemsToRender.push({
                item: allItems[realIndex],
                realIndex,
                offset,
            });
        }
    }
    
    const getPosition = (offset: number) => {
        const distance = Math.abs(offset);
        
        // O banner central (offset 0) tem scale 1
        if (offset === 0) return { z: 10, x: 0, scale: 1, opacity: 1 };
        
        // Banners laterais diminuem de tamanho
        const scale = 1 - 0.15 * distance;
        
        // Items to the left (negative x)
        if (offset < 0) return {
            z: 10 + offset, 
            x: TRANSLATION_FACTOR * offset, 
            scale: scale,
            opacity: 1 - 0.1 * distance 
        };
        
        // Items to the right (positive x)
        return {
            z: 10 - offset, 
            x: TRANSLATION_FACTOR * offset, 
            scale: scale,
            opacity: 1 - 0.1 * distance 
        };
    };

    const handleItemClick = (index: number) => {
        setCurrentIndex(index);
    };
    
    const goToPrev = () => {
        setCurrentIndex(prev => (prev - 1 + totalItems) % totalItems);
    };

    const goToNext = () => {
        setCurrentIndex(prev => (prev + 1) % totalItems);
    };
    
    const handleBannerAction = (link: string | null) => {
        if (link) {
            if (link.startsWith('/')) {
                navigate(link);
            } else {
                window.open(link, '_blank');
            }
        }
    };

    // Calcula a largura do banner central renderizado
    const centerBannerWidth = baseWidth; 

    return (
        <div className="w-full flex flex-col items-center justify-center bg-black">
            <main className="flex items-center justify-center w-full">
                {/* O containerRef agora tem o padding de 20px (p-5) e a borda */}
                <div ref={containerRef} className="w-full border border-white/20 rounded-3xl p-5">
                    {/* 3D Carousel Container */}
                    <div className="flex items-center justify-center">
                        
                        <div
                            className="relative flex items-center justify-center w-full" 
                            // A altura do contêiner é baseada na nova baseHeight
                            style={{ perspective: '2000px', height: `${baseHeight * 1.2}px` }} 
                        >
                            {/* Botão de navegação esquerda (Posicionado absolutamente) */}
                            <button 
                                onClick={goToPrev}
                                className="absolute left-1/2 top-1/2 transform -translate-y-1/2 -translate-x-1/2 w-10 h-10 sm:w-12 sm:h-12 bg-black/60 border border-yellow-500/30 rounded-full flex items-center justify-center text-yellow-500 hover:bg-yellow-500/20 transition-all duration-300 cursor-pointer z-30"
                                // Ajuste de posição: O botão deve ficar 20px à esquerda do banner central
                                style={{ marginLeft: `-${centerBannerWidth / 2 + 20}px` }} 
                                disabled={totalItems <= 1}
                            >
                                <ChevronLeft className="h-6 w-6" />
                            </button>
                            
                            {/* Botão de navegação direita (Posicionado absolutamente) */}
                            <button 
                                onClick={goToNext}
                                className="absolute right-1/2 top-1/2 transform -translate-y-1/2 translate-x-1/2 w-10 h-10 sm:w-12 sm:h-12 bg-black/60 border border-yellow-500/30 rounded-full flex items-center justify-center text-yellow-500 hover:bg-yellow-500/20 transition-all duration-300 cursor-pointer z-30"
                                // Ajuste de posição: O botão deve ficar 20px à direita do banner central
                                style={{ marginRight: `-${centerBannerWidth / 2 + 20}px` }} 
                                disabled={totalItems <= 1}
                            >
                                <ChevronRight className="h-6 w-6" />
                            </button>

                            {itemsToRender.map(({ item, realIndex, offset }) => {
                                const pos = getPosition(offset);
                                const distance = Math.abs(offset);
                                
                                // Define a cor da borda com base na distância
                                let borderColorClass = 'border-none';
                                if (offset !== 0 && distance <= BORDER_COLORS.length) {
                                    borderColorClass = `border-y-0 border-l-2 border-r-2 ${BORDER_COLORS[distance - 1]}`;
                                }

                                return (
                                    <div
                                        key={item.id}
                                        className={cn(
                                            "absolute transition-all duration-700 ease-out rounded-2xl",
                                            pos.opacity < 0.4 ? "pointer-events-none" : "cursor-pointer"
                                        )}
                                        style={{
                                            // Usando a largura e altura base, escaladas pela posição
                                            width: baseWidth * pos.scale, 
                                            height: baseHeight * pos.scale, 
                                            // Rotação ajustada para 16deg
                                            top: '50%',
                                            transform: `translateY(-50%) translateX(${pos.x}px) rotateY(${pos.x > 0 ? -16 : pos.x < 0 ? 16 : 0}deg)`,
                                            zIndex: Math.round(pos.z),
                                            opacity: pos.opacity
                                        }}
                                        onClick={() => {
                                            if (realIndex === currentIndex) {
                                                handleBannerAction(item.link);
                                            } else {
                                                handleItemClick(realIndex);
                                            }
                                        }}
                                    >
                                        <div className={cn(
                                            "relative w-full h-full bg-white rounded-2xl shadow-2xl overflow-hidden group hover:shadow-yellow-500/20 transition-shadow duration-300",
                                            borderColorClass // Aplica a borda lateral colorida
                                        )}>
                                            <img
                                                src={item.image}
                                                alt={item.title || 'Banner em destaque'}
                                                className="w-full h-full object-cover object-top"
                                                loading="eager"
                                                decoding="async"
                                                onError={(e) => {
                                                    (e.currentTarget as HTMLImageElement).style.display = 'none';
                                                }}
                                            />
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                        
                    </div>
                    
                    {/* Navigation Dots */}
                    <div className="flex justify-center space-x-3 mt-1">
                        {allItems.map((_, index) => (
                            <button
                                key={index}
                                onClick={() => setCurrentIndex(index)}
                                className={cn(
                                    "w-3 h-3 rounded-full transition-all duration-300",
                                    index === currentIndex ? "bg-yellow-500 w-8" : "bg-gray-700 hover:bg-yellow-500/50"
                                )}
                                aria-label={`Go to slide ${index + 1}`}
                                disabled={totalItems <= 1}
                            />
                        ))}
                    </div>
                </div>
            </main>
        </div>
    );
};

export default Carousel3D;