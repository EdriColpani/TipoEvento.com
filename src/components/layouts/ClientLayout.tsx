import React, { useEffect } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import AuthStatusMenu from '@/components/AuthStatusMenu';
import MobileMenu from '@/components/MobileMenu';
import ScrollToTop from '@/components/ScrollToTop';
import { useDevice } from '@/hooks/use-device';
import { LandingUiProvider, useLandingUi, useLandingUiOptional } from '@/contexts/LandingUiContext';
import LandingModals from '@/components/landing/LandingModals';
import SiteLogo from '@/components/SiteLogo';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
    SITE_HEADER_BAR_CLASS,
    SITE_HEADER_MAIN_OFFSET_CLASS,
    SITE_HEADER_NAV_LINK_CLASS,
} from '@/constants/branding';
import { MANAGER_TERMS_REGISTER_PATH } from '@/utils/promoter-registration-flow';

const ClientLandingModalsHost: React.FC = () => {
    const { activeModal, closeModal } = useLandingUi();
    return <LandingModals activeModal={activeModal} onClose={closeModal} />;
};

const ClientLayoutNav: React.FC<{ isInformacoesPage: boolean }> = ({ isInformacoesPage }) => {
    const navigate = useNavigate();
    const landingUi = useLandingUiOptional();
    const linkClass = `${SITE_HEADER_NAV_LINK_CLASS} text-white transition-colors duration-300 cursor-pointer hover:text-yellow-500`;

    const handleContatoClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
        if (!landingUi) return;
        e.preventDefault();
        landingUi.openContact();
        document.getElementById('contato')?.scrollIntoView({ behavior: 'smooth' });
    };

    if (isInformacoesPage) {
        return (
            <>
                <a href="/informacoes#home" className={linkClass}>Início</a>
                <a href="/informacoes#sobre" className={linkClass}>Sobre</a>
                <a href="/informacoes#solucao" className={linkClass}>Solução</a>
                <a href="/informacoes#gestores" className={linkClass}>Para gestores</a>
                <a
                    href="/informacoes#contato"
                    onClick={handleContatoClick}
                    className={`${linkClass} ${landingUi?.contactOpen ? 'text-yellow-400' : ''}`}
                    aria-expanded={landingUi?.contactOpen}
                >
                    Contato
                </a>
                <Button
                    type="button"
                    onClick={() => navigate(MANAGER_TERMS_REGISTER_PATH, { state: { from: '/informacoes' } })}
                    className="bg-yellow-500 text-black hover:bg-yellow-600 font-semibold ml-2"
                >
                    Cadastre-se
                </Button>
            </>
        );
    }

    return (
        <>
            <a href="/#home" className={linkClass}>Home</a>
            <a href="/#eventos" className={linkClass}>Eventos</a>
            <a href="/#categorias" className={linkClass}>Categorias</a>
            <a
                href="/#contato"
                onClick={handleContatoClick}
                className={`${linkClass} ${landingUi?.contactOpen ? 'text-cyan-400' : ''}`}
                aria-expanded={landingUi?.contactOpen}
            >
                Contato
            </a>
        </>
    );
};

const ClientLayout: React.FC = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const { device, isMobile } = useDevice();
    const isInformacoesPage = location.pathname === '/informacoes';
    const isEventDetailsPage = /^\/events\/[^/]+$/.test(location.pathname);

    useEffect(() => {
        document.documentElement.setAttribute('data-device', device);
    }, [device]);

    const handleLogoClick = () => {
        navigate('/');
    };

    return (
        <div className={`min-h-screen bg-black text-white ${isMobile ? 'device-mobile' : `device-${device}`}`} data-device={device}>
            <header
                className="fixed top-0 left-0 right-0 z-[100] bg-black/80 backdrop-blur-md border-b border-yellow-500/20"
            >
                <div className={`max-w-7xl mx-auto flex items-center justify-between ${SITE_HEADER_BAR_CLASS}`}>
                    <div className="flex items-center space-x-4 sm:space-x-8">
                        <SiteLogo header onClick={handleLogoClick} />
                        <nav className="hidden md:flex items-center space-x-8">
                            <ClientLayoutNav isInformacoesPage={isInformacoesPage} />
                        </nav>
                    </div>
                    <div className="flex items-center space-x-3 sm:space-x-4">
                        {isEventDetailsPage && (
                            <div className="relative hidden lg:block">
                                <Input
                                    type="search"
                                    placeholder="Buscar eventos..."
                                    className="bg-black/60 border-yellow-500/30 text-white placeholder-gray-500 focus:border-yellow-500 w-64 pl-4 pr-10 py-2 rounded-xl"
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') navigate('/#eventos');
                                    }}
                                />
                                <i className="fas fa-search absolute right-4 top-1/2 -translate-y-1/2 text-yellow-500/60 pointer-events-none"></i>
                            </div>
                        )}
                        <div className="hidden md:block">
                            <AuthStatusMenu />
                        </div>
                        {isEventDetailsPage && (
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => navigate('/')}
                                className="bg-black/60 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 hover:text-yellow-400 px-3 sm:px-4"
                            >
                                Voltar
                            </Button>
                        )}
                        <MobileMenu />
                    </div>
                </div>
            </header>
            <main className={SITE_HEADER_MAIN_OFFSET_CLASS}>
                <ScrollToTop />
                <LandingUiProvider>
                    <Outlet />
                    <ClientLandingModalsHost />
                </LandingUiProvider>
            </main>
        </div>
    );
};

export default ClientLayout;
