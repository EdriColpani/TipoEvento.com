import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Search, Loader2, FileEdit, QrCode } from 'lucide-react';
import { useManagerEvents } from '@/hooks/use-manager-events';
import { supabase } from '@/integrations/supabase/client';
import DeleteEventDialog from '@/components/DeleteEventDialog';
import EventActiveToggle from '@/components/EventActiveToggle'; 
import { useProfile } from '@/hooks/use-profile'; // Importando useProfile

const ADMIN_MASTER_USER_TYPE_ID = 1;

const ManagerEventsList: React.FC = () => {
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const [userId, setUserId] = useState<string | undefined>(undefined);
    const [searchTerm, setSearchTerm] = useState('');

    useEffect(() => {
        supabase.auth.getUser().then(({ data: { user } }) => {
            setUserId(user?.id);
        });
    }, []);

    const { profile, isLoading: isLoadingProfile } = useProfile(userId);
    const isAdminMaster = profile?.tipo_usuario_id === ADMIN_MASTER_USER_TYPE_ID;

    // O hook agora recebe isAdminMaster
    const { events, isLoading, isError, invalidateEvents: invalidateManagerEvents } = useManagerEvents(
        userId,
        isAdminMaster,
    );

    const invalidateEvents = useCallback(() => {
        invalidateManagerEvents();
        void queryClient.invalidateQueries({ queryKey: ['publicEvents'] });
    }, [invalidateManagerEvents, queryClient]);

    const filteredEvents = events.filter(event =>
        event.title.toLowerCase().includes(searchTerm.toLowerCase())
    );

    // Estado de carregamento inicial (antes de saber se o usuário está logado ou o perfil carregado)
    if (userId === undefined || isLoadingProfile) {
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

    const handleRowClick = (eventId: string) => {
        navigate(`/manager/events/edit/${eventId}`);
    };

    return (
        <div className="max-w-7xl mx-auto">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-8">
                <h1 className="text-2xl sm:text-3xl font-serif text-yellow-500 mb-4 sm:mb-0">
                    {isAdminMaster ? `Todos os Eventos (${events.length})` : `Meus Eventos (${events.length})`}
                </h1>
                <div className="flex flex-wrap gap-3">
                    <Button
                        onClick={() => navigate('/manager/wristbands')}
                        variant="outline"
                        className="bg-black/60 border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 hover:text-black py-3 text-base font-semibold transition-all duration-300 cursor-pointer"
                    >
                        <QrCode className="mr-2 h-5 w-5" />
                        Pulseiras
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
                                    let statusText = 'Publicado';
                                    let statusClasses = 'bg-green-500/20 text-green-400';
                                    if (isDraft) {
                                        statusText = 'Rascunho';
                                        statusClasses = 'bg-gray-500/20 text-gray-400';
                                    } else if (!event.is_active) {
                                        statusText = 'Desativado';
                                        statusClasses = 'bg-orange-500/20 text-orange-300';
                                    }

                                    return (
                                        <TableRow 
                                            key={event.id} 
                                            className="border-b border-yellow-500/10 hover:bg-black/40 transition-colors text-sm cursor-pointer"
                                            onClick={() => handleRowClick(event.id)}
                                        >
                                            <TableCell className="py-4">
                                                <div className="text-white font-medium truncate max-w-[400px]">{event.title}</div>
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
                                                        className="shrink-0 bg-black/60 border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 hover:text-black h-8 px-3"
                                                        onClick={() => handleRowClick(event.id)}
                                                    >
                                                        <FileEdit className="h-4 w-4 mr-2 shrink-0" />
                                                        {isDraft ? 'Continuar Edição' : 'Gerenciar'}
                                                    </Button>
                                                    <EventActiveToggle
                                                        eventId={event.id}
                                                        eventTitle={event.title}
                                                        isDraft={isDraft}
                                                        isActive={event.is_active}
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