import React from 'react';
import { Bell, User, AlertTriangle, Box } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { useNavigate } from 'react-router-dom';
import { useProfile } from '@/hooks/use-profile';
import { supabase } from '@/integrations/supabase/client';

interface NotificationBellProps {
    hasPendingNotifications: boolean;
    loading: boolean;
    isLandingPage?: boolean;
}

// Mock para simular notificações de sistema para o gestor
const getManagerNotifications = (userId: string) => {
    // Esta é uma simulação baseada na lógica de useProfileStatus
    // Na vida real, buscaríamos notificações reais do DB.
    
    // Se o gestor tiver mais de 2 eventos (simulação de baixo estoque ativa)
    if (userId && userId.length > 0) {
        // Simulação de alerta de baixo estoque
        return [
            {
                id: 1,
                type: 'low_stock',
                title: 'Alerta de Estoque Baixo',
                message: 'O evento "Concerto Sinfônico" está com menos de 10% dos ingressos disponíveis. Verifique o estoque.',
                link: '/manager/events/edit/1', // Link mock
                icon: Box,
                color: 'text-yellow-400',
                bgColor: 'bg-yellow-500/10',
                borderColor: 'border-yellow-500/30'
            },
            // Adicionar mais notificações de sistema aqui (ex: nova venda, atualização de evento)
        ];
    }
    return [];
};

const NotificationBell: React.FC<NotificationBellProps> = ({ hasPendingNotifications, loading, isLandingPage = false }) => {
    const navigate = useNavigate();
    const [session, setSession] = React.useState<any>(null);
    
    // Carrega a sessão para obter o ID do usuário
    React.useEffect(() => {
        supabase.auth.getSession().then(({ data: { session: currentSession } }) => {
            setSession(currentSession);
        });
    }, []);

    const userId = session?.user?.id;
    const { profile } = useProfile(userId);
    
    const isManager = profile && (profile.tipo_usuario_id === 1 || profile.tipo_usuario_id === 2);
    const isClient = profile && profile.tipo_usuario_id === 3;
    
    // Se for gestor e houver notificações pendentes (simuladas)
    const managerNotifications = isManager && hasPendingNotifications ? getManagerNotifications(userId!) : [];
    const showManagerAlert = managerNotifications.length > 0;

    if (loading) {
        return (
            <div
                className={`w-8 h-8 rounded-full animate-pulse ${
                    isLandingPage ? 'bg-cyan-400/20' : 'bg-yellow-500/20'
                }`}
            ></div>
        );
    }

    if (!userId) {
        return null; // Não mostra o sino se não estiver logado
    }

    return (
        <Popover>
            <PopoverTrigger asChild>
                <button 
                    className={`relative p-2 rounded-lg transition-colors cursor-pointer ${
                        isLandingPage ? 'text-cyan-300 hover:bg-cyan-400/10' : 'text-yellow-500 hover:bg-yellow-500/10'
                    }`}
                    title={hasPendingNotifications ? "Notificações Pendentes" : "Nenhuma notificação"}
                >
                    <i className="fas fa-bell text-lg"></i>
                    {hasPendingNotifications && (
                        <span className="absolute top-0 right-0 w-3 h-3 bg-red-500 rounded-full border-2 border-black animate-pulse"></span>
                    )}
                </button>
            </PopoverTrigger>
            <PopoverContent className={`w-80 bg-black/90 border text-white p-0 ${isLandingPage ? 'border-cyan-400/30' : 'border-yellow-500/30'}`}>
                <div className={`p-4 border-b ${isLandingPage ? 'border-cyan-400/20' : 'border-yellow-500/20'}`}>
                    <h4 className={`text-lg font-semibold ${isLandingPage ? 'text-cyan-300' : 'text-yellow-500'}`}>Notificações</h4>
                </div>
                <div className="p-4 max-h-80 overflow-y-auto">
                    {/* Lógica para Gestor */}
                    {isManager && showManagerAlert ? (
                        <div className="space-y-3">
                            {managerNotifications.map(notif => (
                                <div key={notif.id} className={`flex items-start p-3 ${notif.bgColor} border ${notif.borderColor} rounded-lg`}>
                                    <notif.icon className={`h-5 w-5 ${notif.color} mt-1 flex-shrink-0`} />
                                    <div className="ml-3">
                                        <p className="text-white font-medium text-sm">{notif.title}</p>
                                        <p className="text-gray-400 text-xs mt-1">
                                            {notif.message}
                                        </p>
                                        <Button 
                                            variant="link" 
                                            className={`h-auto p-0 mt-2 text-xs ${
                                                isLandingPage ? 'text-cyan-300 hover:text-cyan-200' : 'text-yellow-500 hover:text-yellow-400'
                                            }`}
                                            onClick={() => navigate(notif.link)}
                                        >
                                            Ver Detalhes
                                        </Button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : 
                    /* Lógica para Cliente (Perfil Incompleto) */
                    isClient && hasPendingNotifications ? (
                        <div className="space-y-3">
                            <div className="flex items-start p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
                                <AlertTriangle className="h-5 w-5 text-red-400 mt-1 flex-shrink-0" />
                                <div className="ml-3">
                                    <p className="text-white font-medium text-sm">Registro de Gestor Pendente</p>
                                    <p className="text-gray-400 text-xs mt-1">
                                        Você iniciou o processo para se tornar um Gestor PRO. Complete seu cadastro (RG, Endereço, etc.) para liberar o Dashboard PRO.
                                    </p>
                                    <Button 
                                        variant="link" 
                                        className={`h-auto p-0 mt-2 text-xs ${
                                            isLandingPage ? 'text-cyan-300 hover:text-cyan-200' : 'text-yellow-500 hover:text-yellow-400'
                                        }`}
                                        onClick={() => navigate('/manager/register')} // Redireciona para a página de registro de gestor
                                    >
                                        Continuar Cadastro PRO
                                    </Button>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="text-center py-6">
                            <Bell className="h-8 w-8 text-gray-600 mx-auto mb-3" />
                            <p className="text-gray-400 text-sm">Nenhuma notificação pendente.</p>
                        </div>
                    )}
                </div>
            </PopoverContent>
        </Popover>
    );
};

export default NotificationBell;