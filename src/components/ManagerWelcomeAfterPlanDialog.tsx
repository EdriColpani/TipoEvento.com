"use client";

import React from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarPlus, CheckCircle2, KeyRound, ListChecks, PartyPopper } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';

const PRIMARY_BTN =
    'bg-yellow-500 text-black hover:bg-yellow-600 disabled:opacity-50 font-semibold';
const OUTLINE_BTN =
    'bg-black/60 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 hover:text-yellow-400';

export type ManagerWelcomeAfterPlanDialogProps = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** Se true, oferece botão opcional para pagar o plano antes de ir ao painel. */
    offerPayment?: boolean;
    onPayNow?: () => void;
    paying?: boolean;
};

const STEPS: Array<{ icon: typeof CalendarPlus; title: string; body: string }> = [
    {
        icon: CalendarPlus,
        title: 'Cadastre seu evento',
        body: 'Em Eventos → Cadastrar: título, data, horário, local, imagens, capacidade e lotes de ingresso (nome, quantidade, preço e validade).',
    },
    {
        icon: KeyRound,
        title: 'Crie a chave de validação',
        body: 'Em Chaves de validação, gere uma chave para a portaria. Ela libera o app validador na entrada (e, se usar consumo, no balcão).',
    },
    {
        icon: ListChecks,
        title: 'Antes de publicar, confira',
        body: 'Contrato do evento (se houver), imagens nítidas, endereço correto e lotes com estoque. Depois use as ações rápidas do dashboard para o dia a dia.',
    },
];

const ManagerWelcomeAfterPlanDialog: React.FC<ManagerWelcomeAfterPlanDialogProps> = ({
    open,
    onOpenChange,
    offerPayment = false,
    onPayNow,
    paying = false,
}) => {
    const navigate = useNavigate();

    const goDashboard = () => {
        onOpenChange(false);
        navigate('/manager/dashboard', { replace: true });
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto bg-black border border-yellow-500/30 text-white p-6">
                <DialogHeader>
                    <div className="mx-auto mb-2 flex h-14 w-14 items-center justify-center rounded-full bg-yellow-500/15 ring-1 ring-yellow-500/30">
                        <PartyPopper className="h-7 w-7 text-yellow-500" />
                    </div>
                    <DialogTitle className="text-yellow-500 text-xl sm:text-2xl text-center">
                        Parabéns! Sua empresa está pronta
                    </DialogTitle>
                    <DialogDescription className="text-gray-400 text-center">
                        Plano aceito. Siga estes passos para colocar seu primeiro evento no ar.
                    </DialogDescription>
                </DialogHeader>

                <ul className="space-y-3 py-2">
                    {STEPS.map(({ icon: Icon, title, body }) => (
                        <li
                            key={title}
                            className="flex gap-3 rounded-xl border border-yellow-500/20 bg-black/40 p-4"
                        >
                            <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-yellow-500/10">
                                <Icon className="h-4 w-4 text-yellow-500" />
                            </div>
                            <div className="min-w-0">
                                <p className="text-sm font-medium text-white flex items-center gap-1.5">
                                    <CheckCircle2 className="h-3.5 w-3.5 text-yellow-500 shrink-0" />
                                    {title}
                                </p>
                                <p className="text-xs text-gray-400 mt-1 leading-relaxed">{body}</p>
                            </div>
                        </li>
                    ))}
                </ul>

                <p className="text-xs text-gray-500 text-center">
                    No dashboard os números começam em zero até haver vendas — isso é normal no primeiro
                    acesso.
                </p>

                <DialogFooter className="flex-col gap-2 sm:flex-col">
                    <Button
                        type="button"
                        className={`w-full ${PRIMARY_BTN}`}
                        disabled={paying}
                        onClick={goDashboard}
                    >
                        Ir para o dashboard
                    </Button>
                    {offerPayment && onPayNow ? (
                        <Button
                            type="button"
                            variant="outline"
                            className={`w-full ${OUTLINE_BTN}`}
                            disabled={paying}
                            onClick={onPayNow}
                        >
                            {paying ? 'Abrindo pagamento…' : 'Pagar o plano agora'}
                        </Button>
                    ) : null}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

export default ManagerWelcomeAfterPlanDialog;
