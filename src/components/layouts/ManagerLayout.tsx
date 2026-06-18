import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate, useLocation, Outlet } from 'react-router-dom';
import { Button } from "@/components/ui/button";
import { Menu, X, Loader2, LayoutDashboard, LogOut, User, Settings, QrCode, BarChart3, CalendarDays, ChevronDown, SlidersHorizontal, Plus, Image, ListOrdered, History, CreditCard, Tags, FileText, Key, Database, Building2, Receipt, Shield, Mail, MapPin, Activity } from 'lucide-react';
import PlanFeatureRouteGuard from '@/components/PlanFeatureRouteGuard';
import { useCompanyPlanFeatures } from '@/hooks/use-company-plan-features';
import {
    filterNavItemsByPlanFeatures,
    isNavPathLockedByPlan,
    isRouteBlockedByPlan,
    MANAGER_NAV_ITEMS,
} from '@/constants/plan-features';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger } from "@/components/ui/dropdown-menu";
import { supabase } from '@/integrations/supabase/client';
import { useProfile } from '@/hooks/use-profile';
import { useUserType } from '@/hooks/use-user-type';
import { useProfileStatus } from '@/hooks/use-profile-status';
import NotificationBell from '@/components/NotificationBell';
import { showError, showSuccess } from '@/utils/toast';
import { LOGIN_PATH } from '@/utils/auth-routes';
import { useManagerCompany } from '@/hooks/use-manager-company';
import { useCompanyBilling } from '@/hooks/use-company-billing';
import { useDevice } from '@/hooks/use-device';
import { isCompanyBillingReady } from '@/constants/billing-plans';
import {
    isManagerNavItemLocked,
    isManagerPathAllowedWithoutBilling,
    MANAGER_BILLING_SETUP_PATH,
    requiresManagerCompanyBillingAcceptance,
} from '@/constants/manager-billing-gate';
import {
    isManagerPathAllowedWhenListingPastDue,
    listingSubscriptionBlocksOperations,
    MANAGER_LISTING_RENEWAL_PATH,
} from '@/constants/listing-subscription';
import {
    consumptionLicenseBlocksOperations,
    isManagerPathAllowedWhenConsumptionLicenseUnpaid,
    MANAGER_CONSUMPTION_LICENSE_PATH,
} from '@/constants/consumption-license';
import { useListingSubscription } from '@/hooks/use-listing-subscription';
import { useConsumptionLicenseStatus } from '@/hooks/use-consumption-license-status';
import { companyAllowsCreditConsumption, isConsumptionOrLicensePlan, isListingMonthlyPlan } from '@/utils/company-billing-rules';
import ListingSubscriptionBanner from '@/components/ListingSubscriptionBanner';
import ConsumptionLicenseBanner from '@/components/ConsumptionLicenseBanner';

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
               location.pathname.startsWith('/admin/settings/companies-billing') ||
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
    const { hasPendingNotifications, loading: isLoadingNotificationStatus } = useProfileStatus(
        profile,
        isLoadingProfile,
    );
    const { userTypeName: baseUserTypeName, isLoadingUserType } = useUserType(profile?.tipo_usuario_id);
    
    const isManagerPro = profile?.tipo_usuario_id === MANAGER_USER_TYPE_ID;
    const { company, isLoading: isLoadingCompany } = useManagerCompany(isManagerPro ? userId : undefined);
    const isAdminMaster = profile?.tipo_usuario_id === ADMIN_USER_TYPE_ID;
    const needsBillingGateCheck = isManagerPro && !isAdminMaster && !!company?.id;
    const { billing, isLoading: isLoadingBilling } = useCompanyBilling(
        needsBillingGateCheck ? company!.id : undefined,
    );
    const billingLoaded = !needsBillingGateCheck || !isLoadingBilling;
    const requiresContractAcceptance = requiresManagerCompanyBillingAcceptance(
        isManagerPro,
        isAdminMaster,
        company?.id,
        billing,
        billingLoaded,
    );
    const billingReady = isCompanyBillingReady(billing);
    const needsPlanFeatureCheck =
        isManagerPro && !isAdminMaster && !!company?.id && !requiresContractAcceptance;
    const { features: planFeatures, isLoading: isLoadingPlanFeatures } = useCompanyPlanFeatures(
        company?.id,
        { isAdminMaster, enabled: needsPlanFeatureCheck },
    );
    const billingGateToastShown = useRef(false);
    const planFeatureRedirectShown = useRef(false);
    const listingGateToastShown = useRef(false);
    const licenseGateToastShown = useRef(false);

    const isListingPlan = isListingMonthlyPlan(billing?.billing_plan ?? null);
    const isConsumptionLicensePlan = isConsumptionOrLicensePlan(billing?.billing_plan ?? null);
    const { data: listingSubscription, isLoading: isLoadingListingSubscription } = useListingSubscription(
        company?.id,
        billing?.billing_plan ?? null,
    );
    const listingPhase = listingSubscription?.phase ?? 'not_applicable';
    const listingPastDue = isListingPlan && listingSubscriptionBlocksOperations(listingPhase);

    const { data: consumptionLicenseStatus, isLoading: isLoadingConsumptionLicense } =
        useConsumptionLicenseStatus(company?.id, billing?.billing_plan ?? null);
    const licenseBlocksPanel = consumptionLicenseBlocksOperations(consumptionLicenseStatus);

    useEffect(() => {
        if (!billingLoaded || !requiresContractAcceptance) {
            billingGateToastShown.current = false;
            return;
        }
        if (isManagerPathAllowedWithoutBilling(location.pathname)) {
            return;
        }
        if (!billingGateToastShown.current) {
            billingGateToastShown.current = true;
            showError(
                'Confirme o plano e aceite o contrato da empresa na aba Plano e cobrança para acessar o painel do gestor.',
            );
        }
        navigate(MANAGER_BILLING_SETUP_PATH, { replace: true });
    }, [billingLoaded, requiresContractAcceptance, location.pathname, navigate]);

    useEffect(() => {
        if (!needsPlanFeatureCheck || isLoadingPlanFeatures) {
            planFeatureRedirectShown.current = false;
            return;
        }
        if (!isRouteBlockedByPlan(location.pathname, planFeatures, isAdminMaster, billingReady)) {
            planFeatureRedirectShown.current = false;
            return;
        }
        if (!planFeatureRedirectShown.current) {
            planFeatureRedirectShown.current = true;
            showError('Esta área não está disponível no plano comercial da sua empresa.');
        }
        navigate('/manager/dashboard', { replace: true });
    }, [
        needsPlanFeatureCheck,
        isLoadingPlanFeatures,
        location.pathname,
        planFeatures,
        isAdminMaster,
        billingReady,
        navigate,
    ]);

    useEffect(() => {
        if (
            isAdminMaster ||
            !isManagerPro ||
            !isConsumptionLicensePlan ||
            isLoadingConsumptionLicense ||
            !licenseBlocksPanel
        ) {
            licenseGateToastShown.current = false;
            return;
        }
        if (isManagerPathAllowedWhenConsumptionLicenseUnpaid(location.pathname)) {
            return;
        }
        if (!licenseGateToastShown.current) {
            licenseGateToastShown.current = true;
            showError(
                'Licença mensal pendente. Pague para liberar o painel (relatórios e pagamento continuam disponíveis).',
            );
        }
        navigate(MANAGER_CONSUMPTION_LICENSE_PATH, { replace: true });
    }, [
        isAdminMaster,
        isManagerPro,
        isConsumptionLicensePlan,
        isLoadingConsumptionLicense,
        licenseBlocksPanel,
        location.pathname,
        navigate,
    ]);

    const showListingBanner =
        isListingPlan &&
        !isAdminMaster &&
        listingSubscription &&
        listingPhase !== 'not_applicable' &&
        listingPhase !== 'active';

    const showConsumptionLicenseBanner =
        isConsumptionLicensePlan &&
        !isAdminMaster &&
        consumptionLicenseStatus &&
        licenseBlocksPanel;

    const subscriptionBannerOffset =
        showListingBanner || showConsumptionLicenseBanner ? 88 : 0;

    useEffect(() => {
        if (
            isAdminMaster ||
            !isManagerPro ||
            !isListingPlan ||
            isLoadingListingSubscription ||
            !listingPastDue
        ) {
            listingGateToastShown.current = false;
            return;
        }
        if (isManagerPathAllowedWhenListingPastDue(location.pathname)) {
            return;
        }
        if (!listingGateToastShown.current) {
            listingGateToastShown.current = true;
            showError(
                'Assinatura vencida. Renove a mensalidade para liberar o painel (relatórios e pagamento continuam disponíveis).',
            );
        }
        navigate(MANAGER_LISTING_RENEWAL_PATH, { replace: true });
    }, [
        isAdminMaster,
        isManagerPro,
        isListingPlan,
        isLoadingListingSubscription,
        listingPastDue,
        location.pathname,
        navigate,
    ]);

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
            navigate(LOGIN_PATH, { replace: true });
        }
    };

    // Show loading spinner while session or profile/company data is being fetched
    if (
        loadingSession ||
        isLoadingProfile ||
        isLoadingUserType ||
        (isManagerPro && isLoadingCompany) ||
        (needsBillingGateCheck && isLoadingBilling) ||
        (needsPlanFeatureCheck && isLoadingPlanFeatures) ||
        (isListingPlan && isLoadingListingSubscription) ||
        (isConsumptionLicensePlan && isLoadingConsumptionLicense)
    ) {
        return (
            <div className="min-h-screen bg-black text-white flex items-center justify-center">
                <Loader2 className="h-10 w-10 animate-spin text-yellow-500" />
            </div>
        );
    }

    // Redirect unauthenticated users to login after loading is complete
    if (!userId && !loadingSession) { // Ensure loadingSession is false before redirecting
        if (location.pathname.startsWith('/manager') || location.pathname.startsWith('/admin')) {
            navigate(LOGIN_PATH, {
                replace: true,
                state: { from: `${location.pathname}${location.search}` },
            });
            return null; // Prevent rendering anything else
        }
    }
    
    // Check if user is authorized (Admin or Manager)
    const userType = profile?.tipo_usuario_id;
    const isManager = userType === ADMIN_USER_TYPE_ID || userType === MANAGER_USER_TYPE_ID;

    if (!isManager) {
        // If the user is logged in but not a manager/admin (e.g., client type 3), redirect them
        if (location.pathname.startsWith('/manager') || location.pathname.startsWith('/admin')) {
            navigate('/');
            return null;
        }
    }
    
    const navIconByPath: Record<string, React.ReactNode> = {
        '/manager/dashboard': <LayoutDashboard className="mr-2 h-4 w-4" />,
        '/manager/events': <CalendarDays className="mr-2 h-4 w-4" />,
        '/manager/events/create': <Plus className="mr-2 h-4 w-4" />,
        '/manager/events/banners': <Image className="mr-2 h-4 w-4" />,
        '/manager/events/banners/create': <Plus className="mr-2 h-4 w-4" />,
        '/manager/wristbands': <QrCode className="mr-2 h-4 w-4" />,
        '/manager/validation-keys': <Key className="mr-2 h-4 w-4" />,
        '/manager/credit/pdv': <CreditCard className="mr-2 h-4 w-4" />,
        '/manager/reports': <BarChart3 className="mr-2 h-4 w-4" />,
        '/manager/settings': <Settings className="mr-2 h-4 w-4" />,
    };

    let filteredManagerNav = filterNavItemsByPlanFeatures(
        MANAGER_NAV_ITEMS,
        planFeatures,
        isAdminMaster,
        billingReady,
    );

    if (listingPastDue && !isAdminMaster) {
        filteredManagerNav = filteredManagerNav.filter((item) =>
            item.path.startsWith('/manager/reports'),
        );
    }

    if (licenseBlocksPanel && !isAdminMaster) {
        filteredManagerNav = filteredManagerNav.filter((item) =>
            item.path.startsWith('/manager/reports') ||
            item.path.startsWith('/manager/settings/company-profile'),
        );
    }

    const canShowCreditPdvNav = companyAllowsCreditConsumption(billing?.billing_plan ?? null);
    if (canShowCreditPdvNav) {
        const pdvItem = {
            path: '/manager/credit/pdv',
            label: 'PDV',
            featureKey: 'reports' as const,
        };
        const alreadyHasPdv = filteredManagerNav.some((item) => item.path === pdvItem.path);
        if (!alreadyHasPdv) {
            const validationIndex = filteredManagerNav.findIndex(
                (item) => item.path === '/manager/validation-keys',
            );
            const reportsIndex = filteredManagerNav.findIndex(
                (item) => item.path === '/manager/reports',
            );

            if (validationIndex >= 0) {
                filteredManagerNav.splice(validationIndex + 1, 0, pdvItem);
            } else if (reportsIndex >= 0) {
                filteredManagerNav.splice(reportsIndex, 0, pdvItem);
            } else {
                filteredManagerNav.push(pdvItem);
            }
        }
    }

    const baseNavItems = [
        { path: '/', label: 'Home', icon: <User className="mr-2 h-4 w-4" /> },
        ...filteredManagerNav.map((item) => ({
            path: item.path,
            label: item.label,
            icon: navIconByPath[item.path] ?? <Settings className="mr-2 h-4 w-4" />,
        })),
    ];

    let allNavItems = [...baseNavItems];

    // Adiciona links específicos do Admin Master
    if (isAdminMaster) {
        allNavItems.splice(1, 0, { path: '/admin/dashboard', label: 'Dashboard Admin', icon: <Shield className="mr-2 h-4 w-4" /> });
    }
    
    const handleNavClick = (path: string, closeMobile = false) => {
        if (isManagerNavItemLocked(path, requiresContractAcceptance)) {
            navigate(MANAGER_BILLING_SETUP_PATH);
            if (closeMobile) setIsMobileMenuOpen(false);
            return;
        }
        if (
            listingPastDue &&
            !isAdminMaster &&
            !isManagerPathAllowedWhenListingPastDue(path)
        ) {
            showError('Assinatura vencida. Renove em Mensalidade de divulgação.');
            navigate(MANAGER_LISTING_RENEWAL_PATH);
            if (closeMobile) setIsMobileMenuOpen(false);
            return;
        }
        if (
            licenseBlocksPanel &&
            !isAdminMaster &&
            !isManagerPathAllowedWhenConsumptionLicenseUnpaid(path)
        ) {
            showError('Licença mensal pendente. Pague em Licença mensal (consumo).');
            navigate(MANAGER_CONSUMPTION_LICENSE_PATH);
            if (closeMobile) setIsMobileMenuOpen(false);
            return;
        }
        if (isNavPathLockedByPlan(path, planFeatures, isAdminMaster, billingReady)) {
            showError('Esta opção não está disponível no plano comercial da sua empresa.');
            if (closeMobile) setIsMobileMenuOpen(false);
            return;
        }
        navigate(path);
        if (closeMobile) setIsMobileMenuOpen(false);
    };

    // FILTRAGEM: Remove o item cuja rota é a rota atual
    const navItems = allNavItems.filter(item => item.path !== location.pathname);
    
    const dashboardTitle = isAdminMaster && location.pathname.startsWith('/admin') ? 'ADMIN' : 'Gestor';
    
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
                            EventFest
                            <span className="ml-2 sm:ml-3 bg-gradient-to-r from-yellow-500 to-yellow-600 text-black px-2 sm:px-3 py-0.5 rounded-lg text-xs sm:text-sm font-bold">{dashboardTitle}</span>
                        </div>
                    </div>
                    <div className="flex items-center space-x-3 sm:space-x-4">
                        <NotificationBell
                            hasPendingNotifications={hasPendingNotifications}
                            loading={isLoadingProfile || isLoadingNotificationStatus}
                        />
                        
                        {/* Dropdown Menu para Gestor/Admin */}
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button
                                    variant="outline"
                                    className="hidden md:flex items-center bg-black/60 border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/30 hover:border-yellow-500 transition-all duration-300 cursor-pointer px-4 py-2 h-10"
                                >
                                    <User className="h-5 w-5 mr-2" />
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
                                                            onClick={() => navigate('/admin/settings/pricing')}
                                                            className={`cursor-pointer hover:bg-yellow-500/10 ${location.pathname.startsWith('/admin/settings/pricing') || location.pathname === '/admin/settings/commission-tiers' ? 'bg-yellow-500/20 text-yellow-500' : ''}`}
                                                        >
                                                            <Tags className="mr-2 h-4 w-4" />
                                                            Preços e comissões
                                                        </DropdownMenuItem>
                                                        <DropdownMenuItem 
                                                            onClick={() => navigate('/admin/settings/companies-billing')}
                                                            className={`cursor-pointer hover:bg-yellow-500/10 ${location.pathname === '/admin/settings/companies-billing' ? 'bg-yellow-500/20 text-yellow-500' : ''}`}
                                                        >
                                                            <Building2 className="mr-2 h-4 w-4" />
                                                            Planos das Empresas
                                                        </DropdownMenuItem>
                                                        <DropdownMenuItem 
                                                            onClick={() => navigate('/admin/settings/plan-features')}
                                                            className={`cursor-pointer hover:bg-yellow-500/10 ${location.pathname === '/admin/settings/plan-features' ? 'bg-yellow-500/20 text-yellow-500' : ''}`}
                                                        >
                                                            <Shield className="mr-2 h-4 w-4" />
                                                            Planos e permissões
                                                        </DropdownMenuItem>
                                                        <DropdownMenuItem 
                                                            onClick={() => navigate('/admin/settings/monthly-invoices')}
                                                            className={`cursor-pointer hover:bg-yellow-500/10 ${location.pathname === '/admin/settings/monthly-invoices' || location.pathname === '/admin/settings/listing-monthly-billing' ? 'bg-yellow-500/20 text-yellow-500' : ''}`}
                                                        >
                                                            <Receipt className="mr-2 h-4 w-4" />
                                                            Faturas mensais
                                                        </DropdownMenuItem>
                                                        <DropdownMenuItem 
                                                            onClick={() => navigate('/admin/settings/contracts')}
                                                            className={`cursor-pointer hover:bg-yellow-500/10 ${location.pathname === '/admin/settings/contracts' ? 'bg-yellow-500/20 text-yellow-500' : ''}`}
                                                        >
                                                            <FileText className="mr-2 h-4 w-4" />
                                                            Contratos
                                                        </DropdownMenuItem>
                                                        <DropdownMenuItem
                                                            onClick={() => navigate('/admin/settings/contact-messages')}
                                                            className={`cursor-pointer hover:bg-yellow-500/10 ${location.pathname === '/admin/settings/contact-messages' ? 'bg-yellow-500/20 text-yellow-500' : ''}`}
                                                        >
                                                            <Mail className="mr-2 h-4 w-4" />
                                                            Contato (landing)
                                                        </DropdownMenuItem>
                                                        <DropdownMenuItem
                                                            onClick={() => navigate('/admin/settings/event-geo-backfill')}
                                                            className={`cursor-pointer hover:bg-yellow-500/10 ${location.pathname === '/admin/settings/event-geo-backfill' ? 'bg-yellow-500/20 text-yellow-500' : ''}`}
                                                        >
                                                            <MapPin className="mr-2 h-4 w-4" />
                                                            Geocodificar eventos
                                                        </DropdownMenuItem>
                                                        <DropdownMenuItem
                                                            onClick={() => navigate('/admin/settings/checkout-observability')}
                                                            className={`cursor-pointer hover:bg-yellow-500/10 ${location.pathname === '/admin/settings/checkout-observability' ? 'bg-yellow-500/20 text-yellow-500' : ''}`}
                                                        >
                                                            <Activity className="mr-2 h-4 w-4" />
                                                            Observabilidade checkout
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
                                    const navLocked =
                                        isManagerNavItemLocked(item.path, requiresContractAcceptance) ||
                                        isNavPathLockedByPlan(item.path, planFeatures, isAdminMaster, billingReady);
                                    return (
                                        <DropdownMenuItem
                                            key={item.path}
                                            disabled={navLocked}
                                            onClick={() => handleNavClick(item.path)}
                                            className={`cursor-pointer hover:bg-yellow-500/10 ${location.pathname === item.path ? 'bg-yellow-500/20 text-yellow-500' : ''} ${navLocked ? 'opacity-40 cursor-not-allowed' : ''}`}
                                        >
                                            {item.icon}
                                            {item.label}
                                            {navLocked && item.path === '/manager/dashboard' ? (
                                                <span className="ml-auto text-[10px] text-gray-500">bloqueado</span>
                                            ) : null}
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
                                    <SheetTitle className="text-2xl font-serif text-yellow-500">EventFest {dashboardTitle}</SheetTitle>
                                </SheetHeader>
                                <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-4 [-webkit-overflow-scrolling:touch]">
                                    <div className="flex items-center space-x-3 p-3 bg-yellow-500/10 rounded-xl border border-yellow-500/20">
                                        <div className="w-10 h-10 bg-yellow-500 rounded-full flex items-center justify-center text-black font-bold">
                                            <User className="h-5 w-5" />
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
                                                                onClick={() => { navigate('/admin/settings/pricing'); setIsMobileMenuOpen(false); }}
                                                                className="flex items-center p-2 rounded-xl text-gray-300 hover:bg-yellow-500/10 transition-colors duration-200 text-base w-full justify-start"
                                                            >
                                                                <Tags className="mr-2 h-4 w-4" />
                                                                Preços e comissões
                                                            </button>
                                                            <button 
                                                                onClick={() => { navigate('/admin/settings/companies-billing'); setIsMobileMenuOpen(false); }}
                                                                className="flex items-center p-2 rounded-xl text-gray-300 hover:bg-yellow-500/10 transition-colors duration-200 text-base w-full justify-start"
                                                            >
                                                                <Building2 className="mr-2 h-4 w-4" />
                                                                Planos das Empresas
                                                            </button>
                                                            <button 
                                                                onClick={() => { navigate('/admin/settings/plan-features'); setIsMobileMenuOpen(false); }}
                                                                className="flex items-center p-2 rounded-xl text-gray-300 hover:bg-yellow-500/10 transition-colors duration-200 text-base w-full justify-start"
                                                            >
                                                                <Shield className="mr-2 h-4 w-4" />
                                                                Planos e permissões
                                                            </button>
                                                            <button 
                                                                onClick={() => { navigate('/admin/settings/monthly-invoices'); setIsMobileMenuOpen(false); }}
                                                                className="flex items-center p-2 rounded-xl text-gray-300 hover:bg-yellow-500/10 transition-colors duration-200 text-base w-full justify-start"
                                                            >
                                                                <Receipt className="mr-2 h-4 w-4" />
                                                                Faturas mensais
                                                            </button>
                                                            <button 
                                                                onClick={() => { navigate('/admin/settings/contracts'); setIsMobileMenuOpen(false); }}
                                                                className="flex items-center p-2 rounded-xl text-gray-300 hover:bg-yellow-500/10 transition-colors duration-200 text-base w-full justify-start"
                                                            >
                                                                <FileText className="mr-2 h-4 w-4" />
                                                                Contratos
                                                            </button>
                                                            <button
                                                                onClick={() => { navigate('/admin/settings/contact-messages'); setIsMobileMenuOpen(false); }}
                                                                className="flex items-center p-2 rounded-xl text-gray-300 hover:bg-yellow-500/10 transition-colors duration-200 text-base w-full justify-start"
                                                            >
                                                                <Mail className="mr-2 h-4 w-4" />
                                                                Contato (landing)
                                                            </button>
                                                            <button
                                                                onClick={() => { navigate('/admin/settings/event-geo-backfill'); setIsMobileMenuOpen(false); }}
                                                                className="flex items-center p-2 rounded-xl text-gray-300 hover:bg-yellow-500/10 transition-colors duration-200 text-base w-full justify-start"
                                                            >
                                                                <MapPin className="mr-2 h-4 w-4" />
                                                                Geocodificar eventos
                                                            </button>
                                                            <button
                                                                onClick={() => { navigate('/admin/settings/checkout-observability'); setIsMobileMenuOpen(false); }}
                                                                className="flex items-center p-2 rounded-xl text-gray-300 hover:bg-yellow-500/10 transition-colors duration-200 text-base w-full justify-start"
                                                            >
                                                                <Activity className="mr-2 h-4 w-4" />
                                                                Observabilidade checkout
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
                                            const navLocked =
                                                isManagerNavItemLocked(
                                                    item.path,
                                                    requiresContractAcceptance,
                                                ) ||
                                                isNavPathLockedByPlan(
                                                    item.path,
                                                    planFeatures,
                                                    isAdminMaster,
                                                    billingReady,
                                                );
                                            return (
                                                <button
                                                    key={item.path}
                                                    type="button"
                                                    disabled={navLocked}
                                                    onClick={() => handleNavClick(item.path, true)}
                                                    className={`flex items-center p-3 rounded-xl text-white transition-colors duration-200 text-lg w-full justify-start ${navLocked ? 'opacity-40 cursor-not-allowed' : 'hover:bg-yellow-500/10'}`}
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
            {showListingBanner && (
                <div
                    className="fixed left-0 right-0 z-[105]"
                    style={{ top: `${Math.max(headerHeight, 64)}px` }}
                >
                    <ListingSubscriptionBanner
                        phase={listingSubscription!.phase}
                        message={listingSubscription!.message}
                        listingActiveUntil={listingSubscription!.listing_active_until}
                    />
                </div>
            )}
            {showConsumptionLicenseBanner && (
                <div
                    className="fixed left-0 right-0 z-[105]"
                    style={{ top: `${Math.max(headerHeight, 64)}px` }}
                >
                    <ConsumptionLicenseBanner status={consumptionLicenseStatus!} />
                </div>
            )}
            <main
                style={{
                    paddingTop: `${Math.max(headerHeight, 80) + subscriptionBannerOffset}px`,
                }}
                className={isMobile ? 'p-3' : isTablet ? 'p-4' : 'p-6'}
            >
                {requiresContractAcceptance &&
                    isManagerPathAllowedWithoutBilling(location.pathname) && (
                        <div className="max-w-7xl mx-auto mb-4 flex gap-3 p-4 rounded-xl border border-amber-500/40 bg-amber-500/10 text-amber-200 text-sm">
                            <span className="shrink-0 text-amber-400" aria-hidden>
                                ⚠
                            </span>
                            <p>
                                Para liberar o <strong>Dashboard</strong> e o restante do menu, confirme o
                                plano e aceite o contrato na aba <strong>Plano e cobrança</strong> abaixo.
                            </p>
                        </div>
                    )}
                <PlanFeatureRouteGuard>
                    <Outlet />
                </PlanFeatureRouteGuard>
            </main>
        </div>
    );
};

export default ManagerLayout;