"use client";

import React, { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';
import { showError, showSuccess } from '@/utils/toast';
import {
    finalizeContractAcceptance,
    requestContractAcceptanceOtp,
    verifyContractAcceptanceOtp,
    type ContractAcceptanceFinalizeResult,
} from '@/utils/contract-acceptance-secure';

const PRIMARY_BTN = 'bg-yellow-500 text-black hover:bg-yellow-600 disabled:opacity-50 font-semibold';
const OUTLINE_BTN =
    'bg-black/60 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 hover:text-yellow-400';

export type ContractOtpAcceptanceDialogProps = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    contractId: string;
    contractType: string;
    companyId?: string | null;
    acceptanceSource: string;
    scrolledToEnd: boolean;
    billingPlan?: string | null;
    onAccepted: (result: ContractAcceptanceFinalizeResult) => void;
};

type Step = 'otp' | 'sign' | 'done';

const ContractOtpAcceptanceDialog: React.FC<ContractOtpAcceptanceDialogProps> = ({
    open,
    onOpenChange,
    contractId,
    contractType,
    companyId = null,
    acceptanceSource,
    scrolledToEnd,
    billingPlan = null,
    onAccepted,
}) => {
    const queryClient = useQueryClient();
    const [step, setStep] = useState<Step>('otp');
    const [challengeId, setChallengeId] = useState<string | null>(null);
    const [destinationMasked, setDestinationMasked] = useState('');
    const [code, setCode] = useState('');
    const [sending, setSending] = useState(false);
    const [verifying, setVerifying] = useState(false);
    const [signing, setSigning] = useState(false);
    const [cooldown, setCooldown] = useState(0);
    const [result, setResult] = useState<ContractAcceptanceFinalizeResult | null>(null);
    const [idempotencyKey] = useState(() =>
        typeof crypto !== 'undefined' && crypto.randomUUID
            ? crypto.randomUUID()
            : `ca-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    const initialSendRef = useRef(false);

    const sendCode = async (isResend: boolean) => {
        setSending(true);
        try {
            const res = await requestContractAcceptanceOtp({
                contractId,
                contractType,
                companyId,
                acceptanceSource,
            });
            if (!res.ok || !res.challenge_id) {
                const msg =
                    res.error === 'cooldown' || res.error === 'rate_limited'
                        ? res.message ||
                          'Aguarde antes de solicitar outro código. Use o último e-mail recebido.'
                        : res.message || 'Não foi possível enviar o código.';
                throw new Error(msg);
            }
            setChallengeId(res.challenge_id);
            setDestinationMasked(res.destination_masked || '');
            setCode('');
            setStep('otp');
            setCooldown(res.resend_cooldown_seconds ?? 60);
            showSuccess(isResend ? 'Código reenviado.' : 'Código enviado para o seu e-mail.');
        } catch (e: unknown) {
            showError(e instanceof Error ? e.message : 'Falha ao enviar o código.');
        } finally {
            setSending(false);
        }
    };

    useEffect(() => {
        if (!open) {
            initialSendRef.current = false;
            return;
        }
        if (initialSendRef.current) return;
        initialSendRef.current = true;
        setStep('otp');
        setCode('');
        setResult(null);
        void sendCode(false);
        // eslint-disable-next-line react-hooks/exhaustive-deps -- envia uma vez ao abrir
    }, [open, contractId]);

    useEffect(() => {
        if (cooldown <= 0) return;
        const t = window.setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
        return () => window.clearInterval(t);
    }, [cooldown]);

    const handleVerify = async () => {
        if (!challengeId || code.replace(/\D/g, '').length !== 6) {
            showError('Informe o código de 6 dígitos.');
            return;
        }
        setVerifying(true);
        try {
            const res = await verifyContractAcceptanceOtp({ challengeId, code });
            if (!res.ok) {
                if (res.error === 'too_many_attempts') {
                    setChallengeId(null);
                    setCode('');
                }
                throw new Error(
                    res.message ||
                        (res.error === 'too_many_attempts'
                            ? 'Muitas tentativas com código errado. Clique em "Reenviar código".'
                            : 'Código inválido.'),
                );
            }
            setStep('sign');
            showSuccess('Código confirmado. Agora assine o contrato.');
        } catch (e: unknown) {
            showError(e instanceof Error ? e.message : 'Falha ao validar o código.');
        } finally {
            setVerifying(false);
        }
    };

    const handleSign = async () => {
        if (!challengeId) {
            showError('Solicite o código novamente.');
            return;
        }
        setSigning(true);
        try {
            const res = await finalizeContractAcceptance({
                challengeId,
                contractId,
                contractType,
                companyId,
                acceptanceSource,
                scrolledToEnd,
                idempotencyKey,
                billingPlan,
            });
            if (!res.ok || !res.acceptance_id) {
                throw new Error(res.message || 'Não foi possível registrar o aceite.');
            }
            setResult(res);
            setStep('done');
            showSuccess('Contrato aceito e registrado.');
            if (companyId) {
                void queryClient.invalidateQueries({
                    queryKey: ['managerCompanyContractAcceptances', companyId],
                });
            }
        } catch (e: unknown) {
            showError(e instanceof Error ? e.message : 'Falha ao assinar o contrato.');
        } finally {
            setSigning(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md bg-black/95 border border-yellow-500/30 text-white">
                <DialogHeader>
                    <DialogTitle className="text-yellow-500 font-serif text-xl">
                        {step === 'done' ? 'Contrato aceito com sucesso' : 'Confirme sua identidade'}
                    </DialogTitle>
                    <DialogDescription className="text-gray-400">
                        {step === 'done'
                            ? 'Seu aceite foi registrado com trilha de evidências.'
                            : 'Enviamos um código de confirmação para o seu e-mail cadastrado.'}
                    </DialogDescription>
                </DialogHeader>

                {step === 'otp' && (
                    <div className="space-y-4 py-2">
                        <p className="text-sm text-gray-300">
                            Destino:{' '}
                            <span className="text-yellow-500 font-medium">
                                {destinationMasked || '***'}
                            </span>
                        </p>
                        <div className="flex justify-center">
                            <InputOTP
                                maxLength={6}
                                value={code ?? ''}
                                onChange={(value) => setCode(value ?? '')}
                                disabled={sending || verifying}
                            >
                                <InputOTPGroup>
                                    {Array.from({ length: 6 }).map((_, i) => (
                                        <InputOTPSlot
                                            key={i}
                                            index={i}
                                            className="border-yellow-500/40 bg-black text-white first:border-l"
                                        />
                                    ))}
                                </InputOTPGroup>
                            </InputOTP>
                        </div>
                        <Button
                            type="button"
                            variant="outline"
                            disabled={sending || cooldown > 0}
                            onClick={() => void sendCode(true)}
                            className={`${OUTLINE_BTN} w-full`}
                        >
                            {sending ? (
                                <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    Enviando...
                                </>
                            ) : cooldown > 0 ? (
                                `Reenviar código (${cooldown}s)`
                            ) : (
                                'Reenviar código'
                            )}
                        </Button>
                    </div>
                )}

                {step === 'sign' && (
                    <div className="space-y-3 py-2 text-sm text-gray-300">
                        <p>Identidade confirmada em {destinationMasked || 'seu e-mail'}.</p>
                        <p>Ao clicar abaixo, o sistema registra o aceite, gera o hash e o PDF do contrato.</p>
                    </div>
                )}

                {step === 'done' && result && (
                    <div className="space-y-2 py-2 text-sm text-gray-300 rounded-xl border border-yellow-500/20 bg-black/60 p-4">
                        <p>
                            <span className="text-gray-500">ID do aceite:</span>{' '}
                            <span className="text-white break-all">{result.acceptance_id}</span>
                        </p>
                        <p>
                            <span className="text-gray-500">Data/hora:</span>{' '}
                            {result.accepted_at
                                ? new Date(result.accepted_at).toLocaleString('pt-BR')
                                : '—'}
                        </p>
                        <p>
                            <span className="text-gray-500">Versão:</span> {result.contract_version || '—'}
                        </p>
                    </div>
                )}

                <DialogFooter className="gap-2 sm:gap-0">
                    {step === 'otp' && (
                        <Button
                            type="button"
                            onClick={() => void handleVerify()}
                            disabled={verifying || code.replace(/\D/g, '').length !== 6}
                            className={`${PRIMARY_BTN} w-full`}
                        >
                            {verifying ? (
                                <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    Validando...
                                </>
                            ) : (
                                'Confirmar código'
                            )}
                        </Button>
                    )}
                    {step === 'sign' && (
                        <Button
                            type="button"
                            onClick={() => void handleSign()}
                            disabled={signing}
                            className={`${PRIMARY_BTN} w-full`}
                        >
                            {signing ? (
                                <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    Assinando...
                                </>
                            ) : (
                                'ASSINAR E ACEITAR CONTRATO'
                            )}
                        </Button>
                    )}
                    {step === 'done' && (
                        <Button
                            type="button"
                            onClick={() => {
                                if (result) onAccepted(result);
                                onOpenChange(false);
                            }}
                            className={`${PRIMARY_BTN} w-full`}
                        >
                            Continuar
                        </Button>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

export default ContractOtpAcceptanceDialog;
