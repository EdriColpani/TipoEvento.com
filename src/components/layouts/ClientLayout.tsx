import React, { useEffect } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import AuthStatusMenu from '@/components/AuthStatusMenu';
import MobileMenu from '@/components/MobileMenu';
import ScrollToTop from '@/components/ScrollToTop';
import { useDevice } from '@/hooks/use-device';

const ClientLayout: React.FC = () => {
    const navigate = useNavigate();
    const { device, isMobile } = useDevice();

    useEffect(() => {
        document.documentElement.setAttribute('data-device', device);
    }, [device]);

    return (
        <div className={`min-h-screen bg-black text-white ${isMobile ? 'device-mobile' : `device-${device}`}`} data-device={device}>
            <header className="fixed top-0 left-0 right-0 z-[100] bg-black/80 backdrop-blur-md border-b border-yellow-500/20">
                <div className={`max-w-7xl mx-auto flex items-center justify-between ${isMobile ? 'px-3 py-3' : 'px-4 sm:px-6 py-4'}`}>
                    <div className="flex items-center space-x-4 sm:space-x-8">
                        <div 
                            className={`font-serif text-yellow-500 font-bold cursor-pointer ${isMobile ? 'text-lg' : 'text-xl sm:text-2xl'}`}
                            onClick={() => navigate('/')}
                        >
                            EventoFest
                        </div>
                        <nav className="hidden md:flex items-center space-x-8">
                            <a href="/#home" className="text-white hover:text-yellow-500 transition-colors duration-300 cursor-pointer">Home</a>
                            <a href="/#eventos" className="text-white hover:text-yellow-500 transition-colors duration-300 cursor-pointer">Eventos</a>
                            <a href="/#categorias" className="text-white hover:text-yellow-500 transition-colors duration-300 cursor-pointer">Categorias</a>
                            <a href="/#contato" className="text-white hover:text-yellow-500 transition-colors duration-300 cursor-pointer">Contato</a>
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
            <main className={isMobile ? 'pt-[44px]' : 'pt-[45px]'}>
                <ScrollToTop />
                <Outlet />
            </main>
        </div>
    );
};

export default ClientLayout;