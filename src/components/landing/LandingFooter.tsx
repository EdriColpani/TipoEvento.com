import React from 'react';
import { cn } from '@/lib/utils';
import { useLandingUi } from '@/contexts/LandingUiContext';
import type { LandingModalId } from '@/contexts/LandingUiContext';
import LandingSocialLinks from '@/components/landing/LandingSocialLinks';

type FooterLink = {
    label: string;
    modal?: Exclude<LandingModalId, null>;
    action?: 'contact';
};

const USEFUL_LINKS: FooterLink[] = [
    { label: 'Sobre Nós', modal: 'about' },
    { label: 'Como Funciona', modal: 'how-it-works' },
    { label: 'Termos de Uso', modal: 'terms' },
    { label: 'Privacidade', modal: 'privacy' },
];

const SUPPORT_LINKS: FooterLink[] = [
    { label: 'Central de Ajuda', modal: 'help-center' },
    { label: 'Contato', action: 'contact' },
    { label: 'FAQ', modal: 'faq' },
    { label: 'Feedback', modal: 'feedback' },
];

type LandingFooterProps = {
    isMobile?: boolean;
};

const LandingFooter: React.FC<LandingFooterProps> = ({ isMobile }) => {
    const { openModal, openContact, contactOpen } = useLandingUi();

    const renderLink = (item: FooterLink) => (
        <li key={item.label}>
            <button
                type="button"
                onClick={() => {
                    if (item.action === 'contact') {
                        openContact();
                        return;
                    }
                    if (item.modal) openModal(item.modal);
                }}
                className={cn(
                    'text-gray-400 hover:text-yellow-500 transition-colors cursor-pointer text-left',
                    item.action === 'contact' && contactOpen && 'text-cyan-400',
                )}
            >
                {item.label}
            </button>
        </li>
    );

    return (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-10 sm:mb-12">
            <div className="col-span-2 md:col-span-1">
                <div className="text-xl sm:text-2xl font-serif text-yellow-500 font-bold mb-4">EventFest</div>
                <p className="text-gray-400 text-sm leading-relaxed">A plataforma que faz tudo acontecer.</p>
            </div>
            <div>
                <h4 className="text-white font-semibold mb-4 text-base sm:text-lg">Links Úteis</h4>
                <ul className="space-y-2 text-sm">{USEFUL_LINKS.map(renderLink)}</ul>
            </div>
            <div>
                <h4 className="text-white font-semibold mb-4 text-base sm:text-lg">Suporte</h4>
                <ul className="space-y-2 text-sm">{SUPPORT_LINKS.map(renderLink)}</ul>
            </div>
            <div className={cn(isMobile && 'col-span-2')}>
                <h4 className="text-white font-semibold mb-4 text-base sm:text-lg">Redes Sociais</h4>
                <LandingSocialLinks />
            </div>
        </div>
    );
};

export default LandingFooter;
