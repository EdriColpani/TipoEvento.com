import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { ArrowLeft, User, Mail, DollarSign, Calendar, CheckCircle, XCircle, Loader2, Search } from 'lucide-react';
import {
    useEventTicketAnalyticsFull,
    WristbandDetailsForAnalytics,
    isAnalyticsTicketSold,
} from '@/hooks/use-event-ticket-analytics';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { showError } from '@/utils/toast';
import {
    Pagination,
    PaginationContent,
    PaginationItem,
    PaginationPrevious,
    PaginationLink,
    PaginationNext,
    PaginationEllipsis,
} from "@/components/ui/pagination";

const PAGE_SIZE = 12;

const EventTicketDetailsPage: React.FC = () => {
    const navigate = useNavigate();
    const { eventId, eventName } = useParams<{ eventId: string; eventName: string }>();
    const [soldPage, setSoldPage] = useState(1);
    const [unsoldPage, setUnsoldPage] = useState(1);
    const [searchQuery, setSearchQuery] = useState('');

    const decodedEventName = eventName ? decodeURIComponent(eventName) : 'Detalhes do Evento';

    const { data: allTickets = [], isLoading, isError } = useEventTicketAnalyticsFull(eventId);

    useEffect(() => {
        if (isError) showError('Erro ao carregar detalhes dos ingressos. Tente novamente.');
    }, [isError]);

    const filteredTickets = useMemo(() => {
        const q = searchQuery.trim().toLowerCase();
        if (!q) return allTickets;
        return allTickets.filter((ticket) => {
            const code = (ticket.wristband_code || '').toLowerCase();
            const codeInd = (ticket.code_wristbands || '').toLowerCase();
            const fn = (ticket.first_name || '').toLowerCase();
            const ln = (ticket.last_name || '').toLowerCase();
            const em = (ticket.client_email || '').toLowerCase();
            return (
                code.includes(q) ||
                codeInd.includes(q) ||
                fn.includes(q) ||
                ln.includes(q) ||
                em.includes(q) ||
                `${fn} ${ln}`.trim().includes(q)
            );
        });
    }, [allTickets, searchQuery]);

    const soldTickets = useMemo(
        () => filteredTickets.filter((t) => isAnalyticsTicketSold(t)),
        [filteredTickets],
    );
    const unsoldTickets = useMemo(
        () => filteredTickets.filter((t) => !isAnalyticsTicketSold(t)),
        [filteredTickets],
    );

    useEffect(() => {
        setSoldPage(1);
        setUnsoldPage(1);
    }, [searchQuery, eventId]);

    const soldTotalPages = Math.max(1, Math.ceil(soldTickets.length / PAGE_SIZE));
    const unsoldTotalPages = Math.max(1, Math.ceil(unsoldTickets.length / PAGE_SIZE));
    const safeSoldPage = Math.min(soldPage, soldTotalPages);
    const safeUnsoldPage = Math.min(unsoldPage, unsoldTotalPages);

    const soldSlice = soldTickets.slice((safeSoldPage - 1) * PAGE_SIZE, safeSoldPage * PAGE_SIZE);
    const unsoldSlice = unsoldTickets.slice((safeUnsoldPage - 1) * PAGE_SIZE, safeUnsoldPage * PAGE_SIZE);

    const formatDate = (dateString?: string) => {
        if (!dateString) return 'N/A';
        try {
            return format(new Date(dateString), 'dd/MM/yyyy HH:mm', { locale: ptBR });
        } catch (e) {
            console.error('Error formatting date:', e);
            return 'Data Inválida';
        }
    };

    const formatCurrency = (value: number) => {
        return new Intl.NumberFormat('pt-BR', {
            style: 'currency',
            currency: 'BRL',
        }).format(value);
    };

    const renderPagination = (
        currentPage: number,
        totalPages: number,
        setPage: (n: number) => void,
        keyPrefix: string,
    ) => {
        if (totalPages <= 1) return null;
        return (
            <Pagination className="mt-6">
                <PaginationContent>
                    <PaginationItem>
                        <PaginationPrevious
                            href="#"
                            onClick={(e) => {
                                e.preventDefault();
                                if (currentPage > 1) setPage(currentPage - 1);
                            }}
                            className={
                                currentPage === 1
                                    ? 'pointer-events-none opacity-50 text-gray-500'
                                    : 'text-yellow-500 hover:bg-yellow-500/10'
                            }
                        />
                    </PaginationItem>
                    {[...Array(totalPages)].map((_, index) => {
                        const page = index + 1;
                        if (
                            page === 1 ||
                            page === totalPages ||
                            (page >= currentPage - 1 && page <= currentPage + 1)
                        ) {
                            return (
                                <PaginationItem key={`${keyPrefix}-${page}`}>
                                    <PaginationLink
                                        href="#"
                                        isActive={page === currentPage}
                                        onClick={(e) => {
                                            e.preventDefault();
                                            setPage(page);
                                        }}
                                        className={
                                            page === currentPage
                                                ? 'bg-yellow-500 text-black hover:bg-yellow-600'
                                                : 'text-yellow-500 hover:bg-yellow-500/10'
                                        }
                                    >
                                        {page}
                                    </PaginationLink>
                                </PaginationItem>
                            );
                        }
                        if (
                            (page === currentPage - 2 && currentPage > 3) ||
                            (page === currentPage + 2 && currentPage < totalPages - 2)
                        ) {
                            return (
                                <PaginationItem key={`${keyPrefix}-e-${page}`}>
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
                                if (currentPage < totalPages) setPage(currentPage + 1);
                            }}
                            className={
                                currentPage === totalPages
                                    ? 'pointer-events-none opacity-50 text-gray-500'
                                    : 'text-yellow-500 hover:bg-yellow-500/10'
                            }
                        />
                    </PaginationItem>
                </PaginationContent>
            </Pagination>
        );
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
        showError('ID do evento não fornecido.');
        navigate('/manager/reports/financial');
        return null;
    }

    const soldSubtitle =
        soldTickets.length > PAGE_SIZE
            ? `(${soldSlice.length} nesta página · ${soldTickets.length} no total)`
            : `(${soldTickets.length})`;

    const unsoldSubtitle =
        unsoldTickets.length > PAGE_SIZE
            ? `(${unsoldSlice.length} nesta página · ${unsoldTickets.length} no total)`
            : `(${unsoldTickets.length})`;

    return (
        <div className="max-w-7xl mx-auto p-6 min-h-screen">
            <div className="flex items-center justify-between mb-8">
                <h1 className="text-2xl sm:text-3xl font-serif text-yellow-500 flex items-center flex-wrap gap-2">
                    Análise Detalhada de Ingressos:{' '}
                    <span className="text-white">{decodedEventName}</span>
                </h1>
                <Button
                    onClick={() => navigate(-1)}
                    variant="outline"
                    className="bg-black/60 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 shrink-0"
                >
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Voltar para Relatório Financeiro
                </Button>
            </div>

            <div className="mb-6">
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
                    <Input
                        type="text"
                        placeholder="Buscar por código, nome ou e-mail do comprador..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full pl-10 pr-4 py-2 bg-black/60 border-yellow-500/30 text-white rounded-md focus:ring-yellow-500 focus:border-yellow-500"
                    />
                </div>
                <p className="text-xs text-gray-500 mt-2">
                    Vendido = ingresso com comprador vinculado ou já utilizado na entrada. Pagamentos aprovados ficam como status{' '}
                    <span className="text-gray-400">ativo</span> no cadastro da pulseira até a validação no portão.
                </p>
            </div>

            <div className="space-y-10">
                <div>
                    <h2 className="text-xl font-semibold text-green-400 mb-4 flex items-center flex-wrap gap-2">
                        <CheckCircle className="h-6 w-6 mr-2 shrink-0" />
                        Ingressos Vendidos {soldSubtitle}
                    </h2>
                    {soldTickets.length === 0 ? (
                        <p className="text-gray-400 ml-8">Nenhum ingresso vendido ou atribuído ainda para este evento.</p>
                    ) : (
                        <>
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                {soldSlice.map((ticket) => (
                                    <SoldTicketCard
                                        key={ticket.id}
                                        ticket={ticket}
                                        formatCurrency={formatCurrency}
                                        formatDate={formatDate}
                                    />
                                ))}
                            </div>
                            {renderPagination(safeSoldPage, soldTotalPages, setSoldPage, 'sold')}
                        </>
                    )}
                </div>

                <Separator className="my-6 bg-yellow-500/30" />

                <div>
                    <h2 className="text-xl font-semibold text-red-400 mb-4 flex items-center flex-wrap gap-2">
                        <XCircle className="h-6 w-6 mr-2 shrink-0" />
                        Ingressos Não Vendidos {unsoldSubtitle}
                    </h2>
                    {unsoldTickets.length === 0 ? (
                        <p className="text-gray-400 ml-8">Todos os ingressos foram vendidos ou atribuídos para este evento!</p>
                    ) : (
                        <>
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                {unsoldSlice.map((ticket) => (
                                    <Card
                                        key={ticket.id}
                                        className="bg-black border border-red-500/30 rounded-xl p-4 shadow-md shadow-red-500/10"
                                    >
                                        <CardHeader className="p-0 mb-3">
                                            <CardTitle className="text-white text-lg flex items-center justify-between">
                                                <span className="flex items-center">
                                                    <DollarSign className="h-5 w-5 mr-2 text-red-400" />
                                                    {formatCurrency(ticket.wristband_price)}
                                                </span>
                                                <span className="text-sm text-red-400">Não Vendido</span>
                                            </CardTitle>
                                            <CardDescription className="text-gray-400 text-xs">
                                                Código: {ticket.wristband_code}
                                                {ticket.code_wristbands ? ` (${ticket.code_wristbands})` : ''} | Tipo:{' '}
                                                {ticket.wristband_access_type}
                                            </CardDescription>
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
                            {renderPagination(safeUnsoldPage, unsoldTotalPages, setUnsoldPage, 'unsold')}
                        </>
                    )}
                </div>
            </div>
        </div>
    );
};

const SoldTicketCard: React.FC<{
    ticket: WristbandDetailsForAnalytics;
    formatCurrency: (v: number) => string;
    formatDate: (s?: string) => string;
}> = ({ ticket, formatCurrency, formatDate }) => {
    const pendingPayment = ticket.analytics_status === 'pending' && ticket.client_user_id;
    const badge = pendingPayment ? 'Reserva / pendência' : 'Vendido';
    const borderClass = pendingPayment ? 'border-yellow-500/40 shadow-yellow-500/10' : 'border-green-500/30 shadow-green-500/10';

    return (
        <Card className={`bg-black ${borderClass} rounded-xl p-4 shadow-md`}>
            <CardHeader className="p-0 mb-3">
                <CardTitle className="text-white text-lg flex items-center justify-between gap-2">
                    <span className="flex items-center">
                        <DollarSign className="h-5 w-5 mr-2 text-green-400 shrink-0" />
                        {formatCurrency(ticket.wristband_price)}
                    </span>
                    <span className={`text-sm shrink-0 ${pendingPayment ? 'text-yellow-400' : 'text-green-400'}`}>{badge}</span>
                </CardTitle>
                <CardDescription className="text-gray-400 text-xs">
                    Código: {ticket.wristband_code}
                    {ticket.code_wristbands ? ` (${ticket.code_wristbands})` : ''} | Tipo: {ticket.wristband_access_type}
                </CardDescription>
            </CardHeader>
            <Separator className={`my-3 ${pendingPayment ? 'bg-yellow-500/30' : 'bg-green-500/30'}`} />
            <CardContent className="p-0 text-sm space-y-2">
                <div className="flex items-center text-white">
                    <User className="h-4 w-4 mr-2 text-yellow-500 shrink-0" />
                    <span className="font-medium">{`${ticket.first_name || ''} ${ticket.last_name || ''}`.trim() || 'N/A'}</span>
                </div>
                <div className="flex items-center text-gray-400">
                    <Mail className="h-4 w-4 mr-2 text-yellow-500 shrink-0" />
                    <span>{ticket.client_email || 'N/A'}</span>
                </div>
                <div className="flex items-center text-gray-400">
                    <Calendar className="h-4 w-4 mr-2 text-yellow-500 shrink-0" />
                    <span>Data da Compra: {formatDate(ticket.event_data?.purchase_date)}</span>
                </div>
            </CardContent>
        </Card>
    );
};

export default EventTicketDetailsPage;
