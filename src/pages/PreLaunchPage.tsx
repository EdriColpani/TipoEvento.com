import React, { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Loader2, Sparkles, Ticket, Shield, LayoutDashboard, Rocket, QrCode, Wallet, Store, BarChart3 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useDevice } from '@/hooks/use-device';
import { useLandingUi } from '@/contexts/LandingUiContext';
import LandingContactPanel from '@/components/landing/LandingContactPanel';
import LandingFooter from '@/components/landing/LandingFooter';
import {
    LANDING_ABOUT_CONTENT,
    LANDING_HOW_IT_WORKS,
    PRE_LAUNCH_BENEFITS,
    PRE_LAUNCH_HERO,
    PRE_LAUNCH_STATUS_MESSAGE,
    PRE_LAUNCH_MANAGER_INTRO,
    PRE_LAUNCH_MANAGER_PILLARS,
} from '@/constants/landing-content';
import { formatPhoneBR } from '@/utils/phone-format';
import { showError, showSuccess } from '@/utils/toast';
import { cn } from '@/lib/utils';

const BENEFIT_ICONS = [Ticket, LayoutDashboard, Shield, Sparkles] as const;
const MANAGER_PILLAR_ICONS = [QrCode, Wallet, Store, BarChart3] as const;

const PreLaunchPage: React.FC = () => {
    const { isMobile } = useDevice();
    const { openContact } = useLandingUi();
    const [contactPhone, setContactPhone] = useState('Não informado');
    const [contactCompanyName, setContactCompanyName] = useState('EventFest');
    const [contactName, setContactName] = useState('');
    const [contactFormPhone, setContactFormPhone] = useState('');
    const [contactMessage, setContactMessage] = useState('');
    const [sendingContact, setSendingContact] = useState(false);

    useEffect(() => {
        document.title = 'EventFest — Em breve';
        let meta = document.querySelector('meta[name="robots"]') as HTMLMetaElement | null;
        const created = !meta;
        if (!meta) {
            meta = document.createElement('meta');
            meta.setAttribute('name', 'robots');
            document.head.appendChild(meta);
        }
        const previous = meta.getAttribute('content');
        meta.setAttribute('content', 'noindex, nofollow');

        return () => {
            document.title = 'EventFest';
            if (created && meta?.parentNode) {
                meta.parentNode.removeChild(meta);
            } else if (meta) {
                if (previous) meta.setAttribute('content', previous);
                else meta.removeAttribute('content');
            }
        };
    }, []);

    useEffect(() => {
        supabase
            .rpc('get_public_contact_info')
            .then(({ data, error }) => {
                if (error) return;
                const payload = (data ?? {}) as { phone?: string | null; company_name?: string | null };
                setContactPhone(formatPhoneBR(payload.phone ?? null));
                if (payload.company_name) setContactCompanyName(payload.company_name);
            })
            .catch(() => {});
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
        setSendingContact(true);
        try {
            const { error } = await supabase.rpc('create_public_contact_message', {
                p_name: contactName.trim(),
                p_phone: contactFormPhone,
                p_message: contactMessage.trim(),
            });
            if (error) throw error;
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
        <div className="landing-ef-theme min-h-screen">
            <section id="home" className="relative overflow-hidden px-4 sm:px-6 pt-8 pb-16 sm:pb-24">
                <div className="absolute inset-0 bg-gradient-to-b from-cyan-500/10 via-transparent to-blue-600/5 pointer-events-none" />
                <div className="max-w-5xl mx-auto relative text-center">
                    <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/40 bg-cyan-400/10 px-4 py-1.5 text-xs sm:text-sm text-cyan-300 mb-6">
                        <Rocket className="h-4 w-4" />
                        {PRE_LAUNCH_HERO.badge}
                    </div>
                    <h1 className="text-3xl sm:text-5xl font-serif font-bold text-white mb-4 leading-tight">
                        {PRE_LAUNCH_HERO.title}
                    </h1>
                    <p className="text-gray-300 text-base sm:text-lg max-w-2xl mx-auto mb-8 leading-relaxed">
                        {PRE_LAUNCH_HERO.subtitle}
                    </p>
                    <Button
                        type="button"
                        onClick={() => {
                            openContact();
                            window.setTimeout(() => {
                                document.getElementById('contato')?.scrollIntoView({ behavior: 'smooth' });
                            }, 100);
                        }}
                        className="bg-gradient-to-r from-cyan-400 to-blue-500 text-black hover:from-cyan-300 hover:to-blue-400 px-8 py-6 text-base font-semibold"
                    >
                        Fale conosco
                    </Button>
                </div>
            </section>

            <section id="sobre" className="px-4 sm:px-6 py-12 sm:py-16 border-t border-cyan-400/10">
                <div className="max-w-4xl mx-auto">
                    <h2 className="text-2xl sm:text-3xl font-serif text-cyan-300 mb-6 text-center">Sobre a EventFest</h2>
                    <p className="text-gray-300 text-base sm:text-lg leading-relaxed whitespace-pre-line text-center">
                        {LANDING_ABOUT_CONTENT}
                    </p>
                </div>
            </section>

            <section id="solucao" className="px-4 sm:px-6 py-12 sm:py-16 bg-black/40 border-t border-cyan-400/10">
                <div className="max-w-6xl mx-auto">
                    <h2 className="text-2xl sm:text-3xl font-serif text-cyan-300 mb-3 text-center">O que vamos oferecer</h2>
                    <p className="text-gray-400 text-center mb-10 max-w-2xl mx-auto">
                        Uma solução completa para quem organiza, vende e participa de eventos ao vivo.
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                        {PRE_LAUNCH_BENEFITS.map((item, index) => {
                            const Icon = BENEFIT_ICONS[index] ?? Sparkles;
                            return (
                                <Card
                                    key={item.title}
                                    className="bg-black/70 border border-cyan-400/20 p-6 hover:border-cyan-400/40 transition-colors"
                                >
                                    <div className="flex items-start gap-4">
                                        <div className="shrink-0 w-11 h-11 rounded-xl bg-cyan-400/15 flex items-center justify-center">
                                            <Icon className="h-5 w-5 text-cyan-300" />
                                        </div>
                                        <div>
                                            <h3 className="text-white font-semibold mb-2">{item.title}</h3>
                                            <p className="text-gray-400 text-sm leading-relaxed">{item.body}</p>
                                        </div>
                                    </div>
                                </Card>
                            );
                        })}
                    </div>
                </div>
            </section>

            <section id="gestores" className="px-4 sm:px-6 py-12 sm:py-16 border-t border-cyan-400/10 bg-gradient-to-b from-cyan-500/5 to-transparent">
                <div className="max-w-5xl mx-auto">
                    <h2 className="text-2xl sm:text-3xl font-serif text-cyan-300 mb-4 text-center">
                        {PRE_LAUNCH_MANAGER_INTRO.title}
                    </h2>
                    <p className="text-gray-300 text-base sm:text-lg leading-relaxed text-center max-w-3xl mx-auto mb-4">
                        {PRE_LAUNCH_MANAGER_INTRO.problem}
                    </p>
                    <p className="text-cyan-200/90 text-sm sm:text-base text-center max-w-2xl mx-auto mb-10 font-medium">
                        {PRE_LAUNCH_MANAGER_INTRO.promise}
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                        {PRE_LAUNCH_MANAGER_PILLARS.map((item, index) => {
                            const Icon = MANAGER_PILLAR_ICONS[index] ?? Sparkles;
                            return (
                                <Card
                                    key={item.title}
                                    className="bg-black/70 border border-cyan-400/25 p-6 hover:border-cyan-400/45 transition-colors"
                                >
                                    <div className="flex items-start gap-4">
                                        <div className="shrink-0 w-11 h-11 rounded-xl bg-gradient-to-br from-cyan-400/20 to-blue-500/20 flex items-center justify-center">
                                            <Icon className="h-5 w-5 text-cyan-300" />
                                        </div>
                                        <div>
                                            <h3 className="text-white font-semibold mb-2">{item.title}</h3>
                                            <p className="text-gray-400 text-sm leading-relaxed">{item.body}</p>
                                        </div>
                                    </div>
                                </Card>
                            );
                        })}
                    </div>
                    <p className="text-center mt-8">
                        <Button
                            type="button"
                            onClick={() => {
                                openContact();
                                window.setTimeout(() => {
                                    document.getElementById('contato')?.scrollIntoView({ behavior: 'smooth' });
                                }, 100);
                            }}
                            className="bg-gradient-to-r from-cyan-400 to-blue-500 text-black hover:from-cyan-300 hover:to-blue-400 px-8 py-6 text-base font-semibold border-0"
                        >
                            Quero saber mais para meu evento
                        </Button>
                    </p>
                </div>
            </section>

            <section className="px-4 sm:px-6 py-12 sm:py-16 border-t border-cyan-400/10">
                <div className="max-w-4xl mx-auto">
                    <h2 className="text-2xl sm:text-3xl font-serif text-cyan-300 mb-8 text-center">Como vai funcionar</h2>
                    <div className="space-y-5">
                        {LANDING_HOW_IT_WORKS.map((step) => (
                            <div
                                key={step.title}
                                className="rounded-xl border border-cyan-400/15 bg-black/50 p-5 sm:p-6"
                            >
                                <h3 className="text-white font-semibold mb-2">{step.title}</h3>
                                <p className="text-gray-400 text-sm sm:text-base leading-relaxed">{step.body}</p>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            <section className="px-4 sm:px-6 py-10 border-t border-cyan-400/10">
                <div className="max-w-3xl mx-auto text-center rounded-2xl border border-cyan-400/25 bg-gradient-to-br from-cyan-500/10 to-blue-600/10 p-8">
                    <p className="text-gray-200 text-sm sm:text-base leading-relaxed">{PRE_LAUNCH_STATUS_MESSAGE}</p>
                </div>
            </section>

            <section id="contato" className={cn('px-4 sm:px-6 py-12 sm:py-16 border-t border-cyan-400/10', isMobile && 'scroll-mt-24')}>
                <div className="max-w-3xl mx-auto">
                    <h2 className="text-2xl sm:text-3xl font-serif text-cyan-300 mb-2 text-center">Contato</h2>
                    <p className="text-gray-400 text-center mb-8 text-sm sm:text-base">
                        Quer saber mais ou ser avisado do lançamento? Envie uma mensagem.
                    </p>
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
                </div>
            </section>

            <footer className="px-4 sm:px-6 py-12 border-t border-cyan-400/20">
                <div className="max-w-6xl mx-auto">
                    <LandingFooter isMobile={isMobile} />
                    <p className="text-center text-gray-500 text-xs sm:text-sm mt-8">
                        © {new Date().getFullYear()} EventFest. Todos os direitos reservados.
                    </p>
                </div>
            </footer>
        </div>
    );
};

export default PreLaunchPage;
