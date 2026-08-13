import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    AlertTriangle,
    CheckCircle2,
    LayoutDashboard,
    QrCode,
    Rocket,
    Shield,
    Store,
    Ticket,
    Wallet,
    BarChart3,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { showError, showSuccess } from '@/utils/toast';
import { callRpcPublicRest } from '@/utils/supabase-rest-rpc';
import { cn } from '@/lib/utils';
import { useDevice } from '@/hooks/use-device';
import { useLandingUi } from '@/contexts/LandingUiContext';
import LandingContactPanel from '@/components/landing/LandingContactPanel';
import LandingFooter from '@/components/landing/LandingFooter';
import ManagerSalesRegisterButton from '@/components/landing/ManagerSalesRegisterButton';
import {
    MANAGER_SALES_BRIDGE,
    MANAGER_SALES_FINAL,
    MANAGER_SALES_HERO,
    MANAGER_SALES_OBJECTIONS,
    MANAGER_SALES_OUTCOMES,
    MANAGER_SALES_PAINS,
    MANAGER_SALES_PROOF,
    MANAGER_SALES_STEPS,
} from '@/constants/landing-content';
import { usePublicSiteContact } from '@/hooks/use-public-site-contact';
import { formatPhoneBR } from '@/utils/phone-format';
import { MANAGER_TERMS_REGISTER_PATH } from '@/utils/promoter-registration-flow';

const OUTCOME_ICONS = [Ticket, QrCode, Wallet, BarChart3] as const;
const OUTLINE_BTN =
    'bg-black/60 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 hover:text-yellow-400';

