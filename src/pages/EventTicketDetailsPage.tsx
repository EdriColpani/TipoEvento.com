import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, User, Mail, DollarSign, Calendar, CheckCircle, XCircle, Loader2, Search } from 'lucide-react';
import { useEventTicketAnalytics, EventTicketAnalyticsFilters, PaginatedEventTicketAnalytics, WristbandDetailsForAnalytics } from '@/hooks/use-event-ticket-analytics';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { showError } from '@/utils/toast';
import { Pagination, PaginationContent, PaginationItem, PaginationPrevious, PaginationLink, PaginationNext, PaginationEllipsis } from "@/components/ui/pagination";

const PAGE_SIZE = 12; // Número de ingressos por página

const EventTicketDetailsPage: React.FC = () => {
    const navigate = useNavigate();
    const { eventId, eventName } = useParams<{ eventId: string; eventName: string }>();
    const [currentPage, setCurrentPage] = useState(1);
    const [searchQuery, setSearchQuery] = useState('');

    const decodedEventName = eventName ? decodeURIComponent(eventName) : 'Detalhes do Evento';

    const filters = {
        eventId: eventId || '',
        page: currentPage,
        pageSize: PAGE_SIZE,
        searchQuery: searchQuery,
    };

    const { data: paginatedTickets, isLoading, isError } = useEventTicketAnalytics(filters);

    const tickets = paginatedTickets?.data || [];
    const totalCount = paginatedTickets?.count || 0;
    const totalPages = Math.ceil(totalCount / PAGE_SIZE);

    const soldTickets = tickets.filter(ticket => ticket.analytics_status === 'used') || [];
    const unsoldTickets = tickets.filter(ticket => ticket.analytics_status === 'active') || [];

    const formatDate = (dateString?: string) => {
        if (!dateString) return 'N/A';
        try {
            return format(new Date(dateString), 'dd/MM/yyyy HH:mm', { locale: ptBR });
        } catch (e) {
            console.error("Error formatting date:", e);
            return 'Data Inválida';
        }
    };

    const formatCurrency = (value: number) => {
        return new Intl.NumberFormat('pt-BR', {
            style: 'currency',
            currency: 'BRL',
        }).format(value);
    };

    if (isLoading) {
        return (
            <div className="min-h-screen bg-black text-white flex items-center justify-center">
                <Loader2 className="h-10 w-10 animate-spin text-yellow-500" />
                <p className="text-gray-400 ml-3">Carregando detalhes dos ingressos...</p>
            </div>
        );
    }

    if (isError) {
        showError("Erro ao carregar detalhes dos ingressos. Tente novamente.");
        return (
            <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center p-6">
                <XCircle className="h-16 w-16 text-red-500 mb-4" />
                <p className="text-red-500 text-lg mb-6">Não foi possível carregar os detalhes do evento.</p>
                <Button
                    onClick={() => navigate(-1)}
                    variant="outline"
                    className="bg-black/60 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10"
                >
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Voltar para Relatórios
                </Button>
            </div>
        );
    }

    if (!eventId) {
        showError("ID do evento não fornecido.");
        navigate('/manager/reports/financial');
        return null;
    }

    return (
        <div className="max-w-7xl mx-auto p-6 min-h-screen">
            <div className="flex items-center justify-between mb-8">
                <h1 className="text-2xl sm:text-3xl font-serif text-yellow-500 flex items-center">
                    Análise Detalhada de Ingressos: <span className="ml-2 text-white">{decodedEventName}</span>
                </h1>
                <Button
                    onClick={() => navigate(-1)}
                    variant="outline"
                    className="bg-black/60 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10"
                >
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Voltar para Relatório Financeiro
                </Button>
            </div>

            {/* Filtro de Busca */}
            <div className="mb-6">
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
                    <Input
                        type="text"
                        placeholder="Buscar por código, nome ou e-mail do comprador..."
                        value={searchQuery}
                        onChange={(e) => {
                            setSearchQuery(e.target.value);
                            setCurrentPage(1); // Resetar para a primeira página ao pesquisar
                        }}
                        className="w-full pl-10 pr-4 py-2 bg-black/60 border-yellow-500/30 text-white rounded-md focus:ring-yellow-500 focus:border-yellow-500"
                    />
                </div>
            </div>

            <div className="space-y-8">
                {/* Ingressos Vendidos */}
                <div>
                <h2 className="text-xl font-semibold text-green-400 mb-4 flex items-center">
                    <CheckCircle className="h-6 w-6 mr-2" />
                    Ingressos Vendidos ({totalCount > 0 ? `${soldTickets.length} de ${totalCount} (${totalPages} páginas)` : '0'})
                </h2>
                    {soldTickets.length === 0 ? (
                        <p className="text-gray-400 ml-8">Nenhum ingresso vendido ainda para este evento.</p>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                            {soldTickets.map(ticket => (
                                <Card key={ticket.id} className="bg-black border border-green-500/30 rounded-xl p-4 shadow-md shadow-green-500/10">
                                    <CardHeader className="p-0 mb-3">
                                        <CardTitle className="text-white text-lg flex items-center justify-between">
                                            <span className="flex items-center"><DollarSign className="h-5 w-5 mr-2 text-green-400" />{formatCurrency(ticket.wristband_price)}</span>
                                            <span className="text-sm text-green-400">Vendido</span>
                                        </CardTitle>
                                        <CardDescription className="text-gray-400 text-xs">Código: {ticket.wristband_code} | Tipo: {ticket.wristband_access_type}</CardDescription>
                                    </CardHeader>
                                    <Separator className="my-3 bg-green-500/30" />
                                    <CardContent className="p-0 text-sm space-y-2">
                                        <div className="flex items-center text-white">
                                            <User className="h-4 w-4 mr-2 text-yellow-500" />
                                            <span className="font-medium">{`${ticket.first_name || ''} ${ticket.last_name || ''}`.trim() || 'N/A'}</span>
                                        </div>
                                        <div className="flex items-center text-gray-400">
                                            <Mail className="h-4 w-4 mr-2 text-yellow-500" />
                                            <span>{ticket.client_email || 'N/A'}</span>
                                        </div>
                                        <div className="flex items-center text-gray-400">
                                            <Calendar className="h-4 w-4 mr-2 text-yellow-500" />
                                            <span>Data da Compra: {formatDate(ticket.event_data?.purchase_date)}</span>
                                        </div>
                                    </CardContent>
                                </Card>
                            ))}
                        </div>
                    )}
                </div>

                {totalPages > 1 && (
                    <Pagination className="mt-8">
                        <PaginationContent>
                            <PaginationItem>
                                <PaginationPrevious 
                                    href="#"
                                    onClick={(e) => {
                                        e.preventDefault();
                                        if (currentPage > 1) setCurrentPage(currentPage - 1);
                                    }}
                                    className={currentPage === 1 ? 'pointer-events-none opacity-50 text-gray-500' : 'text-yellow-500 hover:bg-yellow-500/10'}
                                />
                            </PaginationItem>
                            {[...Array(totalPages)].map((_, index) => {
                                const page = index + 1;
                                if (page === 1 || page === totalPages || (page >= currentPage - 1 && page <= currentPage + 1)) {
                                    return (
                                        <PaginationItem key={page}>
                                            <PaginationLink
                                                href="#"
                                                isActive={page === currentPage}
                                                onClick={(e) => {
                                                    e.preventDefault();
                                                    setCurrentPage(page);
                                                }}
                                                className={page === currentPage ? 'bg-yellow-500 text-black hover:bg-yellow-600' : 'text-yellow-500 hover:bg-yellow-500/10'}
                                            >
                                                {page}
                                            </PaginationLink>
                                        </PaginationItem>
                                    );
                                } else if ((page === currentPage - 2 && currentPage > 3) || (page === currentPage + 2 && currentPage < totalPages - 2)) {
                                    return (
                                        <PaginationItem key={page}>
                                            <PaginationEllipsis className="text-gray-400" />
                                        </PaginationItem>
                                    );
                                }
                                return null;
                            })}
                            <PaginationItem>
                                <PaginationNext 
                                    href="#"
                                    onClick={(e) => {
                                        e.preventDefault();
                                        if (currentPage < totalPages) setCurrentPage(currentPage + 1);
                                    }}
                                    className={currentPage === totalPages ? 'pointer-events-none opacity-50 text-gray-500' : 'text-yellow-500 hover:bg-yellow-500/10'}
                                />
                            </PaginationItem>
                        </PaginationContent>
                    </Pagination>
                )}

                <Separator className="my-6 bg-yellow-500/30" />

                {/* Ingressos Não Vendidos */}
                <div>
                    <h2 className="text-xl font-semibold text-red-400 mb-4 flex items-center">
                        <XCircle className="h-6 w-6 mr-2" />
                        Ingressos Não Vendidos ({unsoldTickets.length > 0 ? `${unsoldTickets.length}` : '0'})
                    </h2>
                    {unsoldTickets.length === 0 ? (
                        <p className="text-gray-400 ml-8">Todos os ingressos foram vendidos para este evento!</p>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                            {unsoldTickets.map(ticket => (
                                <Card key={ticket.id} className="bg-black border border-red-500/30 rounded-xl p-4 shadow-md shadow-red-500/10">
                                    <CardHeader className="p-0 mb-3">
                                        <CardTitle className="text-white text-lg flex items-center justify-between">
                                            <span className="flex items-center"><DollarSign className="h-5 w-5 mr-2 text-red-400" />{formatCurrency(ticket.wristband_price)}</span>
                                            <span className="text-sm text-red-400">Não Vendido</span>
                                        </CardTitle>
                                        <CardDescription className="text-gray-400 text-xs">Código: {ticket.wristband_code} | Tipo: {ticket.wristband_access_type}</CardDescription>
                                    </CardHeader>
                                    <Separator className="my-3 bg-red-500/30" />
                                    <CardContent className="p-0 text-sm space-y-2">
                                        <div className="flex items-center text-gray-400">
                                            <span>Criado em: {formatDate(ticket.created_at)}</span>
                                        </div>
                                    </CardContent>
                                </Card>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default EventTicketDetailsPage;

