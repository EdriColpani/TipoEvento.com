import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate, useLocation, Outlet } from 'react-router-dom';
import { Button } from "@/components/ui/button";
import { Menu, X, Loader2, Crown, LogOut, User, Settings, QrCode, BarChart3, CalendarDays, ChevronDown, SlidersHorizontal, Plus, Image, ListOrdered, History, CreditCard, Percent, FileText, Key, Database } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger } from "@/components/ui/dropdown-menu";
import { supabase } from '@/integrations/supabase/client';
import { useProfile } from '@/hooks/use-profile';
import { useUserType } from '@/hooks/use-user-type';
import { showError, showSuccess } from '@/utils/toast';
import { useManagerCompany } from '@/hooks/use-manager-company';
import { useDevice } from '@/hooks/use-device';

const ADMIN_USER_TYPE_ID = 1;
const MANAGER_USER_TYPE_ID = 2;

const ManagerLayout: React.FC = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const headerRef = useRef<HTMLElement>(null);
    const [headerHeight, setHeaderHeight] = useState(0);
    const [userId, setUserId] = useState<string | undefined>(undefined);
    const [loadingSession, setLoadingSession] = useState(true);
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
    const { isMobile, isTablet } = useDevice();

    const isAdminSettingsPath = useMemo(() => {
        return location.pathname.startsWith('/admin/settings') ||
               location.pathname.startsWith('/manager/settings/advanced') ||
               location.pathname.startsWith('/manager/settings/backup-database') ||
               location.pathname.startsWith('/manager/settings/history');
    }, [location.pathname]);

    useEffect(() => {
        const measureHeaderHeight = () => {
            if (headerRef.current) {
                setHeaderHeight(headerRef.current.offsetHeight);
            }
        };

        // Mede imediatamente
        measureHeaderHeight();
        
        // Mede novamente após um pequeno delay para garantir que o DOM está totalmente renderizado
        const timeoutId = setTimeout(measureHeaderHeight, 100);
        
        window.addEventListener('resize', measureHeaderHeight);

        return () => {
            clearTimeout(timeoutId);
            window.removeEventListener('resize', measureHeaderHeight);
        };
    }, []); // Empty dependency array means this effect runs once on mount and cleans up on unmount

    useEffect(() => {
        supabase.auth.getUser().then(({ data: { user } }) => {
            setUserId(user?.id);
            setLoadingSession(false);
        });
    }, []);

    const { profile, isLoading: isLoadingProfile } = useProfile(userId);
    const { userTypeName: baseUserTypeName, isLoadingUserType } = useUserType(profile?.tipo_usuario_id);
    
    const isManagerPro = profile?.tipo_usuario_id === MANAGER_USER_TYPE_ID;
    const { company, isLoading: isLoadingCompany } = useManagerCompany(isManagerPro ? userId : undefined);


    const handleLogout = async () => {
        try {
            const { error } = await supabase.auth.signOut({ scope: 'local' });
            const sessionMissing = error?.message?.toLowerCase().includes('auth session missing');

            // Se a sessão já expirou, o Supabase pode retornar erro "Auth session missing!".
            // Nesse caso, ainda assim tratamos como logout para destravar o usuário.
            if (error && !sessionMissing) {
                showError('Erro ao sair: ' + error.message);
            } else {
                showSuccess('Sessão encerrada.');
            }
        } catch {
            showSuccess('Sessão encerrada.');
        } finally {
            setUserId(undefined);
            setLoadingSession(false);
            navigate('/manager/login', { replace: true });
        }
    };

    // Show loading spinner while session or profile/company data is being fetched
    if (loadingSession || isLoadingProfile || isLoadingUserType || (isManagerPro && isLoadingCompany)) {
        return (
            <div className="min-h-screen bg-black text-white flex items-center justify-center">
                <Loader2 className="h-10 w-10 animate-spin text-yellow-500" />
            </div>
        );
    }

    // Redirect unauthenticated users to login after loading is complete
    if (!userId && !loadingSession) { // Ensure loadingSession is false before redirecting
        if (location.pathname.startsWith('/manager') || location.pathname.startsWith('/admin')) {
            navigate('/manager/login');
            return null; // Prevent rendering anything else
        }
    }
    
    // Check if user is authorized (Admin or Manager)
    const userType = profile?.tipo_usuario_id;
    const isManager = userType === ADMIN_USER_TYPE_ID || userType === MANAGER_USER_TYPE_ID;
    const isAdminMaster = userType === ADMIN_USER_TYPE_ID;

    if (!isManager) {
        // If the user is logged in but not a manager/admin (e.g., client type 3), redirect them
        if (location.pathname.startsWith('/manager') || location.pathname.startsWith('/admin')) {
            navigate('/');
            return null;
        }
    }
    
    const baseNavItems = [
        { path: '/', label: 'Home', icon: <User className="mr-2 h-4 w-4" /> },
        { path: '/manager/dashboard', label: 'Dashboard PRO', icon: <Crown className="mr-2 h-4 w-4" /> },
        { path: '/manager/events', label: 'Eventos', icon: <CalendarDays className="mr-2 h-4 w-4" /> },
        { path: '/manager/events/create', label: 'Criar Novo Evento', icon: <Plus className="mr-2 h-4 w-4" /> },
        { path: '/manager/events/banners/create', label: 'Criar Banner de Evento', icon: <Image className="mr-2 h-4 w-4" /> },
        { path: '/manager/wristbands', label: 'Pulseiras', icon: <QrCode className="mr-2 h-4 w-4" /> },
        { path: '/manager/validation-keys', label: 'Chaves de Validação', icon: <Key className="mr-2 h-4 w-4" /> },
        { path: '/manager/reports', label: 'Relatórios', icon: <BarChart3 className="mr-2 h-4 w-4" /> },
        { path: '/manager/settings', label: 'Configurações', icon: <Settings className="mr-2 h-4 w-4" /> },
    ];
    
    let allNavItems = [...baseNavItems];

    // Adiciona links específicos do Admin Master
    if (isAdminMaster) {
        allNavItems.splice(1, 0, { path: '/admin/dashboard', label: 'Dashboard Admin', icon: <Crown className="mr-2 h-4 w-4" /> });
    }
    
    // FILTRAGEM: Remove o item cuja rota é a rota atual
    const navItems = allNavItems.filter(item => item.path !== location.pathname);
    
    const dashboardTitle = isAdminMaster && location.pathname.startsWith('/admin') ? 'ADMIN' : 'PRO';
    
    const userName = profile?.first_name || 'Gestor';
    
    let userRoleDisplay = baseUserTypeName;
    if (isManagerPro) {
        userRoleDisplay = company?.id ? `${baseUserTypeName} (PJ)` : `${baseUserTypeName} (PF)`;
    } else {
        userRoleDisplay = baseUserTypeName;
    }


    return (
        <div className="min-h-screen bg-black text-white">
            <header ref={headerRef} className="fixed top-0 left-0 right-0 z-[110] bg-black/90 backdrop-blur-md border-b border-yellow-500/20">
                <div className={`flex items-center justify-between max-w-7xl mx-auto ${isMobile ? 'px-3 py-3' : isTablet ? 'px-4 py-4' : 'px-6 py-4'}`}>
                    <div className="flex items-center space-x-4 sm:space-x-6">
                        <div 
                            className="text-xl sm:text-2xl font-serif text-yellow-500 font-bold flex items-center cursor-pointer"
                            onClick={() => navigate('/')}
                        >
                            EventoFest
                            <span className="ml-2 sm:ml-3 bg-gradient-to-r from-yellow-500 to-yellow-600 text-black px-2 sm:px-3 py-0.5 rounded-lg text-xs sm:text-sm font-bold">{dashboardTitle}</span>
                        </div>
                    </div>
                    <div className="flex items-center space-x-3 sm:space-x-4">
                        <button className="relative p-2 text-yellow-500 hover:bg-yellow-500/10 rounded-lg transition-colors cursor-pointer hidden sm:block">
                            <i className="fas fa-bell text-lg"></i>
                            <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full flex items-center justify-center text-xs text-white">3</span>
                        </button>
                        
                        {/* Dropdown Menu para Gestor/Admin */}
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button
                                    variant="outline"
                                    className="hidden md:flex items-center bg-black/60 border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/30 hover:border-yellow-500 transition-all duration-300 cursor-pointer px-4 py-2 h-10"
                                >
                                    <Crown className="h-5 w-5 mr-2" />
                                    <span className="font-semibold">{userName}</span>
                                    <span className="text-gray-400 text-xs ml-2 hidden lg:block">{userRoleDisplay}</span>
                                    <ChevronDown className="ml-2 h-4 w-4" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent className="w-56 bg-black/90 border border-yellow-500/30 text-white">
                                <DropdownMenuLabel className="text-yellow-500 truncate max-w-[200px]">
                                    {userName}
                                </DropdownMenuLabel>
                                <DropdownMenuLabel className="text-gray-400 text-xs pt-0">
                                    {userRoleDisplay}
                                </DropdownMenuLabel>
                                <DropdownMenuSeparator className="bg-yellow-500/20" />
                                
                                {/* Renderiza itens de navegação */}
                                {allNavItems.map(item => {
                                    // Se for Admin Master, e o item for Configurações, renderiza o submenu
                                    if (isAdminMaster && item.path === '/manager/settings') {
                                        return (
                                            <React.Fragment key={item.path}>
                                                <DropdownMenuItem 
                                                    onClick={() => navigate(item.path)}
                                                    className="cursor-pointer hover:bg-yellow-500/10"
                                                >
                                                    {item.icon}
                                                    {item.label}
                                                </DropdownMenuItem>
                                                <DropdownMenuSeparator className="bg-yellow-500/20" />
                                                <DropdownMenuSub>
                                                    <DropdownMenuSubTrigger
                                                        className={`cursor-pointer hover:bg-yellow-500/10 text-yellow-500 ${isAdminSettingsPath ? 'bg-yellow-500/20' : ''}`}
                                                    >
                                                        <Settings className="mr-2 h-4 w-4" />
                                                        Configurações Admin
                                                    </DropdownMenuSubTrigger>
                                                    <DropdownMenuSubContent side="right" align="start" className="w-56 bg-black/90 border border-yellow-500/30 text-white">
                                                        <DropdownMenuLabel className="text-yellow-500">Gerenciamento Avançado</DropdownMenuLabel>
                                                        <DropdownMenuSeparator className="bg-yellow-500/20" />
                                                        <DropdownMenuItem 
                                                            onClick={() => navigate('/admin/settings/carousel')}
                                                            className={`cursor-pointer hover:bg-yellow-500/10 ${location.pathname === '/admin/settings/carousel' ? 'bg-yellow-500/20 text-yellow-500' : ''}`}
                                                        >
                                                            <SlidersHorizontal className="mr-2 h-4 w-4" />
                                                            Config. Carrossel
                                                        </DropdownMenuItem>
                                                        <DropdownMenuItem 
                                                            onClick={() => navigate('/admin/settings/commission-tiers')}
                                                            className={`cursor-pointer hover:bg-yellow-500/10 ${location.pathname === '/admin/settings/commission-tiers' ? 'bg-yellow-500/20 text-yellow-500' : ''}`}
                                                        >
                                                            <Percent className="mr-2 h-4 w-4" />
                                                            Faixas de Comissão
                                                        </DropdownMenuItem>
                                                        <DropdownMenuItem 
                                                            onClick={() => navigate('/admin/settings/contracts')}
                                                            className={`cursor-pointer hover:bg-yellow-500/10 ${location.pathname === '/admin/settings/contracts' ? 'bg-yellow-500/20 text-yellow-500' : ''}`}
                                                        >
                                                            <FileText className="mr-2 h-4 w-4" />
                                                            Contratos
                                                        </DropdownMenuItem>
                                                        <DropdownMenuItem 
                                                            onClick={() => navigate('/admin/banners')}
                                                            className={`cursor-pointer hover:bg-yellow-500/10 ${location.pathname === '/admin/banners' ? 'bg-yellow-500/20 text-yellow-500' : ''}`}
                                                        >
                                                            <ListOrdered className="mr-2 h-4 w-4" />
                                                            Listar Banners
                                                        </DropdownMenuItem>
                                                        <DropdownMenuItem 
                                                            onClick={() => navigate('/admin/banners/create')}
                                                            className={`cursor-pointer hover:bg-yellow-500/10 ${location.pathname === '/admin/banners/create' ? 'bg-yellow-500/20 text-yellow-500' : ''}`}
                                                        >
                                                            <Image className="mr-2 h-4 w-4" />
                                                            Criar Banner Promo
                                                        </DropdownMenuItem>
                                                        <DropdownMenuSeparator className="bg-yellow-500/20" />
                                                        <DropdownMenuItem 
                                                            onClick={() => navigate('/manager/settings/advanced')}
                                                            className={`cursor-pointer hover:bg-yellow-500/10 ${location.pathname === '/manager/settings/advanced' ? 'bg-yellow-500/20 text-yellow-500' : ''}`}
                                                        >
                                                            <Settings className="mr-2 h-4 w-4" />
                                                            Avançadas
                                                        </DropdownMenuItem>
                                                        <DropdownMenuItem 
                                                            onClick={() => navigate('/manager/settings/backup-database')}
                                                            className={`cursor-pointer hover:bg-yellow-500/10 ${location.pathname === '/manager/settings/backup-database' ? 'bg-yellow-500/20 text-yellow-500' : ''}`}
                                                        >
                                                            <Database className="mr-2 h-4 w-4" />
                                                            Backup do Banco
                                                        </DropdownMenuItem>
                                                        <DropdownMenuItem 
                                                            onClick={() => navigate('/manager/settings/history')}
                                                            className={`cursor-pointer hover:bg-yellow-500/10 ${location.pathname === '/manager/settings/history' ? 'bg-yellow-500/20 text-yellow-500' : ''}`}
                                                        >
                                                            <History className="mr-2 h-4 w-4" />
                                                            Histórico
                                                        </DropdownMenuItem>
                                                    </DropdownMenuSubContent>
                                                </DropdownMenuSub>
                                                <DropdownMenuSeparator className="bg-yellow-500/20" />
                                            </React.Fragment>
                                        );
                                    }
                                    
                                    // Renderiza itens normais
                                    return (
                                        <DropdownMenuItem 
                                            key={item.path}
                                            onClick={() => navigate(item.path)}
                                            className={`cursor-pointer hover:bg-yellow-500/10 ${location.pathname === item.path ? 'bg-yellow-500/20 text-yellow-500' : ''}`}
                                        >
                                            {item.icon}
                                            {item.label}
                                        </DropdownMenuItem>
                                    );
                                })}
                                
                                <DropdownMenuSeparator className="bg-yellow-500/20" />
                                <DropdownMenuItem 
                                    onClick={() => void handleLogout()}
                                    className="cursor-pointer hover:bg-red-500/10 text-red-400"
                                >
                                    <LogOut className="mr-2 h-4 w-4" />
                                    Sair
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>

                        {/* Mobile Menu Trigger */}
                        <Sheet open={isMobileMenuOpen} onOpenChange={setIsMobileMenuOpen}>
                            <SheetTrigger asChild>
                                <Button variant="ghost" size="icon" className="md:hidden text-yellow-500 hover:bg-yellow-500/10">
                                    <Menu className="h-6 w-6" />
                                </Button>
                            </SheetTrigger>
                            <SheetContent side="right" className="flex h-full max-h-[100dvh] w-[250px] flex-col overflow-hidden bg-black/95 border-l border-yellow-500/30 p-0 text-white">
                                <SheetHeader className="shrink-0 border-b border-yellow-500/20 p-4">
                                    <SheetTitle className="text-2xl font-serif text-yellow-500">EventoFest {dashboardTitle}</SheetTitle>
                                </SheetHeader>
                                <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-4 [-webkit-overflow-scrolling:touch]">
                                    <div className="flex items-center space-x-3 p-3 bg-yellow-500/10 rounded-xl border border-yellow-500/20">
                                        <div className="w-10 h-10 bg-yellow-500 rounded-full flex items-center justify-center text-black font-bold">
                                            <Crown className="h-5 w-5" />
                                        </div>
                                        <div>
                                            <div className="text-white font-semibold">{userName}</div>
                                            <div className="text-gray-400 text-sm">{userRoleDisplay}</div>
                                        </div>
                                    </div>
                                    {/* Reutilizando allNavItems para o menu mobile */}
                                    <nav className="flex flex-col space-y-2">
                                        {allNavItems.map(item => {
                                            // Se for Admin Master, e o item for Configurações, renderiza o submenu
                                            if (isAdminMaster && item.path === '/manager/settings') {
                                                return (
                                                    <div key={item.path} className="space-y-2">
                                                        <button 
                                                            onClick={() => navigate(item.path)}
                                                            className="flex items-center p-3 rounded-xl text-white hover:bg-yellow-500/10 transition-colors duration-200 text-lg w-full justify-start"
                                                        >
                                                            {item.icon}
                                                            {item.label}
                                                        </button>
                                                        <div className="pl-6 space-y-1 border-l border-yellow-500/20 ml-3">
                                                            <button 
                                                                onClick={() => { navigate('/admin/settings/carousel'); setIsMobileMenuOpen(false); }}
                                                                className="flex items-center p-2 rounded-xl text-gray-300 hover:bg-yellow-500/10 transition-colors duration-200 text-base w-full justify-start"
                                                            >
                                                                <SlidersHorizontal className="mr-2 h-4 w-4" />
                                                                Config. Carrossel
                                                            </button>
                                                            <button 
                                                                onClick={() => { navigate('/admin/settings/commission-tiers'); setIsMobileMenuOpen(false); }}
                                                                className="flex items-center p-2 rounded-xl text-gray-300 hover:bg-yellow-500/10 transition-colors duration-200 text-base w-full justify-start"
                                                            >
                                                                <Percent className="mr-2 h-4 w-4" />
                                                                Faixas de Comissão
                                                            </button>
                                                            <button 
                                                                onClick={() => { navigate('/admin/settings/contracts'); setIsMobileMenuOpen(false); }}
                                                                className="flex items-center p-2 rounded-xl text-gray-300 hover:bg-yellow-500/10 transition-colors duration-200 text-base w-full justify-start"
                                                            >
                                                                <FileText className="mr-2 h-4 w-4" />
                                                                Contratos
                                                            </button>
                                                            <button 
                                                                onClick={() => { navigate('/admin/banners'); setIsMobileMenuOpen(false); }}
                                                                className="flex items-center p-2 rounded-xl text-gray-300 hover:bg-yellow-500/10 transition-colors duration-200 text-base w-full justify-start"
                                                            >
                                                                <ListOrdered className="mr-2 h-4 w-4" />
                                                                Listar Banners
                                                            </button>
                                                            <button 
                                                                onClick={() => { navigate('/admin/banners/create'); setIsMobileMenuOpen(false); }}
                                                                className="flex items-center p-2 rounded-xl text-gray-300 hover:bg-yellow-500/10 transition-colors duration-200 text-base w-full justify-start"
                                                            >
                                                                <Image className="mr-2 h-4 w-4" />
                                                                Criar Banner Promo
                                                            </button>
                                                            <button 
                                                                onClick={() => { navigate('/manager/settings/advanced'); setIsMobileMenuOpen(false); }}
                                                                className="flex items-center p-2 rounded-xl text-gray-300 hover:bg-yellow-500/10 transition-colors duration-200 text-base w-full justify-start"
                                                            >
                                                                <Settings className="mr-2 h-4 w-4" />
                                                                Avançadas
                                                            </button>
                                                            <button 
                                                                onClick={() => { navigate('/manager/settings/backup-database'); setIsMobileMenuOpen(false); }}
                                                                className="flex items-center p-2 rounded-xl text-gray-300 hover:bg-yellow-500/10 transition-colors duration-200 text-base w-full justify-start"
                                                            >
                                                                <Database className="mr-2 h-4 w-4" />
                                                                Backup do Banco
                                                            </button>
                                                            <button 
                                                                onClick={() => { navigate('/manager/settings/history'); setIsMobileMenuOpen(false); }}
                                                                className="flex items-center p-2 rounded-xl text-gray-300 hover:bg-yellow-500/10 transition-colors duration-200 text-base w-full justify-start"
                                                            >
                                                                <History className="mr-2 h-4 w-4" />
                                                                Histórico
                                                            </button>
                                                        </div>
                                                    </div>
                                                );
                                            }
                                            
                                            // Renderiza itens normais
                                            return (
                                                <button 
                                                    key={item.path}
                                                    onClick={() => { navigate(item.path); setIsMobileMenuOpen(false); }} 
                                                    className="flex items-center p-3 rounded-xl text-white hover:bg-yellow-500/10 transition-colors duration-200 text-lg w-full justify-start"
                                                >
                                                    {item.icon}
                                                    {item.label}
                                                </button>
                                            );
                                        })}
                                    </nav>
                                    <div className="border-t border-yellow-500/20 pt-4">
                                        <Button
                                            onClick={handleLogout}
                                            className="w-full justify-start bg-transparent border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 transition-all duration-300 cursor-pointer"
                                        >
                                            <LogOut className="mr-2 h-5 w-5" />
                                            Sair
                                        </Button>
                                    </div>
                                </div>
                            </SheetContent>
                        </Sheet>
                    </div>
                </div>
            </header>
            <main
                style={{ paddingTop: `${Math.max(headerHeight, 80)}px` }}
                className={isMobile ? 'p-3' : isTablet ? 'p-4' : 'p-6'}
            >
                <Outlet />
            </main>
        </div>
    );
};

export default ManagerLayout;