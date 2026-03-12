import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Search, Loader2, AlertTriangle, Tag, Settings } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useManagerWristbands, WristbandData } from '@/hooks/use-manager-wristbands';
import { useProfile } from '@/hooks/use-profile'; // Importando o hook de perfil

const ADMIN_MASTER_USER_TYPE_ID = 1;

const ManagerWristbandsList: React.FC = () => {
    const navigate = useNavigate();
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
    const { wristbands, isLoading, isError, invalidateWristbands } = useManagerWristbands(userId, isAdminMaster);

    const filteredWristbands = wristbands.filter(wristband =>
        wristband.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
        wristband.events?.title?.toLowerCase().includes(searchTerm.toLowerCase())
    );

    const getStatusClasses = (status: WristbandData['status']) => {
        switch (status) {
            case 'active':
                return 'bg-green-500/20 text-green-400';
            case 'used':
            case 'cancelled':
                return 'bg-gray-500/20 text-gray-400';
            case 'lost':
                return 'bg-red-500/20 text-red-400';
            case 'pending': // NOVO
                return 'bg-yellow-500/20 text-yellow-400';
            default:
                return 'bg-yellow-500/20 text-yellow-400';
        }
    };

    const getStatusText = (status: WristbandData['status']) => {
        switch (status) {
            case 'active': return 'Ativa';
            case 'used': return 'Utilizada';
            case 'lost': return 'Perdida';
            case 'cancelled': return 'Cancelada';
            case 'pending': return 'Pendente'; // NOVO
            default: return 'Desconhecido';
        }
    };

    const handleManageClick = (eventId: string) => {
        navigate(`/manager/wristbands/manage/${eventId}`);
    };

    // Estado de carregamento inicial (antes de saber se o usuário está logado ou o perfil carregado)
    if (userId === undefined || isLoadingProfile) {
        return (
            <div className="max-w-7xl mx-auto text-center py-20">
                <Loader2 className="h-8 w-8 animate-spin text-yellow-500 mx-auto mb-4" />
                <p className="text-gray-400">Verificando autenticação e perfil...</p>
            </div>
        );
    }
    
    // Removemos o check de !company para Admin Master, pois eles não precisam de uma empresa associada
    // para visualizar todas as pulseiras. Para gestores normais, o hook já lida com a ausência de companyId.

    if (isError) {
        return (
            <div className="text-red-400 text-center py-10 flex flex-col items-center">
                <AlertTriangle className="h-10 w-10 mb-4" />
                Erro ao carregar pulseiras.
            </div>
        );
    }

    return (
        <>
            <div className="max-w-7xl mx-auto">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-8">
                <h1 className="text-2xl sm:text-3xl font-serif text-yellow-500 mb-4 sm:mb-0 flex items-center">
                    {/* <QrCodeIcon className="h-7 w-7 mr-3" /> Removido o ícone de QR Code aqui */}
                    {isAdminMaster ? `Todas as Pulseiras (${wristbands.length})` : `Gestão de Pulseiras (${wristbands.length})`}
                </h1>
                {/* Este botão permanece no cabeçalho */}
                <Button 
                    onClick={() => navigate('/manager/wristbands/create')}
                    className="bg-yellow-500 text-black hover:bg-yellow-600 py-3 text-base font-semibold transition-all duration-300 cursor-pointer"
                >
                    <Plus className="mr-2 h-5 w-5" />
                    Cadastrar Nova Pulseira
                </Button>
            </div>

            <Card className="bg-black border border-yellow-500/30 rounded-2xl shadow-2xl shadow-yellow-500/10 p-6">
                {/* Botão movido para o topo do card, antes do campo de pesquisa */}
                <Button 
                    onClick={() => navigate('/manager/wristbands/create')}
                    className="w-full bg-yellow-500 text-black hover:bg-yellow-600 py-3 px-8 text-lg font-semibold transition-all duration-300 cursor-pointer shadow-lg shadow-yellow-500/30 hover:shadow-yellow-500/50 mb-6"
                >
                    <Plus className="mr-2 h-6 w-6" />
                    Cadastrar Nova Pulseira
                </Button>

                <div className="relative mb-6">
                    <Input 
                        type="search" 
                        placeholder="Pesquisar por código ou evento..." 
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="bg-black/60 border-yellow-500/30 text-white placeholder-gray-500 focus:border-yellow-500 w-full pl-10 py-3 rounded-xl"
                    />
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-yellow-500/60" />
                </div>

                {isLoading ? (
                    <div className="text-center py-10">
                        <Loader2 className="h-8 w-8 animate-spin text-yellow-500 mx-auto mb-4" />
                        <p className="text-gray-400">Carregando pulseiras...</p>
                    </div>
                ) : filteredWristbands.length === 0 ? (
                    <div className="text-center py-10">
                        <Tag className="h-12 w-12 text-gray-600 mx-auto mb-4" />
                        <p className="text-gray-400 text-lg">Nenhuma pulseira encontrada.</p>
                        <p className="text-gray-500 text-sm mt-2">Cadastre a primeira pulseira para começar a gerenciar.</p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <Table className="w-full min-w-[800px]">
                            <TableHeader>
                                <TableRow className="border-b border-yellow-500/20 text-sm hover:bg-black/40">
                                    <TableHead className="text-left text-gray-400 font-semibold py-3">Código</TableHead>
                                    <TableHead className="text-left text-gray-400 font-semibold py-3">Evento</TableHead>
                                    <TableHead className="text-center text-gray-400 font-semibold py-3">Tipo de Acesso</TableHead>
                                    <TableHead className="text-center text-gray-400 font-semibold py-3">Status</TableHead>
                                    <TableHead className="text-right text-gray-400 font-semibold py-3 w-[220px]">Ações</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {filteredWristbands.map((wristband) => {
                                    return (
                                        <TableRow 
                                            key={wristband.id} 
                                            className="border-b border-yellow-500/10 hover:bg-black/40 transition-colors text-sm"
                                        >
                                            <TableCell className="py-4">
                                                <div className="text-white font-medium">{wristband.code}</div>
                                            </TableCell>
                                            <TableCell className="py-4">
                                                <div className="text-gray-300 truncate max-w-[200px]">{wristband.events?.title || 'Evento Removido'}</div>
                                            </TableCell>
                                            <TableCell className="text-center py-4">
                                                <span className="text-yellow-500 font-medium">{wristband.access_type}</span>
                                            </TableCell>
                                            <TableCell className="text-center py-4">
                                                <span className={`px-3 py-1 rounded-full text-xs font-semibold ${getStatusClasses(wristband.status)}`}>
                                                    {getStatusText(wristband.status)}
                                                </span>
                                            </TableCell>
                                            <TableCell className="text-right py-4 flex items-center justify-end space-x-2">
                                                <Button 
                                                    variant="outline" 
                                                    size="sm"
                                                    className="bg-black/60 border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 h-8 px-3"
                                                    onClick={() => handleManageClick(wristband.id)}
                                                >
                                                    <Settings className="h-4 w-4 mr-2" />
                                                    Gerenciar
                                                </Button>
                                            </TableCell>
                                        </TableRow>
                                    );
                                })}
                            </TableBody>
                        </Table>
                    </div>
                )}
            </Card>
            
            {/* O botão duplicado na parte inferior foi removido */}
        </div>
        </>
    );
};

export default ManagerWristbandsList;