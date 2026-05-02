import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom'; // Importando useSearchParams
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import AuthStatusMenu from '@/components/AuthStatusMenu';
import { Input } from '@/components/ui/input';
import { useMyTickets, TicketData } from '@/hooks/use-my-tickets';
import { useMyPurchases } from '@/hooks/use-my-purchases';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, Calendar, MapPin, QrCode, History } from 'lucide-react';
import { showSuccess, showError } from '@/utils/toast'; // Importando showSuccess/showError
import { formatEventDateForDisplay } from '@/utils/format-event-date';
import { useQueryClient } from '@tanstack/react-query'; // Importando useQueryClient
import QrCodeModal from '@/components/QrCodeModal';

interface TicketCardProps {
    ticket: TicketData;
}

const TicketCard: React.FC<TicketCardProps> = ({ ticket }) => {
    const navigate = useNavigate();
    const [qrOpen, setQrOpen] = useState(false);
    
    const statusClasses = {
        active: 'bg-green-500/20 text-green-400 border-green-500/30',
        used: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
        lost: 'bg-red-500/20 text-red-400 border-red-500/30',
        cancelled: 'bg-red-500/20 text-red-400 border-red-500/30',
        pending: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30', // NOVO: Status pendente
    };

    const statusText = {
        active: 'Ativo',
        used: 'Utilizado',
        lost: 'Perdido',
        cancelled: 'Cancelado',
        pending: 'Pendente', // NOVO: Texto para status pendente
    };
    
    const eventDetails = ticket.wristbands?.events;
    const ticketType = ticket.wristbands?.access_type || 'Tipo Desconhecido';
    const eventName = eventDetails?.title || 'Evento Desconhecido';
    const eventLocation = eventDetails?.location || 'Local Desconhecido';
    const eventDate = eventDetails?.date
        ? formatEventDateForDisplay(eventDetails.date) || 'Data Desconhecida'
        : 'Data Desconhecida';
    const unitPrice = ticket.wristbands?.price || 0;
    
    // Nota: Como cada registro de analytics representa 1 ingresso, a quantidade é 1.
    // Para agrupar por tipo, precisaríamos de uma lógica mais complexa no frontend ou no backend.
    // Por enquanto, exibimos 1x e o preço unitário.
    const totalValue = unitPrice; 

    const isActive = ticket.status === 'active' || ticket.status === 'pending'; // Considera 'pending' como ativo para visualização

    return (
        <Card className="bg-black/80 backdrop-blur-sm border border-yellow-500/30 rounded-2xl shadow-2xl shadow-yellow-500/10 p-4 sm:p-6 flex flex-col md:flex-row justify-between items-start md:items-center space-y-4 md:space-y-0 hover:border-yellow-500/60 transition-all duration-300">
            <div className="flex-1 space-y-2">
                <div className="flex flex-wrap items-center space-x-3">
                    <CardTitle 
                        className="text-white text-lg sm:text-xl font-semibold hover:text-yellow-500 transition-colors cursor-pointer" 
                        onClick={() => eventDetails?.id && navigate(`/events/${eventDetails.id}`)}
                    >
                        {eventName}
                    </CardTitle>
                    <span className={`px-3 py-1 rounded-full text-xs font-semibold border ${statusClasses[ticket.status]}`}>
                        {statusText[ticket.status]}
                    </span>
                </div>
                <p className="text-gray-400 text-sm">{ticketType} (1x)</p>
                <div className="flex flex-wrap items-center space-x-4 sm:space-x-6 text-xs sm:text-sm text-gray-300 pt-2">
                    <div className="flex items-center">
                        <Calendar className="text-yellow-500 mr-2 h-4 w-4" />
                        <span>{eventDate}</span>
                    </div>
                    <div className="flex items-center">
                        <MapPin className="text-yellow-500 mr-2 h-4 w-4" />
                        <span>{eventLocation}</span>
                    </div>
                </div>
            </div>
            
            <div className="w-full md:w-auto flex flex-row md:flex-col items-center md:items-end justify-between pt-4 md:pt-0 border-t border-yellow-500/20 md:border-t-0">
                <div className="text-left md:text-right">
                    <span className="text-xs sm:text-sm text-gray-400">Valor Unitário</span>
                    <div className="text-xl sm:text-2xl font-bold text-yellow-500">R$ {totalValue.toFixed(2).replace('.', ',')}</div>
                </div>
                <Button 
                    className="bg-yellow-500 text-black hover:bg-yellow-600 transition-all duration-300 cursor-pointer px-4 sm:px-6 text-sm sm:text-base"
                    onClick={() => setQrOpen(true)}
                    disabled={!isActive}
                >
                    <QrCode className="mr-2 h-4 w-4" />
                    {isActive ? 'Ver QR Code' : 'Ingresso Inativo'}
                </Button>
            </div>
            <QrCodeModal
                isOpen={qrOpen}
                onClose={() => setQrOpen(false)}
                eventName={eventName}
                eventDate={eventDetails?.date || ''}
                wristbandCode={(ticket.code_wristbands && ticket.code_wristbands.trim()) || ticket.id}
                scanValue={ticket.id}
            />
        </Card>
    );
};

