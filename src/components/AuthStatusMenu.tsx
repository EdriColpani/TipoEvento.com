import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { showSuccess, showError } from '@/utils/toast';
import { useProfileStatus } from '@/hooks/use-profile-status';
import { useProfile, ProfileData } from '@/hooks/use-profile';
import NotificationBell from './NotificationBell';
import { Shield } from 'lucide-react'; // Importando ícone para Admin
import { useUserType } from '@/hooks/use-user-type'; // Importando novo hook
import { useManagerCompany } from '@/hooks/use-manager-company'; // NOVO: Importando hook da empresa

const AuthStatusMenu: React.FC = () => {
    const navigate = useNavigate();
    const [session, setSession] = useState<any>(null);
    const [loadingSession, setLoadingSession] = useState(true);

    useEffect(() => {
        const { data: authListener } = supabase.auth.onAuthStateChange((_event, currentSession) => {
            setSession(currentSession);
            setLoadingSession(false);
        });

        supabase.auth.getSession().then(({ data: { session: initialSession } }) => {
            setSession(initialSession);
            setLoadingSession(false);
        });

        return () => {
            authListener.subscription.unsubscribe();
        };
    }, []);

    const userId = session?.user?.id;
    const { profile, isLoading: isLoadingProfile } = useProfile(userId);
    
    const { hasPendingNotifications, loading: statusLoading } = useProfileStatus(profile, isLoadingProfile);
    
    // Obtém o nome base do tipo de usuário
    const { userTypeName: baseUserTypeName, isLoadingUserType } = useUserType(profile?.tipo_usuario_id);
    
    // NOVO: Busca dados da empresa se for Gestor PRO (tipo 2)
    const isManagerPro = profile?.tipo_usuario_id === 2;
    const { company, isLoading: isLoadingCompany } = useManagerCompany(isManagerPro ? userId : undefined);

    const handleLogout = async () => {
        try {
            const { error } = await supabase.auth.signOut({ scope: 'local' });

            const sessionMissing = error?.message?.toLowerCase().includes('auth session missing');

            // Quando a sessão já expirou, o Supabase pode retornar "Auth session missing!".
            // Nesse caso, tratamos como logout bem-sucedido para não travar o usuário.
            if (error && !sessionMissing) {
                showError('Erro ao sair: ' + error.message);
            } else {
                showSuccess('Sessão encerrada.');
            }
        } catch (err: unknown) {
            showSuccess('Sessão encerrada.');
        } finally {
            setSession(null);
            navigate('/login', { replace: true });
        }
    };

    if (loadingSession || isLoadingProfile || statusLoading || isLoadingUserType || (isManagerPro && isLoadingCompany)) {
        // Pode retornar um Skeleton ou null durante o carregamento inicial
        return <div className="w-10 h-10 bg-yellow-500/20 rounded-full animate-pulse"></div>;
    }

    if (session && profile) {
        const initials = profile.first_name ? profile.first_name.charAt(0).toUpperCase() : 'U';
        const isManager = profile.tipo_usuario_id === 1 || profile.tipo_usuario_id === 2;
        const isClient = profile.tipo_usuario_id === 3;
        const isAdmin = profile.tipo_usuario_id === 1; 
        
        const fullName = profile.first_name + (profile.last_name ? ` ${profile.last_name}` : '');
        
        let userRoleDisplay = baseUserTypeName;
        if (isManagerPro) {
            // Se for Gestor PRO (tipo 2), verifica se tem empresa
            userRoleDisplay = company?.id ? `${baseUserTypeName} (PJ)` : `${baseUserTypeName} (PF)`;
        }


        return (
            <div className="flex items-center space-x-4">
                {/* Ícone de Notificação (Agora é um Popover) */}
                <NotificationBell 
                    hasPendingNotifications={hasPendingNotifications} 
                    loading={statusLoading} 
                />

                {/* Menu de Perfil */}
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <div className="cursor-pointer p-1 rounded-full border-2 border-yellow-500/50 hover:border-yellow-500 transition-all duration-300">
                            <Avatar className="h-8 w-8">
                                <AvatarImage src={profile.avatar_url || undefined} alt={profile.first_name} />
                                <AvatarFallback className="bg-yellow-500 text-black font-bold text-sm">{initials}</AvatarFallback>
                            </Avatar>
                        </div>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent className="w-56 bg-black/90 border border-yellow-500/30 text-white">
                        <DropdownMenuLabel className="text-yellow-500 truncate max-w-[200px]">
                            {fullName}
                        </DropdownMenuLabel>
                        <DropdownMenuLabel className="text-gray-400 text-xs pt-0">
                            {userRoleDisplay}
                        </DropdownMenuLabel>
                        <DropdownMenuSeparator className="bg-yellow-500/20" />
                        <DropdownMenuItem 
                            onClick={() => navigate('/profile')} 
                            className="cursor-pointer hover:bg-yellow-500/10"
                        >
                            <i className="fas fa-user-circle mr-2"></i>
                            Editar Perfil
                        </DropdownMenuItem>
                        <DropdownMenuItem 
                            onClick={() => navigate('/tickets')} 
                            className="cursor-pointer hover:bg-yellow-500/10"
                        >
                            <i className="fas fa-ticket-alt mr-2"></i>
                            Meus Ingressos
                        </DropdownMenuItem>
                        
                        {/* NOVO: Cadastrar Eventos para Clientes (Tipo 3) */}
                        {isClient && (
                            <DropdownMenuItem 
                                onClick={() => navigate('/manager/register')} 
                                className="cursor-pointer hover:bg-yellow-500/10 text-green-400 font-semibold"
                            >
                                <i className="fas fa-plus-circle mr-2"></i>
                                Cadastrar Eventos
                            </DropdownMenuItem>
                        )}

                        {isManager && (
                            <DropdownMenuItem 
                                onClick={() => navigate('/manager/dashboard')} 
                                className="cursor-pointer hover:bg-yellow-500/10 text-yellow-500 font-semibold"
                            >
                                <i className="fas fa-crown mr-2"></i>
                                Dashboard PRO
                            </DropdownMenuItem>
                        )}
                        {isAdmin && (
                            <DropdownMenuItem 
                                onClick={() => navigate('/admin/dashboard')} 
                                className="cursor-pointer hover:bg-yellow-500/10 text-red-400 font-semibold"
                            >
                                <Shield className="mr-2 h-4 w-4" />
                                Dashboard Admin
                            </DropdownMenuItem>
                        )}
                        <DropdownMenuSeparator className="bg-yellow-500/20" />
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

    // Se não estiver logado, retorna os botões de Login/Cadastro
    return (
        <div className="flex items-center space-x-3">
            <Button
                onClick={() => navigate('/login')}
                className="bg-transparent text-yellow-500 hover:bg-yellow-500/10 transition-all duration-300 cursor-pointer px-4"
            >
                Login
            </Button>
            <Button
                onClick={() => navigate('/register')}
                className="border border-yellow-500 bg-transparent text-yellow-500 hover:bg-yellow-500 hover:text-black transition-all duration-300 cursor-pointer px-4"
            >
                Cadastro
            </Button>
        </div>
    );
};

export default AuthStatusMenu;