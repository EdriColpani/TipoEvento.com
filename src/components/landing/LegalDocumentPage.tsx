import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import LandingFooter from '@/components/landing/LandingFooter';
import { useDevice } from '@/hooks/use-device';

type LegalDocumentPageProps = {
    title: string;
    documentTitle: string;
    children: React.ReactNode;
};

/** Shell compartilhado para páginas legais públicas (Termos / Privacidade). */
const LegalDocumentPage: React.FC<LegalDocumentPageProps> = ({
    title,
    documentTitle,
    children,
}) => {
    const { isMobile } = useDevice();

    useEffect(() => {
        document.title = documentTitle;
        return () => {
            document.title = 'EventFest';
        };
    }, [documentTitle]);

    return (
        <div className="landing-ef-theme min-h-screen bg-black text-white">
            <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
                <div className="mb-6">
                    <Button
                        asChild
                        variant="outline"
                        className="bg-black/60 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 hover:text-yellow-400"
                    >
                        <Link to="/informacoes">
                            <ArrowLeft className="h-4 w-4 mr-2" />
                            Voltar
                        </Link>
                    </Button>
                </div>
                <h1 className="text-2xl sm:text-3xl font-serif text-cyan-400 mb-6">{title}</h1>
                <div className="text-gray-300 text-sm sm:text-base leading-relaxed">{children}</div>
            </div>
            <footer className="border-t border-cyan-400/20 px-4 sm:px-6 py-10 mt-8">
                <div className="max-w-6xl mx-auto">
                    <LandingFooter isMobile={isMobile} />
                </div>
            </footer>
        </div>
    );
};

export default LegalDocumentPage;
