import React, { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Search, Loader2, FileEdit, QrCode, Building2, Gift } from 'lucide-react';
import { useManagerEvents } from '@/hooks/use-manager-events';
import { usePageAuth } from '@/hooks/use-page-auth';
import DeleteEventDialog from '@/components/DeleteEventDialog';
import EventActiveToggle from '@/components/EventActiveToggle'; 
import { useProfile } from '@/hooks/use-profile';
import { useManagerCompany } from '@/hooks/use-manager-company';
import { useCompanyTicketInactivity } from '@/hooks/use-company-ticket-inactivity';
import { useEventTicketReadiness } from '@/hooks/use-event-ticket-readiness';
import TicketInactivityBanner from '@/components/TicketInactivityBanner';
import { companyAllowsTicketSales, DEFAULT_MIN_EVENT_TICKETS } from '@/utils/company-billing-rules';
import { useCompanyBilling } from '@/hooks/use-company-billing';
import { getInactiveEventGuidance } from '@/utils/inactive-event-guidance';
import { getManagerEventStatusPresentation } from '@/utils/manager-event-status';
import EventActivationBlockers from '@/components/EventActivationBlockers';
import { isEventLifecycleEnded } from '@/utils/event-lifecycle';
import { showError } from '@/utils/toast';

const ADMIN_MASTER_USER_TYPE_ID = 1;

