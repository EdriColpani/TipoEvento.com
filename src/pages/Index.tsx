import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { categories } from '@/data/events';
import AuthStatusMenu from '@/components/AuthStatusMenu';
import { Input } from "@/components/ui/input";
import MobileMenu from '@/components/MobileMenu';
import { supabase } from '@/integrations/supabase/client';
import { trackAdvancedFilterUse } from '@/utils/metrics';
import { usePublicEvents, PublicEvent } from '@/hooks/use-public-events';
import { useDevice } from '@/hooks/use-device';
import { Loader2, AlertTriangle } from 'lucide-react';
import Carousel3D from '@/components/Carousel3D'; // Importando o novo carrossel
import { showSuccess, showError } from '@/utils/toast'; // Importando toast

const EVENTS_PER_PAGE = 12;

export interface AdvancedFiltersState {
    price: { gratuito: boolean; ate100: boolean; range100_300: boolean; acima300: boolean };
    time: { manha: boolean; tarde: boolean; noite: boolean };
    status: { vendasAbertas: boolean; ultimosIngressos: boolean };
}

const defaultFilters: AdvancedFiltersState = {
    price: { gratuito: false, ate100: false, range100_300: false, acima300: false },
    time: { manha: false, tarde: false, noite: false },
    status: { vendasAbertas: false, ultimosIngressos: false },
};

function parseTimeHour(timeStr: string): number {
    if (!timeStr) return 0;
    const part = String(timeStr).trim().split(':')[0];
    const h = parseInt(part, 10);
    return isNaN(h) ? 0 : h % 24;
}

function applyAdvancedFilters(events: PublicEvent[], filters: AdvancedFiltersState): PublicEvent[] {
    const { price, time, status } = filters;
    const anyPrice = price.gratuito || price.ate100 || price.range100_300 || price.acima300;
    const anyTime = time.manha || time.tarde || time.noite;
    const anyStatus = status.vendasAbertas || status.ultimosIngressos;

    return events.filter((event) => {
        if (anyPrice) {
            const min = event.min_price ?? 0;
            const isFree = !event.is_paid || min === 0;
            const matchGratuito = price.gratuito && isFree;
            const matchAte100 = price.ate100 && min > 0 && min <= 100;
            const match100_300 = price.range100_300 && min > 100 && min <= 300;
            const matchAcima300 = price.acima300 && min > 300;
            if (!matchGratuito && !matchAte100 && !match100_300 && !matchAcima300) return false;
        }
        if (anyTime) {
            const hour = parseTimeHour(event.time);
            const matchManha = time.manha && hour >= 6 && hour < 12;
            const matchTarde = time.tarde && hour >= 12 && hour < 18;
            const matchNoite = time.noite && (hour >= 18 || hour < 6);
            if (!matchManha && !matchTarde && !matchNoite) return false;
        }
        if (anyStatus) {
            const disponiveis = event.total_available_tickets ?? 0;
            const cap = event.capacity ?? 0;
            const vendasAbertas = disponiveis > 0;
            const ultimosIngressos = cap > 0 && disponiveis > 0 && disponiveis <= Math.max(1, Math.ceil(cap * 0.1));
            const matchVendas = status.vendasAbertas && vendasAbertas;
            const matchUltimos = status.ultimosIngressos && ultimosIngressos;
            if (!matchVendas && !matchUltimos) return false;
        }
        return true;
    });
}

const getMinPriceDisplay = (price: number | null, isPaid: boolean): string => {
    if (isPaid && (price === null || price === 0)) return 'R$ 0,00';
    if (!isPaid) return 'Gratuito';
    return `R$ ${(price ?? 0).toFixed(2).replace('.', ',')}`;
};

