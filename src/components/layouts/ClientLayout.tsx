import React, { useEffect } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import AuthStatusMenu from '@/components/AuthStatusMenu';
import MobileMenu from '@/components/MobileMenu';
import ScrollToTop from '@/components/ScrollToTop';
import { useDevice } from '@/hooks/use-device';
import { LandingUiProvider, useLandingUi, useLandingUiOptional } from '@/contexts/LandingUiContext';
import LandingModals from '@/components/landing/LandingModals';
import SiteLogo from '@/components/SiteLogo';
import {
    SITE_HEADER_BAR_CLASS,
    SITE_HEADER_MAIN_OFFSET_CLASS,
    SITE_HEADER_NAV_LINK_CLASS,
} from '@/constants/branding';
import { usePublicSiteAuth } from '@/contexts/PublicLaunchModeContext';

const ClientLandingModalsHost: React.FC = () => {
    const { activeModal, closeModal } = useLandingUi();
    return <LandingModals activeModal={activeModal} onClose={closeModal} />;
};

const ClientLayoutNav: React.FC<{ isInformacoesPage: boolean }> = ({ isInformacoesPage }) => {
    const landingUi = useLandingUiOptional();
    const linkClass = `${SITE_HEADER_NAV_LINK_CLASS} text-white transition-colors duration-300 cursor-pointer ${
        isInformacoesPage ? 'hover:text-cyan-300' : 'hover:text-yellow-500'
    }`;

    const handleContatoClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
        if (!landingUi) return;
        e.preventDefault();
        landingUi.openContact();
        const contactId = isInformacoesPage ? 'contato' : 'contato';
        document.getElementById(contactId)?.scrollIntoView({ behavior: 'smooth' });
    };

    if (isInformacoesPage) {
        return (
            <>
                <a href="/informacoes#home" className={linkClass}>Início</a>
                <a href="/informacoes#sobre" className={linkClass}>Sobre</a>
                <a href="/informacoes#gestores" className={linkClass}>Gestores</a>
                <a href="/informacoes#solucao" className={linkClass}>Solução</a>
                <a
                    href="/informacoes#contato"
                    onClick={handleContatoClick}
                    className={`${linkClass} ${landingUi?.contactOpen ? 'text-cyan-400' : ''}`}
                    aria-expanded={landingUi?.contactOpen}
                >
                    Contato
                </a>
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
    const { isAuthenticated } = usePublicSiteAuth();
    const isInformacoesPage = location.pathname === '/informacoes';

    useEffect(() => {
        document.documentElement.setAttribute('data-device', device);
    }, [device]);

    const handleLogoClick = () => {
        navigate(isAuthenticated ? '/' : '/informacoes');
    };

    return (
        <div className={`min-h-screen bg-black text-white ${isMobile ? 'device-mobile' : `device-${device}`}`} data-device={device}>
            <header
                className={`fixed top-0 left-0 right-0 z-[100] bg-black/80 backdrop-blur-md border-b ${
                    isInformacoesPage ? 'border-cyan-400/30' : 'border-yellow-500/20'
                }`}
            >
                <div className={`max-w-7xl mx-auto flex items-center justify-between ${SITE_HEADER_BAR_CLASS}`}>
                    <div className="flex items-center space-x-4 sm:space-x-8">
                        <SiteLogo header onClick={handleLogoClick} />
                        <nav className="hidden md:flex items-center space-x-8">
                            <ClientLayoutNav isInformacoesPage={isInformacoesPage} />
                        </nav>
                    </div>
                    <div className="flex items-center space-x-3 sm:space-x-4">
                        <div className="hidden md:block">
                            <AuthStatusMenu />
                        </div>
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
