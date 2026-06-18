import React from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLandingUi } from '@/contexts/LandingUiContext';
import { formatPhoneInput } from '@/utils/phone-format';

export type LandingContactPanelProps = {
    contactPhone: string;
    contactCompanyName: string;
    contactName: string;
    setContactName: (v: string) => void;
    contactFormPhone: string;
    setContactFormPhone: (v: string) => void;
    contactMessage: string;
    setContactMessage: (v: string) => void;
    sendingContact: boolean;
    onSendContact: () => void;
    isMobile?: boolean;
    defaultOpen?: boolean;
};

const LandingContactPanel: React.FC<LandingContactPanelProps> = ({
    contactPhone,
    contactCompanyName,
    contactName,
    setContactName,
    contactFormPhone,
    setContactFormPhone,
    contactMessage,
    setContactMessage,
    sendingContact,
    onSendContact,
    isMobile,
    defaultOpen = false,
}) => {
    const { contactOpen, closeContact } = useLandingUi();
    const isOpen = defaultOpen || contactOpen;

    return (
        <div
            id="landing-contact-panel"
            className={cn(
                'grid transition-all duration-500 ease-in-out scroll-mt-28',
                isOpen
                    ? 'grid-rows-[1fr] opacity-100 mb-10'
                    : 'grid-rows-[0fr] opacity-0 mb-0 pointer-events-none',
            )}
            aria-hidden={!isOpen}
        >
            <div className="overflow-hidden min-h-0">
                <div className="flex items-center justify-between gap-3 mb-4">
                    <p className="text-sm text-cyan-300/90">Fale com a EventFest</p>
                    {!defaultOpen ? (
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={closeContact}
                            className="text-gray-400 hover:text-cyan-400 hover:bg-cyan-400/10 shrink-0"
                            aria-label="Fechar contato"
                        >
                            <X className="h-5 w-5 mr-1" />
                            Fechar
                        </Button>
                    ) : null}
                </div>
                <div
                    className={cn(
                        'grid grid-cols-1 lg:grid-cols-2 gap-6',
                        isMobile && 'gap-4',
                    )}
                >
                    <Card className="bg-black/60 border border-yellow-500/30 rounded-2xl">
                        <div className="p-6">
                            <h3 className="text-xl text-yellow-500 font-semibold mb-2">Contato</h3>
                            <p className="text-gray-300 text-sm mb-4">
                                Atendimento oficial {contactCompanyName}. Fale com nosso time pelo telefone
                                abaixo ou envie uma mensagem pelo formulário.
                            </p>
                            <p className="text-white text-lg font-medium">
                                Telefone: <span className="text-yellow-500">{contactPhone}</span>
                            </p>
                        </div>
                    </Card>
                    <Card className="bg-black/60 border border-yellow-500/30 rounded-2xl">
                        <div className="p-6 space-y-3">
                            <h3 className="text-xl text-yellow-500 font-semibold">Deixe sua mensagem</h3>
                            <Input
                                value={contactName}
                                onChange={(e) => setContactName(e.target.value)}
                                placeholder="Seu nome"
                                className="bg-black/60 border-yellow-500/30 text-white"
                            />
                            <Input
                                type="tel"
                                inputMode="tel"
                                autoComplete="tel"
                                value={contactFormPhone}
                                onChange={(e) => setContactFormPhone(formatPhoneInput(e.target.value))}
                                placeholder="(46) 99999-9999"
                                className="bg-black/60 border-yellow-500/30 text-white"
                            />
                            <textarea
                                value={contactMessage}
                                onChange={(e) => setContactMessage(e.target.value)}
                                placeholder="Digite sua mensagem"
                                className="w-full min-h-[110px] rounded-md bg-black/60 border border-yellow-500/30 text-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-500/30"
                            />
                            <Button
                                type="button"
                                onClick={onSendContact}
                                disabled={sendingContact}
                                className="bg-yellow-500 text-black hover:bg-yellow-600"
                            >
                                {sendingContact ? (
                                    <Loader2 className="h-4 w-4 animate-spin mr-1" />
                                ) : null}
                                Enviar mensagem
                            </Button>
                        </div>
                    </Card>
                </div>
            </div>
        </div>
    );
};

export default LandingContactPanel;
