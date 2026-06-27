import React from 'react';
import { Bell, AlertTriangle, Mail } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';
import { useManagerNotifications } from '@/hooks/use-manager-notifications';
import { useAdminContactInboxSummary } from '@/hooks/use-admin-contact-inbox';
import type { ManagerNotificationItem } from '@/hooks/use-manager-notifications';
import type { ProfileData } from '@/hooks/use-profile';

interface NotificationBellProps {
    userId?: string | null;
    profile?: ProfileData | null;
    hasPendingNotifications: boolean;
    loading?: boolean;
    isLandingPage?: boolean;
}

const NotificationBell: React.FC<NotificationBellProps> = ({
    userId: userIdProp,
    profile: profileProp,
    hasPendingNotifications,
    loading = false,
    isLandingPage = false,
}) => {
    const navigate = useNavigate();
    const userId = userIdProp ?? undefined;
    const profile = profileProp ?? undefined;

    const tipo = Number(profile?.tipo_usuario_id);
    const isAdminMaster = profile && tipo === 1;
    const isGestor = profile && tipo === 2;
    const isManager = Boolean(isAdminMaster || isGestor);
    const isClient = profile && tipo === 3;

    const {
        notifications: managerNotifications,
        isLoading: isLoadingManagerNotifications,
    } = useManagerNotifications(userId, isManager);

    const { newCount: newContactCount, isLoading: isLoadingContactInbox } =
        useAdminContactInboxSummary(Boolean(isAdminMaster));

    const contactNotifications: ManagerNotificationItem[] =
        newContactCount > 0
            ? [
                  {
                      id: 'contact_messages:new',
                      type: 'contact_message',
                      title: 'Mensagens de contato',
                      message:
                          newContactCount === 1
                              ? '1 nova mensagem enviada pelo formulário público do site.'
                              : `${newContactCount} novas mensagens enviadas pelo formulário público do site.`,
                      link: '/admin/settings/contact-messages',
                      icon: Mail,
                      color: 'text-cyan-400',
                      bgColor: 'bg-cyan-500/10',
                      borderColor: 'border-cyan-500/30',
                  },
              ]
            : [];

    const allManagerNotifications = [...contactNotifications, ...managerNotifications];
    const showManagerAlert = isManager && allManagerNotifications.length > 0;
    const managerCount = allManagerNotifications.length;
    const clientHasAlert = isClient && hasPendingNotifications;
    const badgeCount = showManagerAlert ? managerCount : clientHasAlert ? 1 : 0;
    const isLoadingBell =
        loading || (isManager && isLoadingManagerNotifications) || (isAdminMaster && isLoadingContactInbox);

    if (!userId || !profile) {
        return null;
    }

    return (
        <Popover>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    className={`relative p-2 rounded-lg transition-colors cursor-pointer ${
                        isLandingPage ? 'text-cyan-300 hover:bg-cyan-400/10' : 'text-yellow-500 hover:bg-yellow-500/10'
                    } ${isLoadingBell ? 'opacity-70' : ''}`}
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
                className={`z-[200] w-80 bg-black/95 border text-white p-0 ${
                    isLandingPage ? 'border-cyan-400/30' : 'border-yellow-500/30'
                }`}
            >
                <div className={`p-4 border-b ${isLandingPage ? 'border-cyan-400/20' : 'border-yellow-500/20'}`}>
                    <h4 className={`text-lg font-semibold ${isLandingPage ? 'text-cyan-300' : 'text-yellow-500'}`}>
                        Notificações
                    </h4>
                </div>
                <div className="p-4 max-h-80 overflow-y-auto">
                    {isLoadingBell ? (
                        <div className="text-center py-6">
                            <p className="text-gray-400 text-sm">Carregando notificações...</p>
                        </div>
                    ) : showManagerAlert ? (
                        <div className="space-y-3">
                            {allManagerNotifications.map((notif) => (
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
                                        Complete seu cadastro (RG, endereço, etc.) para liberar o Dashboard.
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
                                        Continuar cadastro de gestor
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