const InformacoesPage: React.FC = () => {
    const navigate = useNavigate();
    const { isMobile } = useDevice();
    const { openContact } = useLandingUi();
    const { contact: publicContact } = usePublicSiteContact();
    const contactPhone = formatPhoneBR(publicContact.phone);
    const contactCompanyName = publicContact.company_name;
    const [contactName, setContactName] = useState('');
    const [contactFormPhone, setContactFormPhone] = useState('');
    const [contactMessage, setContactMessage] = useState('');
    const [sendingContact, setSendingContact] = useState(false);

    useEffect(() => {
        document.title = 'Seja gestor EventFest | Operação completa de eventos';
        return () => {
            document.title = 'EventFest';
        };
    }, []);

    const goRegister = () => {
        navigate(MANAGER_TERMS_REGISTER_PATH, { state: { from: '/informacoes' } });
    };

    const scrollTo = (id: string) => {
        document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
    };

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
        <div className="min-h-screen bg-black text-white">
            <section id="home" className="relative overflow-hidden px-4 sm:px-6 pt-10 pb-16 sm:pb-20">
                <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(234,179,8,0.18),_transparent_55%)] pointer-events-none" />
                <div className="absolute inset-0 bg-gradient-to-b from-yellow-500/5 via-transparent to-black pointer-events-none" />
                <div className="max-w-4xl mx-auto relative text-center">
                    <div className="inline-flex items-center gap-2 rounded-full border border-yellow-500/40 bg-yellow-500/10 px-4 py-1.5 text-xs sm:text-sm text-yellow-400 mb-6">
                        <Rocket className="h-4 w-4" />
                        {MANAGER_SALES_HERO.badge}
                    </div>
                    <p className="text-yellow-500 font-serif text-2xl sm:text-3xl font-bold tracking-tight mb-3">
                        EventFest
                    </p>
                    <h1 className="text-3xl sm:text-5xl font-serif font-bold text-white mb-5 leading-tight">
                        {MANAGER_SALES_HERO.title}
                    </h1>
                    <p className="text-gray-300 text-base sm:text-lg max-w-2xl mx-auto mb-8 leading-relaxed">
                        {MANAGER_SALES_HERO.subtitle}
                    </p>
                    <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
                        <ManagerSalesRegisterButton label={MANAGER_SALES_HERO.primaryCta} onClick={goRegister} />
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => scrollTo('solucao')}
                            className={`${OUTLINE_BTN} px-8 py-6 text-base`}
                        >
                            {MANAGER_SALES_HERO.secondaryCta}
                        </Button>
                    </div>
                    <p className="mt-5 text-xs text-gray-500">
                        Cadastro de gestor / empresa · sem compromisso de volume mínimo para começar
                    </p>
                </div>
            </section>

            <section id="sobre" className="px-4 sm:px-6 py-12 sm:py-16 border-t border-yellow-500/15">
                <div className="max-w-5xl mx-auto">
                    <h2 className="text-2xl sm:text-3xl font-serif text-yellow-500 mb-3 text-center">
                        Você se reconhece em um destes cenários?
                    </h2>
                    <p className="text-gray-400 text-center mb-10 max-w-2xl mx-auto text-sm sm:text-base">
                        A maioria dos gestores perde dinheiro e reputação nos mesmos pontos — antes mesmo do show começar.
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-10">
                        {MANAGER_SALES_PAINS.map((item) => (
                            <Card key={item.title} className="bg-black/70 border border-amber-500/30 p-6">
                                <div className="flex items-start gap-3">
                                    <AlertTriangle className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
                                    <div>
                                        <h3 className="text-white font-semibold mb-2">{item.title}</h3>
                                        <p className="text-gray-400 text-sm leading-relaxed">{item.body}</p>
                                    </div>
                                </div>
                            </Card>
                        ))}
                    </div>
                    <p className="text-gray-300 text-center text-sm sm:text-base leading-relaxed max-w-3xl mx-auto">
                        {MANAGER_SALES_BRIDGE}
                    </p>
                </div>
            </section>

            <section id="solucao" className="px-4 sm:px-6 py-12 sm:py-16 bg-black/50 border-t border-yellow-500/15">
                <div className="max-w-6xl mx-auto">
                    <h2 className="text-2xl sm:text-3xl font-serif text-yellow-500 mb-3 text-center">
                        A solução completa que o gestor precisa
                    </h2>
                    <p className="text-gray-400 text-center mb-10 max-w-2xl mx-auto">
                        Não é só “vender ingresso”. É conduzir o evento do anúncio à última cerveja no bar — com controle.
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                        {MANAGER_SALES_OUTCOMES.map((item, index) => {
                            const Icon = OUTCOME_ICONS[index] ?? Ticket;
                            return (
                                <Card
                                    key={item.title}
                                    className="bg-black border border-yellow-500/25 p-6 hover:border-yellow-500/50 transition-colors"
                                >
                                    <div className="flex items-start gap-4">
                                        <div className="shrink-0 w-11 h-11 rounded-xl bg-yellow-500/15 flex items-center justify-center">
                                            <Icon className="h-5 w-5 text-yellow-500" />
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

            <section id="gestores" className="px-4 sm:px-6 py-12 sm:py-16 border-t border-yellow-500/15">
                <div className="max-w-4xl mx-auto">
                    <div className="flex items-center justify-center gap-2 mb-3">
                        <Shield className="h-5 w-5 text-yellow-500" />
                        <h2 className="text-2xl sm:text-3xl font-serif text-yellow-500 text-center">
                            Tudo que um gestor sério exige — no mesmo lugar
                        </h2>
                    </div>
                    <p className="text-gray-400 text-center mb-8 text-sm sm:text-base">
                        Menos ferramentas soltas. Mais operação fechada.
                    </p>
                    <ul className="space-y-3 mb-10">
                        {MANAGER_SALES_PROOF.map((line) => (
                            <li
                                key={line}
                                className="flex items-start gap-3 rounded-xl border border-yellow-500/20 bg-black/60 px-4 py-3"
                            >
                                <CheckCircle2 className="h-5 w-5 text-yellow-500 shrink-0 mt-0.5" />
                                <span className="text-gray-200 text-sm sm:text-base">{line}</span>
                            </li>
                        ))}
                    </ul>
                    <div className="text-center">
                        <ManagerSalesRegisterButton
                            label="Quero essa operação no meu evento"
                            onClick={goRegister}
                        />
                    </div>
                </div>
            </section>

            <section className="px-4 sm:px-6 py-12 sm:py-16 bg-gradient-to-b from-yellow-500/5 to-transparent border-t border-yellow-500/15">
                <div className="max-w-4xl mx-auto">
                    <h2 className="text-2xl sm:text-3xl font-serif text-yellow-500 mb-8 text-center">
                        Como começar em 3 passos
                    </h2>
                    <div className="space-y-4 mb-10">
                        {MANAGER_SALES_STEPS.map((step) => (
                            <div
                                key={step.title}
                                className="rounded-xl border border-yellow-500/20 bg-black/60 p-5 sm:p-6"
                            >
                                <h3 className="text-white font-semibold mb-2 flex items-center gap-2">
                                    <LayoutDashboard className="h-4 w-4 text-yellow-500" />
                                    {step.title}
                                </h3>
                                <p className="text-gray-400 text-sm sm:text-base leading-relaxed">{step.body}</p>
                            </div>
                        ))}
                    </div>
                    <div className="text-center">
                        <ManagerSalesRegisterButton
                            label="Começar cadastro de gestor / empresa"
                            onClick={goRegister}
                        />
                    </div>
                </div>
            </section>

            <section className="px-4 sm:px-6 py-12 sm:py-16 border-t border-yellow-500/15">
                <div className="max-w-3xl mx-auto">
                    <h2 className="text-2xl sm:text-3xl font-serif text-yellow-500 mb-8 text-center">
                        Dúvidas que travam a decisão
                    </h2>
                    <div className="space-y-4">
                        {MANAGER_SALES_OBJECTIONS.map((item) => (
                            <div
                                key={item.question}
                                className="rounded-xl border border-yellow-500/20 bg-black/50 p-5"
                            >
                                <h3 className="text-white font-semibold mb-2">{item.question}</h3>
                                <p className="text-gray-400 text-sm leading-relaxed">{item.answer}</p>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            <section className="px-4 sm:px-6 py-12 border-t border-yellow-500/15">
                <div className="max-w-3xl mx-auto text-center rounded-2xl border-2 border-yellow-500/50 bg-gradient-to-br from-yellow-500/15 to-black p-8 sm:p-10 shadow-lg shadow-yellow-500/10">
                    <Store className="h-8 w-8 text-yellow-500 mx-auto mb-4" />
                    <h2 className="text-xl sm:text-2xl font-serif text-white mb-3">{MANAGER_SALES_FINAL.title}</h2>
                    <p className="text-gray-300 text-sm sm:text-base leading-relaxed mb-6">
                        {MANAGER_SALES_FINAL.body}
                    </p>
                    <ManagerSalesRegisterButton label={MANAGER_SALES_FINAL.cta} onClick={goRegister} />
                    <p className="mt-4 text-xs text-gray-500">
                        Já tem conta?{' '}
                        <button
                            type="button"
                            className="text-yellow-500 hover:text-yellow-400 underline-offset-2 hover:underline"
                            onClick={() => navigate('/login', { state: { from: MANAGER_TERMS_REGISTER_PATH } })}
                        >
                            Faça login
                        </button>
                    </p>
                </div>
            </section>

            <section
                id="contato"
                className={cn('px-4 sm:px-6 py-12 sm:py-16 border-t border-yellow-500/15', isMobile && 'scroll-mt-24')}
            >
                <div className="max-w-3xl mx-auto">
                    <h2 className="text-2xl sm:text-3xl font-serif text-yellow-500 mb-2 text-center">
                        Ainda com dúvidas?
                    </h2>
                    <p className="text-gray-400 text-center mb-8 text-sm sm:text-base">
                        Fale com a equipe EventFest. Preferimos tirar a dúvida agora do que você perder o próximo evento.
                    </p>
                    <div className="flex justify-center mb-6">
                        <Button
                            type="button"
                            variant="outline"
                            className={OUTLINE_BTN}
                            onClick={() => {
                                openContact();
                                window.setTimeout(() => scrollTo('contato'), 50);
                            }}
                        >
                            Abrir formulário de contato
                        </Button>
                    </div>
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

            <footer className="px-4 sm:px-6 py-12 border-t border-yellow-500/20">
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

export default InformacoesPage;