const MyTickets: React.FC = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const queryClient = useQueryClient(); // Inicializando useQueryClient
    const [searchParams, setSearchParams] = useSearchParams(); // Usando useSearchParams
    const [userId, setUserId] = useState<string | undefined>(undefined);
    const [loadingSession, setLoadingSession] = useState(true);
    const [checkingPurchaseId, setCheckingPurchaseId] = useState<string | null>(null);
    const [purchaseStatusFilter, setPurchaseStatusFilter] = useState<'all' | 'pending' | 'paid' | 'failed'>('all');
    const [purchasePage, setPurchasePage] = useState(1);

    useEffect(() => {
        supabase.auth.getUser().then(({ data: { user } }) => {
            setUserId(user?.id);
            setLoadingSession(false);
        });
    }, []);
    
    const { tickets, isLoading, isError } = useMyTickets(userId);
    const { purchases } = useMyPurchases(userId);
    
    const reconcilePurchaseOnReturn = async (transactionId: string) => {
        const { data, error } = await supabase.functions.invoke('check-payment-status', {
            body: { transactionId },
        });
        if (error) throw error;
        return data;
    };

    // NOVO: Lógica para processar os parâmetros de retorno do Mercado Pago
    useEffect(() => {
        const status = searchParams.get('status');
        const transactionId = searchParams.get('transaction_id');

        if (!(status && transactionId) || !userId) return;

        let cancelled = false;
        const run = async () => {
            try {
                const data = await reconcilePurchaseOnReturn(transactionId);
                if (cancelled) return;

                const receivableStatus = data?.receivableStatus;
                const paymentStatus = data?.paymentStatus;
                const detail = data?.paymentStatusDetail ? ` (${data.paymentStatusDetail})` : '';

                if (status === 'failure' || receivableStatus === 'failed') {
                    showError(`Falha na compra #${transactionId.substring(0, 8)}... ${paymentStatus ? `Status MP: ${paymentStatus}${detail}` : ''}`.trim());
                } else if (receivableStatus === 'paid') {
                    showSuccess(`Compra #${transactionId.substring(0, 8)}... concluída e conciliada com sucesso!`);
                } else if (paymentStatus === 'approved' || paymentStatus === 'authorized') {
                    showError(`Compra #${transactionId.substring(0, 8)}... aprovada no MP, mas ainda em processamento interno. Tente novamente em instantes.`);
                } else {
                    showError(`Compra #${transactionId.substring(0, 8)}... está pendente no MP${detail}.`);
                }
            } catch (err: any) {
                if (cancelled) return;
                console.error('Erro ao conciliar retorno do checkout:', err);
                showError('Não foi possível validar o pagamento no retorno. Atualize a página em instantes.');
            } finally {
                if (!cancelled) {
                    queryClient.invalidateQueries({ queryKey: ['myTickets', userId] });
                    queryClient.invalidateQueries({ queryKey: ['myPurchases', userId] });
                    searchParams.delete('status');
                    searchParams.delete('transaction_id');
                    setSearchParams(searchParams, { replace: true });
                }
            }
        };

        run();
        return () => {
            cancelled = true;
        };
    }, [searchParams, setSearchParams, queryClient, userId]); // Dependências atualizadas

    if (loadingSession || isLoading) {
        return (
            <div className="min-h-screen bg-black text-white flex items-center justify-center pt-20">
                <Loader2 className="h-10 w-10 animate-spin text-yellow-500" />
                <p className="text-gray-400 ml-4">Carregando seus ingressos...</p>
            </div>
        );
    }
    
    if (!userId) {
        // Redirecionamento se a sessão expirar ou não estiver logado
        navigate('/login', { state: { from: `${location.pathname}${location.search}` } });
        return null;
    }

    if (isError) {
        return (
            <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center pt-20 px-4">
                <i className="fas fa-exclamation-triangle text-4xl text-red-500 mb-4"></i>
                <p className="text-xl text-gray-400 mb-6">Erro ao carregar seus ingressos.</p>
                <Button onClick={() => window.location.reload()} className="bg-yellow-500 text-black hover:bg-yellow-600">
                    Tentar Novamente
                </Button>
            </div>
        );
    }

    const activeTickets = tickets.filter(t => t.status === 'active' || t.status === 'pending'); // Inclui 'pending' nos ativos
    const pastTickets = tickets.filter(t => t.status !== 'active' && t.status !== 'pending'); // Exclui 'pending' dos passados
    const purchasesWithUiStatus = purchases.map((p) => {
        const resolvedStatus =
            p.status === 'paid' || p.payment_status === 'approved' || p.payment_status === 'authorized'
                ? 'paid'
                : p.status === 'failed' || p.payment_status === 'rejected' || p.payment_status === 'cancelled'
                ? 'failed'
                : 'pending';
        return { ...p, resolvedStatus };
    });
    const filteredPurchases = purchasesWithUiStatus.filter((p) => purchaseStatusFilter === 'all' || p.resolvedStatus === purchaseStatusFilter);
    const purchasePageSize = 10;
    const totalPurchasePages = Math.max(1, Math.ceil(filteredPurchases.length / purchasePageSize));
    const safePurchasePage = Math.min(purchasePage, totalPurchasePages);
    const recentPurchases = filteredPurchases.slice((safePurchasePage - 1) * purchasePageSize, safePurchasePage * purchasePageSize);

    const getPurchaseStatusText = (status: string, paymentStatus: string | null) => {
        if (paymentStatus === 'approved' && status !== 'paid') return 'Pago (aguardando emissão)';
        if (status === 'paid' || paymentStatus === 'approved' || paymentStatus === 'authorized') return 'Pago';
        if (status === 'failed' || paymentStatus === 'rejected' || paymentStatus === 'cancelled') return 'Falhou';
        if (paymentStatus === 'in_process') return 'Em processamento';
        return 'Pendente';
    };

    const getPurchaseStatusClass = (status: string, paymentStatus: string | null) => {
        if (status === 'paid' || paymentStatus === 'approved' || paymentStatus === 'authorized') {
            return 'bg-green-500/20 text-green-400 border-green-500/30';
        }
        if (status === 'failed' || paymentStatus === 'rejected' || paymentStatus === 'cancelled') {
            return 'bg-red-500/20 text-red-400 border-red-500/30';
        }
        return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
    };

    const handleCheckPurchaseStatus = async (transactionId: string) => {
        setCheckingPurchaseId(transactionId);
        try {
            const { data, error } = await supabase.functions.invoke('check-payment-status', {
                body: { transactionId },
            });

            if (error) {
                throw error;
            }

            const paymentStatus = data?.paymentStatus || 'desconhecido';
            const detail = data?.paymentStatusDetail ? ` (${data.paymentStatusDetail})` : '';
            if (data?.requiresAttention) {
                showError(data?.processingResult || 'Pagamento aprovado no MP, mas integração local ainda não concluiu.');
            } else {
                showSuccess(`Status atualizado: ${paymentStatus}${detail}`);
            }
            queryClient.invalidateQueries({ queryKey: ['myPurchases', userId] });
            queryClient.invalidateQueries({ queryKey: ['myTickets', userId] });
            setPurchasePage(1);
        } catch (err: any) {
            console.error('Erro ao verificar status de pagamento:', err);
            showError(err?.message || 'Falha ao verificar status no Mercado Pago.');
        } finally {
            setCheckingPurchaseId(null);
        }
    };

    return (
        <div className="min-h-screen bg-black text-white overflow-x-hidden">
             <header className="fixed top-0 left-0 right-0 z-[100] bg-black/80 backdrop-blur-md border-b border-yellow-500/20">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
                    <div className="flex items-center space-x-4 sm:space-x-8">
                        <div className="text-xl sm:text-2xl font-serif text-yellow-500 font-bold cursor-pointer" onClick={() => navigate('/')}>
                            EventoFest
                        </div>
                        <nav className="hidden md:flex items-center space-x-8">
                            <button onClick={() => navigate('/')} className="text-white hover:text-yellow-500 transition-colors duration-300 cursor-pointer">Home</button>
                            <a href="/#eventos" className="text-white hover:text-yellow-500 transition-colors duration-300 cursor-pointer">Eventos</a>
                            <a href="/#categorias" className="text-white hover:text-yellow-500 transition-colors duration-300 cursor-pointer">Categorias</a>
                        </nav>
                    </div>
                    <div className="flex items-center space-x-4">
                        <div className="relative hidden lg:block">
                            <Input 
                                type="search" 
                                placeholder="Buscar eventos..." 
                                className="bg-black/60 border-yellow-500/30 text-white placeholder-gray-500 focus:border-yellow-500 w-64 pl-4 pr-10 py-2 rounded-xl"
                            />
                            <i className="fas fa-search absolute right-4 top-1/2 transform -translate-y-1/2 text-yellow-500/60"></i>
                        </div>
                        <AuthStatusMenu />
                    </div>
                </div>
            </header>
            <main className="pt-24 pb-12 px-4 sm:px-6 max-w-7xl mx-auto"> {/* Ajustado o padding-top */}
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-8">
                    <h1 className="text-3xl sm:text-4xl font-serif text-yellow-500 mb-4 sm:mb-0">Meus Ingressos</h1>
                    <Button 
                        onClick={() => navigate('/profile')}
                        variant="outline"
                        className="bg-black/60 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 text-sm sm:text-base"
                    >
                        <i className="fas fa-user-circle mr-2"></i>
                        Voltar ao Perfil
                    </Button>
                </div>

                <div className="space-y-10 sm:space-y-12">
                    <div>
                        <h2 className="text-2xl sm:text-3xl font-serif text-white mb-6 border-b border-yellow-500/30 pb-3 flex items-center">
                            <i className="fas fa-receipt mr-3 text-yellow-500"></i>
                            Minhas Compras ({filteredPurchases.length})
                        </h2>
                        <div className="flex flex-wrap items-center gap-2 mb-4">
                            <Button variant={purchaseStatusFilter === 'all' ? 'default' : 'outline'} size="sm" onClick={() => { setPurchaseStatusFilter('all'); setPurchasePage(1); }} className={purchaseStatusFilter === 'all' ? 'bg-yellow-500 text-black hover:bg-yellow-600' : 'bg-black/60 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10'}>Todos</Button>
                            <Button variant={purchaseStatusFilter === 'pending' ? 'default' : 'outline'} size="sm" onClick={() => { setPurchaseStatusFilter('pending'); setPurchasePage(1); }} className={purchaseStatusFilter === 'pending' ? 'bg-yellow-500 text-black hover:bg-yellow-600' : 'bg-black/60 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10'}>Pendentes</Button>
                            <Button variant={purchaseStatusFilter === 'paid' ? 'default' : 'outline'} size="sm" onClick={() => { setPurchaseStatusFilter('paid'); setPurchasePage(1); }} className={purchaseStatusFilter === 'paid' ? 'bg-yellow-500 text-black hover:bg-yellow-600' : 'bg-black/60 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10'}>Pagas</Button>
                            <Button variant={purchaseStatusFilter === 'failed' ? 'default' : 'outline'} size="sm" onClick={() => { setPurchaseStatusFilter('failed'); setPurchasePage(1); }} className={purchaseStatusFilter === 'failed' ? 'bg-yellow-500 text-black hover:bg-yellow-600' : 'bg-black/60 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10'}>Falhas</Button>
                        </div>
                        {recentPurchases.length > 0 ? (
                            <div className="space-y-4">
                                {recentPurchases.map((purchase) => (
                                    <Card key={purchase.id} className="bg-black/80 border border-yellow-500/30 rounded-2xl p-4 sm:p-5">
                                        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                                            <div className="space-y-1">
                                                <div className="flex items-center gap-3 flex-wrap">
                                                    <p className="text-white font-semibold">
                                                        {purchase.events?.title || 'Evento'}
                                                    </p>
                                                    <span className={`px-2.5 py-1 rounded-full text-xs font-semibold border ${getPurchaseStatusClass(purchase.status, purchase.payment_status)}`}>
                                                        {getPurchaseStatusText(purchase.status, purchase.payment_status)}
                                                    </span>
                                                </div>
                                                <p className="text-sm text-gray-400">Compra #{purchase.id.slice(0, 8)}...</p>
                                                <p className="text-sm text-gray-400">
                                                    Data: {new Date(purchase.created_at).toLocaleString('pt-BR')}
                                                </p>
                                                {purchase.payment_status && (
                                                    <p className="text-xs text-gray-500">
                                                        MP: {purchase.payment_status}
                                                        {purchase.mp_status_detail ? ` (${purchase.mp_status_detail})` : ''}
                                                    </p>
                                                )}
                                            </div>
                                            <div className="text-left md:text-right space-y-2">
                                                <p className="text-sm text-gray-400">Valor</p>
                                                <p className="text-xl font-bold text-yellow-500">
                                                    R$ {(purchase.total_value || 0).toFixed(2).replace('.', ',')}
                                                </p>
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={() => handleCheckPurchaseStatus(purchase.id)}
                                                    disabled={checkingPurchaseId === purchase.id}
                                                    className="bg-black/60 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10"
                                                >
                                                    {checkingPurchaseId === purchase.id ? (
                                                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                                    ) : null}
                                                    Verificar no MP
                                                </Button>
                                            </div>
                                        </div>
                                    </Card>
                                ))}
                            </div>
                        ) : (
                            <p className="text-gray-400 p-4 text-base">Nenhuma compra encontrada.</p>
                        )}
                        {totalPurchasePages > 1 && (
                            <div className="flex items-center justify-end gap-2 mt-4">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setPurchasePage((p) => Math.max(1, p - 1))}
                                    disabled={safePurchasePage <= 1}
                                    className="bg-black/60 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10"
                                >
                                    Anterior
                                </Button>
                                <span className="text-sm text-gray-400">
                                    Página {safePurchasePage} de {totalPurchasePages}
                                </span>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setPurchasePage((p) => Math.min(totalPurchasePages, p + 1))}
                                    disabled={safePurchasePage >= totalPurchasePages}
                                    className="bg-black/60 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10"
                                >
                                    Próxima
                                </Button>
                            </div>
                        )}
                    </div>

                    {/* Ingressos Ativos */}
                    <div>
                        <h2 className="text-2xl sm:text-3xl font-serif text-white mb-6 border-b border-yellow-500/30 pb-3 flex items-center">
                            <i className="fas fa-ticket-alt mr-3 text-yellow-500"></i>
                            Ingressos Ativos ({activeTickets.length})
                        </h2>
                        {activeTickets.length > 0 ? (
                            <div className="space-y-6">
                                {activeTickets.map(ticket => (
                                    <TicketCard key={ticket.id} ticket={ticket} />
                                ))}
                            </div>
                        ) : (
                            <div className="text-center p-8 sm:p-12 bg-black/60 border border-yellow-500/30 rounded-2xl">
                                <i className="fas fa-calendar-plus text-5xl sm:text-6xl text-gray-600 mb-4"></i>
                                <p className="text-gray-400 text-base sm:text-lg">Você não possui ingressos ativos no momento.</p>
                                <Button 
                                    onClick={() => navigate('/')}
                                    className="mt-6 bg-yellow-500 text-black hover:bg-yellow-600"
                                >
                                    Explorar Eventos
                                </Button>
                            </div>
                        )}
                    </div>

                    {/* Histórico de Ingressos */}
                    <div>
                        <h2 className="text-2xl sm:text-3xl font-serif text-white mb-6 border-b border-yellow-500/30 pb-3 flex items-center">
                            <History className="mr-3 h-6 w-6 text-yellow-500" />
                            Histórico de Ingressos ({pastTickets.length})
                        </h2>
                        {pastTickets.length > 0 ? (
                            <div className="space-y-6">
                                {pastTickets.map(ticket => (
                                    <TicketCard key={ticket.id} ticket={ticket} />
                                ))}
                            </div>
                        ) : (
                            <p className="text-gray-400 p-4 text-base">Nenhum ingresso no histórico.</p>
                        )}
                    </div>
                </div>
            </main>
        </div>
    );
};

export default MyTickets;