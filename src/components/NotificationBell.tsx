import React from 'react';
import { Bell, AlertTriangle } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';
import { useProfile } from '@/hooks/use-profile';
import { useManagerNotifications } from '@/hooks/use-manager-notifications';
import { supabase } from '@/integrations/supabase/client';

interface NotificationBellProps {
    hasPendingNotifications: boolean;
    loading: boolean;
    isLandingPage?: boolean;
}

const NotificationBell: React.FC<NotificationBellProps> = ({
    hasPendingNotifications,
    loading,
    isLandingPage = false,
}) => {
    const navigate = useNavigate();
    const [session, setSession] = React.useState<{ user?: { id?: string } } | null>(null);

    React.useEffect(() => {
        supabase.auth.getSession().then(({ data: { session: currentSession } }) => {
            setSession(currentSession);
        });
    }, []);

    const userId = session?.user?.id;
    const { profile } = useProfile(userId);

    const isManager = profile && (profile.tipo_usuario_id === 1 || profile.tipo_usuario_id === 2);
    const isClient = profile && profile.tipo_usuario_id === 3;

    const {
        notifications: managerNotifications,
        hasPendingNotifications: hasManagerNotifications,
        isLoading: isLoadingManagerNotifications,
    } = useManagerNotifications(userId, Boolean(isManager));

    const showManagerAlert = isManager && hasManagerNotifications;
    const managerCount = managerNotifications.length;
    const clientHasAlert = isClient && hasPendingNotifications;
    const badgeCount = showManagerAlert ? managerCount : clientHasAlert ? 1 : 0;
    const isLoadingBell = loading || (isManager && isLoadingManagerNotifications);

    if (isLoadingBell) {
        return (
            <div
                className={`w-8 h-8 rounded-full animate-pulse ${
                    isLandingPage ? 'bg-cyan-400/20' : 'bg-yellow-500/20'
                }`}
            />
        );
    }

    if (!userId) {
        return null;
    }

    return (
        <Popover>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    className={`relative p-2 rounded-lg transition-colors cursor-pointer ${
                        isLandingPage ? 'text-cyan-300 hover:bg-cyan-400/10' : 'text-yellow-500 hover:bg-yellow-500/10'
                    }`}
                    title={badgeCount > 0 ? 'Notificações pendentes' : 'Nenhuma notificação'}
                >
                    <i className="fas fa-bell text-lg" />
                    {badgeCount > 0 && (
                        <span className="absolute -top-1 -right-1 min-w-4 h-4 px-1 bg-red-500 rounded-full flex items-center justify-center text-[10px] font-semibold text-white">
                            {badgeCount > 9 ? '9+' : badgeCount}
                        </span>
                    )}
                </button>
            </PopoverTrigger>
            <PopoverContent
                className={`w-80 bg-black/90 border text-white p-0 ${
                    isLandingPage ? 'border-cyan-400/30' : 'border-yellow-500/30'
                }`}
            >
                <div className={`p-4 border-b ${isLandingPage ? 'border-cyan-400/20' : 'border-yellow-500/20'}`}>
                    <h4 className={`text-lg font-semibold ${isLandingPage ? 'text-cyan-300' : 'text-yellow-500'}`}>
                        Notificações
                    </h4>
                </div>
                <div className="p-4 max-h-80 overflow-y-auto">
                    {showManagerAlert ? (
                        <div className="space-y-3">
                            {managerNotifications.map((notif) => (
                                <div
                                    key={notif.id}
                                    className={`flex items-start p-3 ${notif.bgColor} border ${notif.borderColor} rounded-lg`}
                                >
                                    <notif.icon className={`h-5 w-5 ${notif.color} mt-1 flex-shrink-0`} />
                                    <div className="ml-3 min-w-0">
                                        <p className="text-white font-medium text-sm">{notif.title}</p>
                                        <p className="text-gray-400 text-xs mt-1">{notif.message}</p>
                                        <Button
                                            variant="link"
                                            className={`h-auto p-0 mt-2 text-xs ${
                                                isLandingPage
                                                    ? 'text-cyan-300 hover:text-cyan-200'
                                                    : 'text-yellow-500 hover:text-yellow-400'
                                            }`}
                                            onClick={() => navigate(notif.link)}
                                        >
                                            Ver detalhes
                                        </Button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : clientHasAlert ? (
                        <div className="space-y-3">
                            <div className="flex items-start p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
                                <AlertTriangle className="h-5 w-5 text-red-400 mt-1 flex-shrink-0" />
                                <div className="ml-3">
                                    <p className="text-white font-medium text-sm">Registro de gestor pendente</p>
                                    <p className="text-gray-400 text-xs mt-1">
                                        Complete seu cadastro (RG, endereço, etc.) para liberar o Dashboard PRO.
                                    </p>
                                    <Button
                                        variant="link"
                                        className={`h-auto p-0 mt-2 text-xs ${
                                            isLandingPage
                                                ? 'text-cyan-300 hover:text-cyan-200'
                                                : 'text-yellow-500 hover:text-yellow-400'
                                        }`}
                                        onClick={() => navigate('/manager/register')}
                                    >
                                        Continuar cadastro PRO
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
