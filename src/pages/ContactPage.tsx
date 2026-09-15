import React, { useEffect, useState } from 'react';
import LandingContactPanel from '@/components/landing/LandingContactPanel';
import LandingFooter from '@/components/landing/LandingFooter';
import { useDevice } from '@/hooks/use-device';
import { usePublicSiteContact } from '@/hooks/use-public-site-contact';
import { callRpcPublicRest } from '@/utils/supabase-rest-rpc';
import { formatPhoneBR } from '@/utils/phone-format';
import { showError, showSuccess } from '@/utils/toast';

const PAGE_TITLE = 'Contato | EventFest';
const CANONICAL = 'https://www.eventfest.com.br/contato';

const ContactPage: React.FC = () => {
    const { isMobile } = useDevice();
    const { contact: publicContact } = usePublicSiteContact();
    const contactPhone = formatPhoneBR(publicContact.phone);
    const contactCompanyName = publicContact.company_name;

    const [contactName, setContactName] = useState('');
    const [contactFormPhone, setContactFormPhone] = useState('');
    const [contactMessage, setContactMessage] = useState('');
    const [sendingContact, setSendingContact] = useState(false);

    useEffect(() => {
        document.title = PAGE_TITLE;
        const desc = document.querySelector('meta[name="description"]');
        const prevDesc = desc?.getAttribute('content') ?? '';
        if (desc) {
            desc.setAttribute(
                'content',
                'Fale com o atendimento oficial do EventFest por telefone ou formulário.',
            );
        }
        let canonical = document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
        const createdCanonical = !canonical;
        if (!canonical) {
            canonical = document.createElement('link');
            canonical.rel = 'canonical';
            document.head.appendChild(canonical);
        }
        const prevCanonical = canonical.href;
        canonical.href = CANONICAL;

        return () => {
            document.title = 'EventFest';
            if (desc) desc.setAttribute('content', prevDesc);
            if (createdCanonical) canonical?.remove();
            else if (canonical) canonical.href = prevCanonical;
        };
    }, []);

    const handleSendContact = async () => {
        if (!contactName.trim()) {
            showError('Informe seu nome.');
            return;
        }
        if (contactFormPhone.replace(/\D/g, '').length < 10) {
            showError('Informe um telefone válido.');
            return;
        }
        if (!contactMessage.trim() || contactMessage.trim().length < 5) {
            showError('Escreva uma mensagem com pelo menos 5 caracteres.');
            return;
        }
        if (sendingContact) return;

        setSendingContact(true);
        try {
            await callRpcPublicRest('create_public_contact_message', {
                p_name: contactName.trim(),
                p_phone: contactFormPhone,
                p_message: contactMessage.trim(),
            });
            showSuccess('Mensagem enviada. Nossa equipe entrará em contato.');
            setContactName('');
            setContactFormPhone('');
            setContactMessage('');
        } catch (e: unknown) {
            showError(e instanceof Error ? e.message : 'Não foi possível enviar a mensagem.');
        } finally {
            setSendingContact(false);
        }
    };

    return (
        <div className="landing-ef-theme min-h-screen bg-black text-white">
            <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
                <h1 className="text-2xl sm:text-3xl font-serif text-yellow-500 mb-3">Contato</h1>
                <p className="text-gray-300 text-sm sm:text-base mb-8 max-w-2xl leading-relaxed">
                    Atendimento oficial EventFest. Use esta página para falar com nossa equipe por
                    telefone ou pelo formulário.
                </p>

                <section id="contato" aria-label="Formulário de contato">
                    <LandingContactPanel
                        contactPhone={contactPhone}
                        contactCompanyName={contactCompanyName}
                        contactName={contactName}
                        setContactName={setContactName}
                        contactFormPhone={contactFormPhone}
                        setContactFormPhone={setContactFormPhone}
                        contactMessage={contactMessage}
                        setContactMessage={setContactMessage}
                        sendingContact={sendingContact}
                        onSendContact={() => void handleSendContact()}
                        isMobile={isMobile}
                        defaultOpen
                    />
                </section>
            </div>

            <footer className="border-t border-yellow-500/20 px-4 sm:px-6 py-10">
                <div className="max-w-6xl mx-auto">
                    <LandingFooter isMobile={isMobile} />
                    <div className="border-t border-yellow-500/20 pt-6 text-center">
                        <p className="text-gray-400 text-sm">
                            © 2025 EventFest. Todos os direitos reservados.
                        </p>
                    </div>
                </div>
            </footer>
        </div>
    );
};

export default ContactPage;
