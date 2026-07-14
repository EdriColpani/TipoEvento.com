import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, MessageCircle, Phone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import {
    buildWhatsAppUrl,
    formatPhoneDisplay,
    type TicketChargebackBlockStatus,
} from '@/hooks/use-company-ticket-chargeback-block';

function money(v: number): string {
    return Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

interface Props {
    status: TicketChargebackBlockStatus | undefined;
    isLoading?: boolean;
    /** Quando true, esconde o formulário de criação (bloqueio total). */
    onBlockedChange?: (blocked: boolean) => void;
}

const TicketChargebackBlockBanner: React.FC<Props> = ({ status, isLoading }) => {
    const navigate = useNavigate();
    const [contactOpen, setContactOpen] = useState(false);

    if (isLoading || !status || (!status.warning && !status.blocked)) {
        return null;
    }

    const phone = String(status.contact?.phone ?? '').replace(/\D/g, '');
    const phoneLabel = formatPhoneDisplay(phone);
    const contactName = status.contact?.company_name || 'EventFest';
    const pending = money(status.pending_amount);
    const count = status.open_count;
    const threshold = status.threshold;
    const pixKey = status.payment_instructions?.pix_key?.trim() || '';
    const pixHolder = status.payment_instructions?.pix_holder?.trim() || '';

    const waText =
        `Olá, ${contactName}! Tenho ${count} chargeback(s) de ingresso em aberto ` +
        `(pendente ${pending}) e preciso regularizar para continuar cadastrando eventos.`;

    return (
        <>
            <Card
                className={`mb-6 border ${
                    status.blocked
                        ? 'bg-red-500/10 border-red-500/40'
                        : 'bg-amber-500/10 border-amber-500/40'
                }`}
            >
                <CardContent className="pt-6 flex gap-3">
                    <AlertTriangle
                        className={`h-6 w-6 shrink-0 mt-0.5 ${
                            status.blocked ? 'text-red-400' : 'text-amber-400'
                        }`}
                    />
                    <div
                        className={`text-sm space-y-2 ${
                            status.blocked ? 'text-red-100' : 'text-amber-100'
                        }`}
                    >
                        {status.blocked ? (
                            <>
                                <p className="font-medium">Cadastro de eventos temporariamente bloqueado</p>
                                <p className={`${status.blocked ? 'text-red-200/90' : ''}`}>
                                    Você possui <strong>{count}</strong> chargebacks de ingresso em aberto
                                    (limite: {threshold}). Valor pendente:{' '}
                                    <strong className="text-yellow-400">{pending}</strong>.
                                </p>
                                <p className="text-red-200/80 text-xs">
                                    Assim que a EventFest confirmar o recebimento dos valores no painel Admin,
                                    o cadastro de novos eventos é liberado automaticamente.
                                </p>
                            </>
                        ) : (
                            <>
                                <p className="font-medium">Atenção — chargeback de ingresso em aberto</p>
                                <p className="text-amber-200/90">
                                    Você tem <strong>{count}</strong> chargeback(s) pendente(s), total{' '}
                                    <strong className="text-yellow-400">{pending}</strong>.
                                    Ao atingir <strong>{threshold}</strong> chargebacks em aberto, o sistema
                                    bloqueia o cadastro de novos eventos até a quitação.
                                </p>
                                <p className="text-amber-200/80 text-xs">
                                    Faltam {status.remaining_until_block} para o bloqueio. Regularize o quanto
                                    antes via PIX/TED (quando aplicável) ou pelo suporte EventFest.
                                </p>
                            </>
                        )}

                        <div className="flex flex-wrap gap-2 pt-1">
                            <Button
                                type="button"
                                size="sm"
                                className="bg-yellow-500 text-black hover:bg-yellow-600"
                                onClick={() => setContactOpen(true)}
                            >
                                <Phone className="h-4 w-4 mr-1" />
                                Entrar em contato com a EventFest
                            </Button>
                            <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="bg-black/60 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 hover:text-yellow-400"
                                onClick={() => navigate('/manager/reports/ticket-chargebacks')}
                            >
                                Ver chargebacks / pagar
                            </Button>
                        </div>
                    </div>
                </CardContent>
            </Card>

            <Dialog open={contactOpen} onOpenChange={setContactOpen}>
                <DialogContent className="bg-black border border-yellow-500/30 text-white max-w-md">
                    <DialogHeader>
                        <DialogTitle className="text-yellow-500 font-serif">
                            Contato EventFest — chargeback
                        </DialogTitle>
                        <DialogDescription className="text-gray-400 text-left">
                            Combine o repasse do valor pendente. Informe a referência do chargeback no
                            comprovante.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-3 text-sm text-gray-300">
                        <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/5 p-3">
                            <p className="text-gray-500 text-xs uppercase tracking-wide">Valor pendente</p>
                            <p className="text-xl font-semibold text-yellow-400 mt-1">{pending}</p>
                            <p className="text-xs text-gray-500 mt-1">
                                {count} chargeback(s) em aberto
                                {status.blocked ? ' — cadastro bloqueado' : ''}
                            </p>
                        </div>

                        {phoneLabel ? (
                            <div>
                                <p className="text-gray-500 text-xs mb-1">Telefone / WhatsApp</p>
                                <p className="text-white font-medium">{phoneLabel}</p>
                                <p className="text-xs text-gray-500">{contactName}</p>
                            </div>
                        ) : (
                            <p className="text-amber-200/90 text-xs">
                                Telefone público ainda não configurado. Use o e-mail de suporte ou a página de
                                chargebacks com a chave PIX, se disponível.
                            </p>
                        )}

                        {pixKey ? (
                            <div className="rounded-lg border border-yellow-500/15 p-3 text-xs space-y-1">
                                <p className="text-gray-500">PIX para devolução</p>
                                {pixHolder ? <p className="text-gray-300">{pixHolder}</p> : null}
                                <p className="font-mono text-yellow-400 break-all">{pixKey}</p>
                            </div>
                        ) : null}

                        <div className="flex flex-col gap-2 pt-1">
                            {phone ? (
                                <>
                                    <Button
                                        type="button"
                                        className="bg-yellow-500 text-black hover:bg-yellow-600"
                                        asChild
                                    >
                                        <a href={`tel:+${phone.startsWith('55') ? phone : `55${phone}`}`}>
                                            <Phone className="h-4 w-4 mr-2" />
                                            Ligar agora
                                        </a>
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        className="bg-black/60 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 hover:text-yellow-400"
                                        asChild
                                    >
                                        <a
                                            href={buildWhatsAppUrl(phone, waText)}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                        >
                                            <MessageCircle className="h-4 w-4 mr-2" />
                                            Abrir WhatsApp
                                        </a>
                                    </Button>
                                </>
                            ) : null}
                            <Button
                                type="button"
                                variant="outline"
                                className="bg-black/60 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 hover:text-yellow-400"
                                onClick={() => {
                                    setContactOpen(false);
                                    navigate('/manager/reports/ticket-chargebacks');
                                }}
                            >
                                Ir para tela de chargebacks
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>
        </>
    );
};

export default TicketChargebackBlockBanner;
