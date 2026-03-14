import React from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { Input } from "@/components/ui/input";
import AuthStatusMenu from '@/components/AuthStatusMenu';
import MobileMenu from '@/components/MobileMenu';
import ScrollToTop from '@/components/ScrollToTop'; // Import ScrollToTop

const ClientLayout: React.FC = () => {
    const navigate = useNavigate();

    return (
        <div className="min-h-screen bg-black text-white">
            <header className="fixed top-0 left-0 right-0 z-[100] bg-black/80 backdrop-blur-md border-b border-yellow-500/20">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
                    <div className="flex items-center space-x-4 sm:space-x-8">
                        <div 
                            className="text-xl sm:text-2xl font-serif text-yellow-500 font-bold cursor-pointer" 
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
            <main className="pt-[45px]"> {/* Ajustado o padding-top para 45px */}
                <ScrollToTop />
                <Outlet />
            </main>
        </div>
    );
};

export default ClientLayout;