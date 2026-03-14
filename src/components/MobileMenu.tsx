import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Menu, X, Bell, User, LogOut, Crown } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { supabase } from '@/integrations/supabase/client';
import { useProfileStatus } from '@/hooks/use-profile-status';
import { useProfile } from '@/hooks/use-profile';
import { useUserType } from '@/hooks/use-user-type'; // Importando novo hook
import { showSuccess, showError } from '@/utils/toast';
import { useManagerCompany } from '@/hooks/use-manager-company'; // NOVO: Importando hook da empresa

const MANAGER_USER_TYPE_ID = 2;

const MobileMenu: React.FC = () => {
    const navigate = useNavigate();
    const [isOpen, setIsOpen] = useState(false);
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
    const isManagerPro = profile?.tipo_usuario_id === MANAGER_USER_TYPE_ID;
    const { company, isLoading: isLoadingCompany } = useManagerCompany(isManagerPro ? userId : undefined);


    const handleNavigation = (path: string) => {
        setIsOpen(false);
        navigate(path);
    };

    const handleLogout = async () => {
        const { error } = await supabase.auth.signOut();
        if (error) {
            showError("Erro ao sair: " + error.message);
        } else {
            showSuccess("Sessão encerrada com sucesso.");
            handleNavigation('/');
        }
    };

    const navItems = [
        { path: '/', label: 'Home', icon: 'fas fa-home' },
        { path: '/#eventos', label: 'Eventos', icon: 'fas fa-calendar-alt' },
        { path: '/#categorias', label: 'Categorias', icon: 'fas fa-th-large' },
        { path: '/#contato', label: 'Contato', icon: 'fas fa-envelope' },
    ];

    const isUserLoading = loadingSession || isLoadingProfile || statusLoading || isLoadingUserType || (isManagerPro && isLoadingCompany);
    const isLoggedIn = session && profile;
    const isManager = isLoggedIn && (profile.tipo_usuario_id === 1 || profile.tipo_usuario_id === 2);
    
    const fullName = profile?.first_name + (profile?.last_name ? ` ${profile.last_name}` : '');
    
    let userRoleDisplay = baseUserTypeName;
    if (isManagerPro) {
        userRoleDisplay = company?.id ? `${baseUserTypeName} (PJ)` : `${baseUserTypeName} (PF)`;
    }


    return (
        <Sheet open={isOpen} onOpenChange={setIsOpen}>
            <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="md:hidden relative text-yellow-500 hover:bg-yellow-500/10">
                    <Menu className="h-6 w-6" />
                    {isLoggedIn && hasPendingNotifications && (
                        <span className="absolute top-1 right-1 w-3 h-3 bg-red-500 rounded-full border-2 border-black"></span>
                    )}
                </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-[300px] sm:w-[400px] bg-black/95 border-l border-yellow-500/30 text-white p-0">
                <SheetHeader className="p-6 border-b border-yellow-500/20">
                    <SheetTitle className="text-3xl font-serif text-yellow-500">EventoFest</SheetTitle>
                </SheetHeader>
                
                <div className="p-6 space-y-6">
                    {isUserLoading ? (
                        <div className="flex items-center space-x-4">
                            <div className="w-10 h-10 bg-yellow-500/20 rounded-full animate-pulse"></div>
                            <div className="h-4 w-32 bg-yellow-500/20 rounded"></div>
                        </div>
                    ) : isLoggedIn ? (
                        <div className="space-y-4">
                            <div className="flex items-center space-x-3 p-3 bg-yellow-500/10 rounded-xl border border-yellow-500/20">
                                <div className="w-10 h-10 bg-yellow-500 rounded-full flex items-center justify-center text-black font-bold">
                                    <User className="h-5 w-5" />
                                </div>
                                <div className="min-w-0">
                                    <div className="text-white font-semibold truncate">{fullName || 'Usuário'}</div>
                                    <div className="text-gray-400 text-sm truncate">{userRoleDisplay}</div>
                                </div>
                            </div>

                            <Button 
                                onClick={() => handleNavigation('/profile')}
                                variant="ghost"
                                className="w-full justify-start text-lg py-6 text-white hover:bg-yellow-500/10"
                            >
                                <User className="mr-3 h-5 w-5" />
                                Editar Perfil
                                {hasPendingNotifications && <Bell className="ml-auto h-5 w-5 text-red-500 animate-pulse" />}
                            </Button>
                            <Button 
                                onClick={() => handleNavigation('/tickets')}
                                variant="ghost"
                                className="w-full justify-start text-lg py-6 text-white hover:bg-yellow-500/10"
                            >
                                <i className="fas fa-ticket-alt mr-3 w-5"></i>
                                Meus Ingressos
                            </Button>
                            {isManager && (
                                <Button 
                                    onClick={() => handleNavigation('/manager/dashboard')}
                                    variant="ghost"
                                    className="w-full justify-start text-lg py-6 text-yellow-500 font-semibold hover:bg-yellow-500/10"
                                >
                                    <Crown className="mr-3 h-5 w-5" />
                                    Dashboard PRO
                                </Button>
                            )}
                            <div className="border-t border-yellow-500/20 pt-4">
                                <Button 
                                    onClick={handleLogout}
                                    variant="ghost"
                                    className="w-full justify-start text-lg py-6 text-red-400 hover:bg-red-500/10"
                                >
                                    <LogOut className="mr-3 h-5 w-5" />
                                    Sair
                                </Button>
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            <Button
                                onClick={() => handleNavigation('/login')}
                                className="w-full bg-yellow-500 text-black hover:bg-yellow-600 py-3 text-lg font-semibold"
                            >
                                Login
                            </Button>
                            <Button
                                onClick={() => handleNavigation('/register')}
                                className="w-full bg-transparent border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 py-3 text-lg font-semibold"
                            >
                                Cadastro
                            </Button>
                        </div>
                    )}

                    <div className="border-t border-yellow-500/20 pt-6 space-y-2">
                        {navItems.map(item => (
                            <a 
                                key={item.path}
                                href={item.path}
                                onClick={() => setIsOpen(false)}
                                className="flex items-center p-3 rounded-xl text-white hover:bg-yellow-500/10 transition-colors duration-200"
                            >
                                <i className={`${item.icon} mr-4 text-yellow-500 w-5`}></i>
                                <span className="text-lg">{item.label}</span>
                            </a>
                        ))}
                    </div>
                </div>
            </SheetContent>
        </Sheet>
    );
};

export default MobileMenu;