const Index: React.FC = () => {
    const navigate = useNavigate();
    const [userId, setUserId] = useState<string | undefined>(undefined);
    const { isMobile, isTablet } = useDevice();
    
    const { events: allEvents, isLoading: isLoadingEvents, isError: isErrorEvents } = usePublicEvents();

    const [searchTerm, setSearchTerm] = useState('');
    const [categoryFilter, setCategoryFilter] = useState('');
    const [cityFilter, setCityFilter] = useState('');
    const [dateFilter, setDateFilter] = useState('');
    const [filters, setFilters] = useState<AdvancedFiltersState>(defaultFilters);

    const filteredEvents = React.useMemo(() => {
        let list = allEvents;
        const term = searchTerm.trim().toLowerCase();
        if (term) {
            list = list.filter((e) =>
                e.title.toLowerCase().includes(term) ||
                (e.description || '').toLowerCase().includes(term) ||
                (e.location || '').toLowerCase().includes(term) ||
                (e.category || '').toLowerCase().includes(term),
            );
        }
        if (categoryFilter) {
            list = list.filter((e) => (e.category || '').toLowerCase() === categoryFilter.toLowerCase());
        }
        if (cityFilter) {
            list = list.filter((e) => (e.location || '').toLowerCase().includes(cityFilter.toLowerCase()));
        }
        if (dateFilter) {
            const now = new Date();
            now.setHours(0, 0, 0, 0);
            list = list.filter((e) => {
                const d = e.raw_date;
                if (!d) return false;
                const day = new Date(d);
                day.setHours(0, 0, 0, 0);
                if (dateFilter === 'hoje') return day.getTime() === now.getTime();
                if (dateFilter === 'semana') {
                    const end = new Date(now);
                    end.setDate(end.getDate() + 7);
                    return day >= now && day < end;
                }
                if (dateFilter === 'mes') {
                    return day.getMonth() === now.getMonth() && day.getFullYear() === now.getFullYear();
                }
                if (dateFilter === 'proximo-mes') {
                    const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
                    const endNext = new Date(now.getFullYear(), now.getMonth() + 2, 0);
                    return day >= next && day <= endNext;
                }
                return true;
            });
        }
        return applyAdvancedFilters(list, filters);
    }, [allEvents, searchTerm, categoryFilter, cityFilter, dateFilter, filters]);

    const [currentPage, setCurrentPage] = useState(1);
    const totalPages = Math.max(1, Math.ceil(filteredEvents.length / EVENTS_PER_PAGE));

    useEffect(() => {
        supabase.auth.getUser().then(({ data: { user } }) => {
            setUserId(user?.id);
        });
    }, []);

    const handleEventClick = (event: PublicEvent) => {
        if (event.is_paid) {
            navigate(`/events/${event.id}`);
        } else {
            navigate(`/events/${event.id}/inscricao`);
        }
    };
    
    const handleApplyFilters = () => {
        if (userId) {
            trackAdvancedFilterUse(userId);
        }
        setCurrentPage(1);
    };

    const togglePrice = (key: keyof AdvancedFiltersState['price']) => {
        setFilters((prev) => ({ ...prev, price: { ...prev.price, [key]: !prev.price[key] } }));
        setCurrentPage(1);
    };
    const toggleTime = (key: keyof AdvancedFiltersState['time']) => {
        setFilters((prev) => ({ ...prev, time: { ...prev.time, [key]: !prev.time[key] } }));
        setCurrentPage(1);
    };
    const toggleStatus = (key: keyof AdvancedFiltersState['status']) => {
        setFilters((prev) => ({ ...prev, status: { ...prev.status, [key]: !prev.status[key] } }));
        setCurrentPage(1);
    };
    
    const handlePageChange = (page: number) => {
        if (page >= 1 && page <= totalPages) {
            setCurrentPage(page);
            
            const eventsSection = document.getElementById('eventos');
            if (eventsSection) {
                const offset = 80; 
                const topPosition = eventsSection.getBoundingClientRect().top + window.scrollY - offset;
                
                window.scrollTo({
                    top: topPosition,
                    behavior: 'smooth'
                });
            }
        }
    };

    // Removido o handleTestLog e o botão de teste de log

    const startIndex = (currentPage - 1) * EVENTS_PER_PAGE;
    const endIndex = startIndex + EVENTS_PER_PAGE;
    const displayedEvents = filteredEvents.slice(startIndex, endIndex);
    
    const getPageNumbers = () => {
        const maxPagesToShow = 5;
        const pages = [];
        let startPage = Math.max(1, currentPage - Math.floor(maxPagesToShow / 2));
        let endPage = Math.min(totalPages, startPage + maxPagesToShow - 1);

        if (endPage - startPage + 1 < maxPagesToShow) {
            startPage = Math.max(1, endPage - maxPagesToShow + 1);
        }

        for (let i = startPage; i <= endPage; i++) {
            pages.push(i);
        }
        return pages;
    };

    const efThemeStyles = `
        .landing-ef-theme .text-yellow-500 { color: #22d3ee !important; }
        .landing-ef-theme .bg-yellow-500 { background-color: #22d3ee !important; }
        .landing-ef-theme .from-yellow-500 { --tw-gradient-from: #22d3ee var(--tw-gradient-from-position) !important; --tw-gradient-to: rgb(34 211 238 / 0) var(--tw-gradient-to-position) !important; --tw-gradient-stops: var(--tw-gradient-from), var(--tw-gradient-to) !important; }
        .landing-ef-theme .to-yellow-600 { --tw-gradient-to: #3b82f6 var(--tw-gradient-to-position) !important; }
        .landing-ef-theme .hover\\:bg-yellow-600:hover { background-color: #3b82f6 !important; }
        .landing-ef-theme .hover\\:from-yellow-600:hover { --tw-gradient-from: #0ea5e9 var(--tw-gradient-from-position) !important; --tw-gradient-to: rgb(14 165 233 / 0) var(--tw-gradient-to-position) !important; --tw-gradient-stops: var(--tw-gradient-from), var(--tw-gradient-to) !important; }
        .landing-ef-theme .hover\\:to-yellow-700:hover { --tw-gradient-to: #2563eb var(--tw-gradient-to-position) !important; }
        .landing-ef-theme .border-yellow-500\\/20 { border-color: rgb(34 211 238 / 0.2) !important; }
        .landing-ef-theme .border-yellow-500\\/30 { border-color: rgb(34 211 238 / 0.3) !important; }
        .landing-ef-theme .hover\\:border-yellow-500\\/60:hover { border-color: rgb(59 130 246 / 0.6) !important; }
        .landing-ef-theme .focus\\:border-yellow-500:focus { border-color: #22d3ee !important; }
        .landing-ef-theme .focus\\:ring-yellow-500\\/20:focus { --tw-ring-color: rgb(34 211 238 / 0.2) !important; }
        .landing-ef-theme .hover\\:bg-yellow-500\\/20:hover { background-color: rgb(34 211 238 / 0.2) !important; }
        .landing-ef-theme .hover\\:shadow-yellow-500\\/20:hover { --tw-shadow-color: rgb(59 130 246 / 0.2) !important; --tw-shadow: var(--tw-shadow-colored) !important; }
        .landing-ef-theme .hover\\:text-yellow-500:hover { color: #22d3ee !important; }
        .landing-ef-theme #carousel .border-white\\/20 { border-color: transparent !important; }
    `;

    return (
        <div className="landing-ef-theme">
            <style>{efThemeStyles}</style>
            {/* NOVO: Carrossel 3D */}
            <section id="carousel" className="pt-0 bg-black">
                <Carousel3D />
            </section>
            
            <section id="eventos" className={`bg-black ${isMobile ? 'py-8 px-3' : isTablet ? 'py-12 px-4' : 'py-12 sm:py-20 px-4 sm:px-6'}`}>
                <div className="max-w-7xl mx-auto">
                    <div className={`text-center ${isMobile ? 'mb-6' : 'mb-10 sm:mb-16'}`}>
                        <h2 className={`font-serif text-yellow-500 mb-4 ${isMobile ? 'text-2xl' : 'text-3xl sm:text-5xl'}`}>Lista de Eventos</h2>
                        <div className="w-16 sm:w-24 h-px bg-yellow-500 mx-auto"></div>
                    </div>
                    
                    <div className="mb-12">
                        <div className="flex flex-col lg:flex-row gap-6 mb-8">
                            <div className="flex-1">
                                <div className="relative">
                                    <input
                                        type="text"
                                        placeholder="Buscar eventos..."
                                        value={searchTerm}
                                        onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
                                        className="w-full bg-black/60 border border-yellow-500/30 rounded-xl px-4 sm:px-6 py-3 sm:py-4 text-white placeholder-gray-400 text-base sm:text-lg focus:border-yellow-500 focus:outline-none focus:ring-2 focus:ring-yellow-500/20 transition-all duration-300"
                                    />
                                    <i className="fas fa-search absolute right-4 sm:right-6 top-1/2 transform -translate-y-1/2 text-yellow-500 text-lg"></i>
                                </div>
                            </div>
                            <div className="flex flex-wrap gap-4">
                                <select
                                    value={categoryFilter}
                                    onChange={(e) => { setCategoryFilter(e.target.value); setCurrentPage(1); }}
                                    className="bg-black/60 border border-yellow-500/30 rounded-xl px-4 sm:px-6 py-3 sm:py-4 text-white focus:border-yellow-500 focus:outline-none cursor-pointer text-sm sm:text-base"
                                >
                                    <option value="">Todas as Categorias</option>
                                    <option value="musica">Música</option>
                                    <option value="negocios">Negócios</option>
                                    <option value="arte">Arte</option>
                                    <option value="gastronomia">Gastronomia</option>
                                    <option value="tecnologia">Tecnologia</option>
                                </select>
                                <select
                                    value={cityFilter}
                                    onChange={(e) => { setCityFilter(e.target.value); setCurrentPage(1); }}
                                    className="bg-black/60 border border-yellow-500/30 rounded-xl px-4 sm:px-6 py-3 sm:py-4 text-white focus:border-yellow-500 focus:outline-none cursor-pointer text-sm sm:text-base"
                                >
                                    <option value="">Todas as Cidades</option>
                                    <option value="São Paulo">São Paulo</option>
                                    <option value="Rio de Janeiro">Rio de Janeiro</option>
                                    <option value="Belo Horizonte">Belo Horizonte</option>
                                    <option value="Brasília">Brasília</option>
                                </select>
                                <select
                                    value={dateFilter}
                                    onChange={(e) => { setDateFilter(e.target.value); setCurrentPage(1); }}
                                    className="bg-black/60 border border-yellow-500/30 rounded-xl px-4 sm:px-6 py-3 sm:py-4 text-white focus:border-yellow-500 focus:outline-none cursor-pointer text-sm sm:text-base"
                                >
                                    <option value="">Todas as Datas</option>
                                    <option value="hoje">Hoje</option>
                                    <option value="semana">Esta Semana</option>
                                    <option value="mes">Este Mês</option>
                                    <option value="proximo-mes">Próximo Mês</option>
                                </select>
                            </div>
                        </div>
                        <div className="flex flex-col lg:flex-row gap-8">
                            <div className="lg:w-80">
                                <div className="bg-black/60 backdrop-blur-sm border border-yellow-500/30 rounded-2xl p-6 lg:sticky lg:top-24">
                                    <h3 className="text-xl font-semibold text-white mb-6 flex items-center">
                                        <i className="fas fa-filter text-yellow-500 mr-3"></i>
                                        Filtros Avançados
                                    </h3>
                                    <div className="mb-6">
                                        <h4 className="text-white font-medium mb-3">Faixa de Preço</h4>
                                        <div className="space-y-3">
                                            <label className="flex items-center cursor-pointer">
                                                <input type="checkbox" className="mr-3 accent-yellow-500" checked={filters.price.gratuito} onChange={() => togglePrice('gratuito')} />
                                                <span className="text-gray-300">Gratuito</span>
                                            </label>
                                            <label className="flex items-center cursor-pointer">
                                                <input type="checkbox" className="mr-3 accent-yellow-500" checked={filters.price.ate100} onChange={() => togglePrice('ate100')} />
                                                <span className="text-gray-300">Até R$ 100</span>
                                            </label>
                                            <label className="flex items-center cursor-pointer">
                                                <input type="checkbox" className="mr-3 accent-yellow-500" checked={filters.price.range100_300} onChange={() => togglePrice('range100_300')} />
                                                <span className="text-gray-300">R$ 100 - R$ 300</span>
                                            </label>
                                            <label className="flex items-center cursor-pointer">
                                                <input type="checkbox" className="mr-3 accent-yellow-500" checked={filters.price.acima300} onChange={() => togglePrice('acima300')} />
                                                <span className="text-gray-300">Acima de R$ 300</span>
                                            </label>
                                        </div>
                                    </div>
                                    <div className="mb-6">
                                        <h4 className="text-white font-medium mb-3">Horário</h4>
                                        <div className="space-y-3">
                                            <label className="flex items-center cursor-pointer">
                                                <input type="checkbox" className="mr-3 accent-yellow-500" checked={filters.time.manha} onChange={() => toggleTime('manha')} />
                                                <span className="text-gray-300">Manhã (06:00 - 12:00)</span>
                                            </label>
                                            <label className="flex items-center cursor-pointer">
                                                <input type="checkbox" className="mr-3 accent-yellow-500" checked={filters.time.tarde} onChange={() => toggleTime('tarde')} />
                                                <span className="text-gray-300">Tarde (12:00 - 18:00)</span>
                                            </label>
                                            <label className="flex items-center cursor-pointer">
                                                <input type="checkbox" className="mr-3 accent-yellow-500" checked={filters.time.noite} onChange={() => toggleTime('noite')} />
                                                <span className="text-gray-300">Noite (18:00 - 00:00)</span>
                                            </label>
                                        </div>
                                    </div>
                                    <div className="mb-6">
                                        <h4 className="text-white font-medium mb-3">Status</h4>
                                        <div className="space-y-3">
                                            <label className="flex items-center cursor-pointer">
                                                <input type="checkbox" className="mr-3 accent-yellow-500" checked={filters.status.vendasAbertas} onChange={() => toggleStatus('vendasAbertas')} />
                                                <span className="text-gray-300">Vendas Abertas</span>
                                            </label>
                                            <label className="flex items-center cursor-pointer">
                                                <input type="checkbox" className="mr-3 accent-yellow-500" checked={filters.status.ultimosIngressos} onChange={() => toggleStatus('ultimosIngressos')} />
                                                <span className="text-gray-300">Últimos Ingressos</span>
                                            </label>
                                        </div>
                                    </div>
                                    <Button 
                                        onClick={handleApplyFilters}
                                        className="w-full bg-yellow-500 text-black hover:bg-yellow-600 transition-all duration-300 cursor-pointer"
                                    >
                                        Aplicar Filtros
                                    </Button>
                                </div>
                            </div>
                            <div className="flex-1">
                                {isLoadingEvents ? (
                                    <div className="text-center py-20">
                                        <Loader2 className="h-10 w-10 animate-spin text-yellow-500 mx-auto mb-4" />
                                        <p className="text-gray-400">Carregando eventos...</p>
                                    </div>
                                ) : isErrorEvents || allEvents.length === 0 ? (
                                    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-8">
                                        <div className="col-span-full text-center py-10">
                                            <AlertTriangle className="h-10 w-10 text-red-500 mx-auto mb-4" />
                                            <p className="text-gray-400">Nenhum evento encontrado.</p>
                                        </div>
                                    </div>
                                ) : filteredEvents.length === 0 ? (
                                    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-8">
                                        <div className="col-span-full text-center py-10">
                                            <AlertTriangle className="h-10 w-10 text-yellow-500 mx-auto mb-4" />
                                            <p className="text-gray-400">Nenhum evento corresponde aos filtros selecionados.</p>
                                            <p className="text-gray-500 text-sm mt-2">Tente alterar busca, categoria, data ou os filtros avançados.</p>
                                        </div>
                                    </div>
                                ) : (
                                    <div className={`grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 ${isMobile ? 'gap-4' : 'gap-8'}`}>
                                        {displayedEvents.map((event) => (
                                            <Card
                                                key={event.id}
                                                className="bg-black/60 backdrop-blur-sm border border-yellow-500/30 rounded-2xl overflow-hidden hover:border-yellow-500/60 hover:shadow-2xl hover:shadow-yellow-500/20 transition-all duration-300 cursor-pointer hover:scale-[1.02] group"
                                                onClick={() => handleEventClick(event)}
                                            >
                                                <div className="relative overflow-hidden">
                                                    <img
                                                        src={event.image_url} // USANDO O NOVO CAMPO (exposure_card_image_url)
                                                        alt={event.title}
                                                        className="w-full h-[200px] object-cover object-top group-hover:scale-110 transition-transform duration-500"
                                                    />
                                                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent"></div>
                                                    <div className="absolute top-4 left-4">
                                                        <span className="bg-yellow-500 text-black px-3 py-1 rounded-full text-sm font-semibold">
                                                            {event.category}
                                                        </span>
                                                    </div>
                                                    <div className="absolute top-4 right-4">
                                                        <button className="w-10 h-10 bg-black/60 border border-yellow-500/30 rounded-full flex items-center justify-center text-yellow-500 hover:bg-yellow-500 hover:text-black transition-all duration-300">
                                                            <i className="fas fa-heart"></i>
                                                        </button>
                                                    </div>
                                                </div>
                                                <div className="p-6">
                                                    <h3 className="text-xl font-semibold text-white mb-3 line-clamp-2 group-hover:text-yellow-500 transition-colors duration-300">
                                                        {event.title}
                                                    </h3>
                                                    <p className="text-gray-400 text-sm mb-4 line-clamp-2">
                                                        {event.description}
                                                    </p>
                                                    <div className="space-y-2 mb-4">
                                                        <div className="flex items-center text-gray-300 text-sm">
                                                            <i className="fas fa-calendar-alt text-yellow-500 mr-3 w-4"></i>
                                                            {event.date}
                                                        </div>
                                                        <div className="flex items-center text-gray-300 text-sm">
                                                            <i className="fas fa-map-marker-alt text-yellow-500 mr-3 w-4"></i>
                                                            {event.location}
                                                        </div>
                                                        <div className="flex items-center text-gray-300 text-sm">
                                                            <i className="fas fa-clock text-yellow-500 mr-3 w-4"></i>
                                                            {event.time}
                                                        </div>
                                                    </div>
                                                    <div className="flex items-center justify-between pt-4 border-t border-yellow-500/20">
                                                        <div className="flex flex-col">
                                                            <span className="text-sm text-gray-400">
                                                                {event.is_paid ? 'A partir de' : 'Entrada'}
                                                            </span>
                                                            <span className="text-xl font-bold text-yellow-500 whitespace-nowrap">
                                                                {getMinPriceDisplay(event.min_price, event.is_paid)}
                                                            </span>
                                                        </div>
                                                        <Button
                                                            className="bg-yellow-500 text-black hover:bg-yellow-600 transition-all duration-300 cursor-pointer px-4 sm:px-6"
                                                        >
                                                            {event.is_paid ? 'Ver Detalhes' : 'Faça sua inscrição'}
                                                        </Button>
                                                    </div>
                                                </div>
                                            </Card>
                                        ))}
                                    </div>
                                )}
                                
                                {filteredEvents.length > EVENTS_PER_PAGE && (
                                    <div className="flex items-center justify-center mt-12 space-x-2">
                                        <button 
                                            onClick={() => handlePageChange(currentPage - 1)}
                                            disabled={currentPage === 1}
                                            className="w-10 h-10 sm:w-12 sm:h-12 bg-black/60 border border-yellow-500/30 rounded-xl flex items-center justify-center text-yellow-500 hover:bg-yellow-500/20 hover:border-yellow-500 transition-all duration-300 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            <i className="fas fa-chevron-left"></i>
                                        </button>
                                        
                                        {getPageNumbers().map((page) => (
                                            <button
                                                key={page}
                                                onClick={() => handlePageChange(page)}
                                                className={`w-10 h-10 sm:w-12 sm:h-12 rounded-xl flex items-center justify-center font-semibold transition-all duration-300 cursor-pointer text-sm sm:text-base ${page === currentPage
                                                        ? 'bg-yellow-500 text-black'
                                                        : 'bg-black/60 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/20 hover:border-yellow-500'
                                                    }`}
                                            >
                                                {page}
                                            </button>
                                        ))}
                                        
                                        <button 
                                            onClick={() => handlePageChange(currentPage + 1)}
                                            disabled={currentPage === totalPages}
                                            className="w-10 h-10 sm:w-12 sm:h-12 bg-black/60 border border-yellow-500/30 rounded-xl flex items-center justify-center text-yellow-500 hover:bg-yellow-500/20 hover:border-yellow-500 transition-all duration-300 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            <i className="fas fa-chevron-right"></i>
                                        </button>
                                    </div>
                                )}
                                <div className="text-center mt-8">
                                    <p className="text-gray-400 text-sm sm:text-base">
                                        Mostrando <span className="text-yellow-500 font-semibold">{filteredEvents.length === 0 ? 0 : startIndex + 1}-{Math.min(endIndex, filteredEvents.length)}</span> de <span className="text-yellow-500 font-semibold">{filteredEvents.length}</span> eventos
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </section>
            <section id="categorias" className={`bg-black/50 ${isMobile ? 'py-8 px-3' : isTablet ? 'py-12 px-4' : 'py-12 sm:py-20 px-4 sm:px-6'}`}>
                <div className="max-w-7xl mx-auto">
                    <div className={`text-center ${isMobile ? 'mb-6' : 'mb-10 sm:mb-16'}`}>
                        <h2 className={`font-serif text-yellow-500 mb-4 ${isMobile ? 'text-2xl' : 'text-3xl sm:text-5xl'}`}>Categorias</h2>
                        <div className="w-16 sm:w-24 h-px bg-yellow-500 mx-auto"></div>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 sm:gap-6">
                        {categories.map((category) => (
                            <div
                                key={category.id}
                                className="bg-black/60 backdrop-blur-sm border border-yellow-500/30 rounded-2xl p-4 sm:p-6 text-center hover:border-yellow-500/60 hover:shadow-lg hover:shadow-yellow-500/20 transition-all duration-300 cursor-pointer hover:scale-105"
                            >
                                <div className="text-3xl sm:text-4xl text-yellow-500 mb-2 sm:mb-4">
                                    <i className={category.icon}></i>
                                </div>
                                <h3 className="text-white font-semibold text-sm sm:text-base mb-1">{category.name}</h3>
                                <span className="text-gray-400 text-xs sm:text-sm">{category.count} eventos</span>
                            </div>
                        ))}
                    </div>
                </div>
            </section>
            <section className={isMobile ? 'py-8 px-3' : 'py-12 sm:py-20 px-4 sm:px-6'}>
                <div className="max-w-4xl mx-auto text-center">
                    <h2 className={`font-serif text-yellow-500 mb-4 sm:mb-6 ${isMobile ? 'text-2xl' : 'text-3xl sm:text-5xl'}`}>Seja um Promotor</h2>
                    <p className="text-base sm:text-xl text-gray-300 mb-6 sm:mb-8 leading-relaxed">
                        Transforme suas ideias em eventos extraordinários. Junte-se à nossa plataforma premium
                        e crie experiências inesquecíveis para seu público.
                    </p>
                    <Button
                        className="bg-gradient-to-r from-yellow-500 to-yellow-600 text-black hover:from-yellow-600 hover:to-yellow-700 px-8 sm:px-12 py-3 sm:py-4 text-base sm:text-lg font-semibold transition-all duration-300 cursor-pointer hover:scale-105"
                    >
                        Começar Agora
                    </Button>
                </div>
            </section>
            <footer id="contato" className={`bg-black border-t border-yellow-500/20 ${isMobile ? 'py-8 px-3' : 'py-12 sm:py-16 px-4 sm:px-6'}`}>
                <div className="max-w-7xl mx-auto">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-10 sm:mb-12">
                        <div className="col-span-2 md:col-span-1">
                            <div className="text-xl sm:text-2xl font-serif text-yellow-500 font-bold mb-4">
                                EventFest
                            </div>
                            <p className="text-gray-400 text-sm leading-relaxed">
                                A plataforma que faz tudo acontecer.
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
                            © 2025 EventFest. Todos os direitos reservados.
                        </p>
                    </div>
                </div>
            </footer>
        </div>
    );
};

export default Index;