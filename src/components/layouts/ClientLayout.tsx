import React, { useEffect } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import AuthStatusMenu from '@/components/AuthStatusMenu';
import MobileMenu from '@/components/MobileMenu';
import ScrollToTop from '@/components/ScrollToTop';
import { useDevice } from '@/hooks/use-device';
import { LandingUiProvider, useLandingUi, useLandingUiOptional } from '@/contexts/LandingUiContext';
import LandingModals from '@/components/landing/LandingModals';
import SiteLogo from '@/components/SiteLogo';

const ClientLandingModalsHost: React.FC = () => {
    const { activeModal, closeModal } = useLandingUi();
    return <LandingModals activeModal={activeModal} onClose={closeModal} />;
};

import { usePublicLaunchMode } from '@/hooks/use-public-launch-mode';

const ClientLayoutNav: React.FC<{ isLandingPage: boolean; showPreLaunchNav: boolean }> = ({
    isLandingPage,
    showPreLaunchNav,
}) => {
    const landingUi = useLandingUiOptional();
    const linkClass = `text-white transition-colors duration-300 cursor-pointer ${
        isLandingPage ? 'hover:text-cyan-300' : 'hover:text-yellow-500'
    }`;

    const handleContatoClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
        if (!landingUi) return;
        e.preventDefault();
        landingUi.openContact();
        document.getElementById('contato')?.scrollIntoView({ behavior: 'smooth' });
    };

    if (showPreLaunchNav) {
        return (
            <>
                <a href="/#home" className={linkClass}>Início</a>
                <a href="/#sobre" className={linkClass}>Sobre</a>
                <a href="/#gestores" className={linkClass}>Gestores</a>
                <a href="/#solucao" className={linkClass}>Solução</a>
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
    const { showPreLaunchExperience } = usePublicLaunchMode();
    const isLandingPage = location.pathname === '/';
    const usePreLaunchNav = showPreLaunchExperience && isLandingPage;

    useEffect(() => {
        document.documentElement.setAttribute('data-device', device);
    }, [device]);

    return (
        <div className={`min-h-screen bg-black text-white ${isMobile ? 'device-mobile' : `device-${device}`}`} data-device={device}>
            <header
                className={`fixed top-0 left-0 right-0 z-[100] bg-black/80 backdrop-blur-md border-b ${
                    isLandingPage ? 'border-cyan-400/30' : 'border-yellow-500/20'
                }`}
            >
                <div className={`max-w-7xl mx-auto flex items-center justify-between ${isMobile ? 'px-3 py-3' : 'px-4 sm:px-6 py-4'}`}>
                    <div className="flex items-center space-x-4 sm:space-x-8">
                        <SiteLogo
                            className={isMobile ? 'h-[4.25rem] min-w-[10rem]' : 'h-24 min-w-[14rem]'}
                            onClick={() => navigate('/')}
                        />
                        <nav className="hidden md:flex items-center space-x-8">
                            <ClientLayoutNav isLandingPage={isLandingPage} showPreLaunchNav={usePreLaunchNav} />
                        </nav>
                    </div>
                    <div className="flex items-center space-x-3 sm:space-x-4">
                        {/* O campo de busca foi removido daqui e movido para Index.tsx */}
                        <div className="hidden md:block">
                            <AuthStatusMenu />
                        </div>
                        <MobileMenu />
                    </div>
                </div>
            </header>
            <main className={isMobile ? 'pt-[5.5rem]' : 'pt-28'}>
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