const ManagerEventsList: React.FC = () => {
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const { userId, authPending } = usePageAuth();
    const [searchTerm, setSearchTerm] = useState('');

    const { profile, isLoading: isLoadingProfile } = useProfile(userId);
    const isAdminMaster = profile?.tipo_usuario_id === ADMIN_MASTER_USER_TYPE_ID;
    const { company } = useManagerCompany(userId);
    const { billing } = useCompanyBilling(company?.id);
    const showTicketRules = !isAdminMaster && companyAllowsTicketSales(billing?.billing_plan ?? null);
    const minEventTickets = billing?.min_event_tickets ?? DEFAULT_MIN_EVENT_TICKETS;
    const { data: inactivityStatus, isLoading: isLoadingInactivity, refetch: refetchInactivity } =
        useCompanyTicketInactivity(company?.id, !isAdminMaster);
    const { data: ticketReadiness = [] } = useEventTicketReadiness(company?.id, showTicketRules);
    const readinessByEventId = Object.fromEntries(ticketReadiness.map((r) => [r.event_id, r]));

    // O hook agora recebe isAdminMaster
    const { events, isLoading, isError, invalidateEvents: invalidateManagerEvents } = useManagerEvents(
        userId,
        isAdminMaster,
    );

    const invalidateEvents = useCallback(() => {
        invalidateManagerEvents();
        void queryClient.invalidateQueries({ queryKey: ['publicEvents'] });
        void refetchInactivity();
        void queryClient.invalidateQueries({ queryKey: ['companyBilling', company?.id] });
        void queryClient.invalidateQueries({ queryKey: ['eventTicketReadiness', company?.id] });
    }, [invalidateManagerEvents, queryClient, refetchInactivity, company?.id]);

    const filteredEvents = events.filter(event =>
        event.title.toLowerCase().includes(searchTerm.toLowerCase())
    );

    // Estado de carregamento inicial (antes de saber se o usuário está logado ou o perfil carregado)
    if (authPending || (userId && isLoadingProfile)) {
        return (
            <div className="max-w-7xl mx-auto text-center py-20">
                <Loader2 className="h-8 w-8 animate-spin text-yellow-500 mx-auto mb-4" />
                <p className="text-gray-400">Verificando autenticação e perfil...</p>
            </div>
        );
    }

    if (isError) {
        return <div className="text-red-400 text-center py-10">Erro ao carregar eventos. Tente recarregar a página.</div>;
    }

    const handleRowClick = (event: {
        id: string;
        date?: string | null;
        time?: string | null;
        lifecycle_ended_at?: string | null;
    }) => {
        const ended =
            Boolean(event.lifecycle_ended_at) || isEventLifecycleEnded(event.date, event.time);
        if (ended && !isAdminMaster) {
            showError('Evento encerrado: somente o administrador pode editar.');
            return;
        }
        navigate(`/manager/events/edit/${event.id}`);
    };

    return (
        <div className="max-w-7xl mx-auto">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-8">
                <h1 className="text-2xl sm:text-3xl font-serif text-yellow-500 mb-4 sm:mb-0">
                    {isAdminMaster ? `Todos os Eventos (${events.length})` : `Meus Eventos (${events.length})`}
                </h1>
                <div className="flex flex-wrap gap-3">
                    <Button
                        onClick={() => navigate('/manager/dashboard')}
                        variant="outline"
                        className="bg-black/60 border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 text-sm"
                    >
                        Voltar para o Dashboard
                    </Button>
                    <Button
                        onClick={() => navigate('/manager/wristbands')}
                        variant="outline"
                        className="bg-black/60 border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 hover:text-black py-3 text-base font-semibold transition-all duration-300 cursor-pointer"
                    >
                        <QrCode className="mr-2 h-5 w-5" />
                        Ingressos
                    </Button>
                    <Button
                        onClick={() => navigate('/manager/events/create')}
                        className="bg-yellow-500 text-black hover:bg-yellow-600 py-3 text-base font-semibold transition-all duration-300 cursor-pointer"
                    >
                        <Plus className="mr-2 h-5 w-5" />
                        Cadastrar Novo Evento
                    </Button>
                </div>
            </div>

            <TicketInactivityBanner status={inactivityStatus} isLoading={isLoadingInactivity} />

            <Card className="bg-black border border-yellow-500/30 rounded-2xl shadow-2xl shadow-yellow-500/10 p-6">
                <div className="relative mb-6">
                    <Input 
                        type="search" 
                        placeholder="Pesquisar por nome do evento..." 
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="bg-black/60 border-yellow-500/30 text-white placeholder-gray-500 focus:border-yellow-500 w-full pl-10 py-3 rounded-xl"
                    />
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-yellow-500/60" />
                </div>

                {isLoading ? (
                    <div className="text-center py-10">
                        <Loader2 className="h-8 w-8 animate-spin text-yellow-500 mx-auto mb-4" />
                        <p className="text-gray-400">Carregando eventos...</p>
                    </div>
                ) : filteredEvents.length === 0 ? (
                    <div className="text-center py-10">
                        <i className="fas fa-calendar-times text-5xl text-gray-600 mx-auto mb-4"></i>
                        <p className="text-gray-400 text-lg">Nenhum evento encontrado.</p>
                        <p className="text-gray-500 text-sm mt-2">Comece criando seu primeiro evento premium!</p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <Table className="w-full min-w-[640px]">
                            <TableHeader>
                                <TableRow className="border-b border-yellow-500/20 text-sm hover:bg-black/40">
                                    <TableHead className="text-left text-gray-400 font-semibold py-3 min-w-0">Nome do Evento</TableHead>
                                    <TableHead className="text-center text-gray-400 font-semibold py-3 w-32 shrink-0">Status</TableHead>
                                    <TableHead className="text-right text-gray-400 font-semibold py-3 w-[1%] whitespace-nowrap min-w-[280px]">
                                        Ações
                                    </TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {filteredEvents.map((event) => {
                                    const isDraft = event.is_draft;
                                    const readiness = readinessByEventId[event.id];
                                    const guidance = getInactiveEventGuidance(
                                        event,
                                        readiness,
                                        showTicketRules,
                                        minEventTickets,
                                    );
                                    const needsMoreTickets =
                                        readiness?.needs_more === true || guidance?.showMissingTicketsStatus === true;
                                    const autoDeactivated = Boolean(event.auto_deactivated_at);
                                    const lifecycleEnded =
                                        Boolean(event.lifecycle_ended_at) ||
                                        isEventLifecycleEnded(event.date, event.time);
                                    const editLocked = lifecycleEnded && !isAdminMaster;
                                    const { label: statusText, classes: statusClasses } =
                                        getManagerEventStatusPresentation({
                                            is_draft: isDraft,
                                            is_active: event.is_active,
                                            auto_deactivated_at: event.auto_deactivated_at,
                                            lifecycle_ended_at: event.lifecycle_ended_at,
                                            needs_more_tickets: needsMoreTickets,
                                            date: event.date,
                                            time: event.time,
                                        });

                                    return (
                                        <TableRow 
                                            key={event.id} 
                                            className="border-b border-yellow-500/10 hover:bg-black/40 transition-colors text-sm cursor-pointer"
                                            onClick={() => handleRowClick(event)}
                                        >
                                            <TableCell className="relative z-[1] py-4">
                                                <div className="text-white font-medium truncate max-w-[400px]">
                                                    {event.title}
                                                </div>
                                                {isAdminMaster && event.company_name && (
                                                    <div className="mt-1 flex items-center gap-1.5 text-xs text-cyan-300/90 truncate max-w-[400px]">
                                                        <Building2 className="h-3.5 w-3.5 shrink-0" />
                                                        <span>{event.company_name}</span>
                                                    </div>
                                                )}
                                                {event.inventory_mode !== 'counter' && guidance && (
                                                    <p className="relative z-[1] mt-1 text-xs text-amber-300/90 leading-relaxed">
                                                        <span className="font-semibold text-amber-200">
                                                            {guidance.title}:
                                                        </span>{' '}
                                                        {guidance.hint}
                                                        {guidance.actionPath && guidance.actionLabel && (
                                                            <>
                                                                {' '}
                                                                <button
                                                                    type="button"
                                                                    className="text-yellow-400 underline underline-offset-2 hover:text-yellow-300 font-medium"
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        navigate(
                                                                            guidance.actionPath!,
                                                                            guidance.actionPath === '/manager/wristbands/create'
                                                                                ? { state: { eventId: event.id } }
                                                                                : undefined,
                                                                        );
                                                                    }}
                                                                >
                                                                    {guidance.actionLabel}
                                                                </button>
                                                            </>
                                                        )}
                                                        {guidance.secondaryActionPath && guidance.secondaryActionLabel && (
                                                            <>
                                                                {' · '}
                                                                <button
                                                                    type="button"
                                                                    className="text-cyan-300 underline underline-offset-2 hover:text-cyan-200 font-medium"
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        navigate(guidance.secondaryActionPath!);
                                                                    }}
                                                                >
                                                                    {guidance.secondaryActionLabel}
                                                                </button>
                                                            </>
                                                        )}
                                                    </p>
                                                )}
                                                <div className="relative z-[1]">
                                                    <EventActivationBlockers
                                                        eventId={event.id}
                                                        inventoryMode={event.inventory_mode}
                                                        isActive={event.is_active}
                                                        isDraft={isDraft}
                                                    />
                                                </div>
                                                {autoDeactivated && (
                                                    <p className="mt-1 text-xs text-red-300/90">
                                                        Desativado automaticamente por falta de vendas após a data do
                                                        evento. Reative manualmente se necessário.
                                                    </p>
                                                )}
                                            </TableCell>
                                            <TableCell className="text-center py-4">
                                                <span className={`px-3 py-1 rounded-full text-xs font-semibold ${statusClasses}`}>
                                                    {statusText}
                                                </span>
                                            </TableCell>
                                            <TableCell
                                                className="py-4 align-middle w-[1%] min-w-[280px]"
                                                onClick={(e) => e.stopPropagation()}
                                            >
                                                <div className="ml-auto flex w-max max-w-none flex-nowrap items-center justify-end gap-2 whitespace-nowrap">
                                                    <Button
                                                        variant="outline"
                                                        size="sm"
                                                        disabled={editLocked}
                                                        className="shrink-0 bg-black/60 border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 hover:text-yellow-400 h-8 px-3 disabled:opacity-50"
                                                        onClick={() => handleRowClick(event)}
                                                    >
                                                        <FileEdit className="h-4 w-4 mr-2 shrink-0" />
                                                        {editLocked
                                                            ? 'Encerrado'
                                                            : isDraft
                                                              ? 'Continuar Edição'
                                                              : 'Gerenciar'}
                                                    </Button>
                                                    {event.inventory_mode === 'counter' && (
                                                        <Button
                                                            variant="outline"
                                                            size="sm"
                                                            className="shrink-0 bg-black/60 border-cyan-500/30 text-cyan-300 hover:bg-cyan-950/60 hover:text-white h-8 px-3"
                                                            onClick={() => navigate(`/manager/events/${event.id}/cortesias`)}
                                                        >
                                                            <Gift className="h-4 w-4 mr-2 shrink-0" />
                                                            Cortesias
                                                        </Button>
                                                    )}
                                                    <EventActiveToggle
                                                        eventId={event.id}
                                                        eventTitle={event.title}
                                                        isDraft={isDraft}
                                                        isActive={event.is_active}
                                                        eventDate={event.date}
                                                        eventTime={event.time}
                                                        lifecycleEndedAt={event.lifecycle_ended_at}
                                                        isAdminMaster={isAdminMaster}
                                                        onSuccess={invalidateEvents}
                                                    />
                                                    <DeleteEventDialog
                                                        eventId={event.id}
                                                        eventTitle={event.title}
                                                        onDeleteSuccess={invalidateEvents}
                                                    />
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    );
                                })}
                            </TableBody>
                        </Table>
                    </div>
                )}
            </Card>
            
            {/* Novo Botão CTA no final da tela */}
            <div className="mt-10 text-center">
                <Button 
                    onClick={() => navigate('/manager/events/create')}
                    className="bg-yellow-500 text-black hover:bg-yellow-600 py-3 px-8 text-lg font-semibold transition-all duration-300 cursor-pointer shadow-lg shadow-yellow-500/30 hover:shadow-yellow-500/50"
                >
                    <Plus className="mr-2 h-6 w-6" />
                    Cadastrar Novo Evento
                </Button>
            </div>
        </div>
    );
};

export default ManagerEventsList;