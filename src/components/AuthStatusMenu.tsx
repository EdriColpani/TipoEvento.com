import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { showSuccess, showError } from '@/utils/toast';
import { useProfileStatus } from '@/hooks/use-profile-status';
import NotificationBell from './NotificationBell';
import { Shield, LayoutDashboard } from 'lucide-react';
import { useUserType } from '@/hooks/use-user-type';
import { useManagerCompany } from '@/hooks/use-manager-company';
import { usePublicSiteContext } from '@/contexts/PublicLaunchModeContext';

const AuthStatusMenu: React.FC = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const isLandingPage = location.pathname === '/';
    const {
        userId,
        profile,
        sessionReady,
        profileLoading,
        isAuthenticated,
        showPreLaunchExperience,
    } = usePublicSiteContext();

    const { hasPendingNotifications } = useProfileStatus(profile, profileLoading, userId);

    const { userTypeName: baseUserTypeName } = useUserType(
        isAuthenticated ? profile?.tipo_usuario_id : undefined,
    );

    const isManagerPro = Number(profile?.tipo_usuario_id) === 2;
    const { company } = useManagerCompany(isManagerPro ? userId : undefined);

    const handleLogout = async () => {
        try {
            const { error } = await supabase.auth.signOut({ scope: 'local' });

            const sessionMissing = error?.message?.toLowerCase().includes('auth session missing');

            if (error && !sessionMissing) {
                showError('Erro ao sair: ' + error.message);
            } else {
                showSuccess('Sessão encerrada.');
            }
        } catch {
            showSuccess('Sessão encerrada.');
        } finally {
            navigate('/login', { replace: true });
        }
    };

    if (!sessionReady) {
        return (
            <div
                className={`w-10 h-10 rounded-full animate-pulse ${
                    isLandingPage ? 'bg-cyan-400/20' : 'bg-yellow-500/20'
                }`}
            ></div>
        );
    }

    if (isAuthenticated && profileLoading && !profile) {
        return (
            <div
                className={`w-10 h-10 rounded-full animate-pulse ${
                    isLandingPage ? 'bg-cyan-400/20' : 'bg-yellow-500/20'
                }`}
            ></div>
        );
    }

    if (isAuthenticated && profile) {
        const initials = profile.first_name ? profile.first_name.charAt(0).toUpperCase() : 'U';
        const tipo = Number(profile.tipo_usuario_id);
        const isManager = tipo === 1 || tipo === 2;
        const isClient = tipo === 3;
        const isAdmin = tipo === 1;

        const fullName = profile.first_name + (profile.last_name ? ` ${profile.last_name}` : '');

        let userRoleDisplay = baseUserTypeName;
        if (isManagerPro) {
            userRoleDisplay = company?.id ? `${baseUserTypeName} (PJ)` : `${baseUserTypeName} (PF)`;
        }

        return (
            <div className="flex items-center space-x-4">
                <NotificationBell
                    userId={userId}
                    profile={profile}
                    hasPendingNotifications={hasPendingNotifications}
                    isLandingPage={isLandingPage}
                />

                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <div
                            className={`cursor-pointer p-1 rounded-full border-2 transition-all duration-300 ${
                                isLandingPage
                                    ? 'border-cyan-400/60 hover:border-blue-500'
                                    : 'border-yellow-500/50 hover:border-yellow-500'
                            }`}
                        >
                            <Avatar className="h-8 w-8">
                                <AvatarImage src={profile.avatar_url || undefined} alt={profile.first_name} />
                                <AvatarFallback
                                    className={`text-black font-bold text-sm ${
                                        isLandingPage ? 'bg-cyan-400' : 'bg-yellow-500'
                                    }`}
                                >
                                    {initials}
                                </AvatarFallback>
                            </Avatar>
                        </div>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                        className={`w-56 bg-black/90 border text-white ${
                            isLandingPage ? 'border-cyan-400/30' : 'border-yellow-500/30'
                        }`}
                    >
                        <DropdownMenuLabel
                            className={`truncate max-w-[200px] ${
                                isLandingPage ? 'text-cyan-300' : 'text-yellow-500'
                            }`}
                        >
                            {fullName}
                        </DropdownMenuLabel>
                        <DropdownMenuLabel className="text-gray-400 text-xs pt-0">
                            {userRoleDisplay || 'Usuário'}
                        </DropdownMenuLabel>
                        <DropdownMenuSeparator className={isLandingPage ? 'bg-cyan-400/20' : 'bg-yellow-500/20'} />
                        <DropdownMenuItem
                            onClick={() => navigate('/profile')}
                            className={`cursor-pointer ${isLandingPage ? 'hover:bg-cyan-400/10' : 'hover:bg-yellow-500/10'}`}
                        >
                            <i className="fas fa-user-circle mr-2"></i>
                            Editar Perfil
                        </DropdownMenuItem>
                        <DropdownMenuItem
                            onClick={() => navigate('/tickets')}
                            className={`cursor-pointer ${isLandingPage ? 'hover:bg-cyan-400/10' : 'hover:bg-yellow-500/10'}`}
                        >
                            <i className="fas fa-ticket-alt mr-2"></i>
                            Meus Ingressos
                        </DropdownMenuItem>
                        <DropdownMenuItem
                            onClick={() => navigate('/wallet')}
                            className={`cursor-pointer ${isLandingPage ? 'hover:bg-cyan-400/10' : 'hover:bg-yellow-500/10'}`}
                        >
                            <i className="fas fa-wallet mr-2"></i>
                            Carteira EventFest
                        </DropdownMenuItem>

                        {isClient && !showPreLaunchExperience && (
                            <DropdownMenuItem
                                onClick={() => navigate('/manager/register')}
                                className={`cursor-pointer text-green-400 font-semibold ${
                                    isLandingPage ? 'hover:bg-cyan-400/10' : 'hover:bg-yellow-500/10'
                                }`}
                            >
                                <i className="fas fa-plus-circle mr-2"></i>
                                Cadastrar Eventos
                            </DropdownMenuItem>
                        )}

                        {isManager && (
                            <DropdownMenuItem
                                onClick={() => navigate('/manager/dashboard')}
                                className={`cursor-pointer font-semibold ${
                                    isLandingPage ? 'hover:bg-cyan-400/10 text-cyan-300' : 'hover:bg-yellow-500/10 text-yellow-500'
                                }`}
                            >
                                <LayoutDashboard className="mr-2 h-4 w-4" />
                                Dashboard
                            </DropdownMenuItem>
                        )}
                        {isAdmin && (
                            <DropdownMenuItem
                                onClick={() => navigate('/admin/dashboard')}
                                className={`cursor-pointer text-red-400 font-semibold ${
                                    isLandingPage ? 'hover:bg-cyan-400/10' : 'hover:bg-yellow-500/10'
                                }`}
                            >
                                <Shield className="mr-2 h-4 w-4" />
                                Dashboard Admin
                            </DropdownMenuItem>
                        )}
                        <DropdownMenuSeparator className={isLandingPage ? 'bg-cyan-400/20' : 'bg-yellow-500/20'} />
                        <DropdownMenuItem
                            onClick={handleLogout}
                            className="cursor-pointer hover:bg-red-500/10 text-red-400"
                        >
                            <i className="fas fa-sign-out-alt mr-2"></i>
                            Sair
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>
        );
    }

    return (
        <div className="flex items-center space-x-3">
            <Button
                onClick={() =>
                    navigate('/login', {
                        state: { from: `${location.pathname}${location.search}` },
                    })
                }
                className={`bg-transparent transition-all duration-300 cursor-pointer px-4 ${
                    isLandingPage ? 'text-cyan-300 hover:bg-cyan-400/10' : 'text-yellow-500 hover:bg-yellow-500/10'
                }`}
            >
                Login
            </Button>
            {!showPreLaunchExperience ? (
                <Button
                    onClick={() => navigate('/register')}
                    className={`border bg-transparent transition-all duration-300 cursor-pointer px-4 ${
                        isLandingPage
                            ? 'border-cyan-400 text-cyan-300 hover:bg-cyan-400 hover:text-black'
                            : 'border-yellow-500 text-yellow-500 hover:bg-yellow-500 hover:text-black'
                    }`}
                >
                    Cadastro
                </Button>
            ) : null}
        </div>
    );
};

export default AuthStatusMenu;
