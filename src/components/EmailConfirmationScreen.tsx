import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, Inbox, Mail, RefreshCw, ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { showError, showSuccess } from '@/utils/toast';
import { resendSignupConfirmationEmail } from '@/utils/resend-signup-confirmation';

const RESEND_COOLDOWN_SECONDS = 60;

function maskEmail(email: string): string {
    const [local, domain] = email.split('@');
    if (!local || !domain) return email;
    if (local.length <= 2) return `${local[0]}***@${domain}`;
    const hidden = Math.min(local.length - 2, 5);
    return `${local.slice(0, 2)}${'•'.repeat(hidden)}@${domain}`;
}

export type EmailConfirmationScreenProps = {
    email: string;
    variant?: 'pro' | 'client';
    title?: string;
    subtitle?: string;
    steps?: Array<{ title: string; description: string }>;
    showDraftSaved?: boolean;
    loginTo?: string;
    loginState?: Record<string, unknown>;
    resendEnabled?: boolean;
    resendRedirectPath?: string;
    onBack?: () => void;
    backLabel?: string;
};

const PRO_STEPS: EmailConfirmationScreenProps['steps'] = [
    {
        title: 'Abra sua caixa de entrada',
        description: 'Procure o e-mail enviado pelo EventFest (remetente EventFest).',
    },
    {
        title: 'Confirme seu endereço',
        description: 'Clique no link de verificação. Ele expira após algum tempo — use o reenvio se precisar.',
    },
    {
        title: 'Cadastre sua empresa',
        description:
            'Após confirmar, você verá o formulário de dados da empresa (etapa 2). Preencha uma única vez para virar gestor PRO.',
    },
];

const CLIENT_STEPS: EmailConfirmationScreenProps['steps'] = [
    {
        title: 'Abra sua caixa de entrada',
        description: 'Enviamos um link de ativação para o e-mail informado.',
    },
    {
        title: 'Ative sua conta',
        description: 'Clique no link do e-mail para validar seu cadastro.',
    },
    {
        title: 'Acesse a plataforma',
        description: 'Depois da confirmação, faça login normalmente.',
    },
];

const EmailConfirmationScreen: React.FC<EmailConfirmationScreenProps> = ({
    email,
    variant = 'client',
    title,
    subtitle,
    steps,
    showDraftSaved = false,
    loginTo = '/login',
    loginState,
    resendEnabled = true,
    resendRedirectPath,
    onBack,
    backLabel = 'Voltar',
}) => {
    const isPro = variant === 'pro';
    const accent = isPro ? 'yellow' : 'cyan';
    const resolvedTitle = title ?? (isPro ? 'Quase lá! Confirme seu e-mail' : 'Cadastro realizado!');
    const resolvedSubtitle =
        subtitle ??
        (isPro
            ? 'Sua conta foi criada. Falta apenas validar o e-mail para concluir o cadastro de gestor PRO.'
            : 'Enviamos um link de verificação para ativar sua conta.');
    const resolvedSteps = steps ?? (isPro ? PRO_STEPS : CLIENT_STEPS);

    const [cooldown, setCooldown] = useState(0);
    const [isResending, setIsResending] = useState(false);

    useEffect(() => {
        if (cooldown <= 0) return;
        const timer = window.setTimeout(() => setCooldown((value) => value - 1), 1000);
        return () => window.clearTimeout(timer);
    }, [cooldown]);

    const handleResend = useCallback(async () => {
        if (!resendEnabled || cooldown > 0 || isResending) return;
        setIsResending(true);
        try {
            const result = await resendSignupConfirmationEmail(email, resendRedirectPath);
            if (!result.ok) {
                throw new Error(result.message);
            }
            showSuccess('E-mail reenviado! Verifique sua caixa de entrada e spam.');
            setCooldown(RESEND_COOLDOWN_SECONDS);
        } catch (error) {
            console.error('Erro ao reenviar e-mail:', error);
            const message =
                error instanceof Error
                    ? error.message
                    : 'Não foi possível reenviar o e-mail. Tente novamente em instantes.';
            showError(message);
        } finally {
            setIsResending(false);
        }
    }, [cooldown, email, isResending, resendEnabled, resendRedirectPath]);

    const accentBorder = isPro ? 'border-yellow-500/30' : 'border-cyan-500/30';
    const accentShadow = isPro ? 'shadow-yellow-500/10' : 'shadow-cyan-500/15';
    const accentText = isPro ? 'text-yellow-500' : 'text-cyan-400';
    const accentBg = isPro ? 'bg-yellow-500/15' : 'bg-cyan-500/15';
    const accentRing = isPro ? 'ring-yellow-500/30' : 'ring-cyan-500/30';
    const primaryBtnClass = isPro
        ? 'bg-yellow-500 text-black hover:bg-yellow-600 hover:text-black border-0'
        : 'bg-gradient-to-r from-cyan-500 to-blue-600 text-black hover:from-cyan-400 hover:to-blue-500 border-0';
    const outlineBtnClass = isPro
        ? 'border-yellow-500/30 bg-black/60 text-yellow-500 hover:bg-yellow-500/10 hover:text-yellow-400'
        : 'border-cyan-500/30 bg-black/60 text-cyan-400 hover:bg-cyan-500/10 hover:text-cyan-300';
    const ghostBtnClass = isPro
        ? 'border border-transparent bg-transparent text-gray-400 hover:bg-white/5 hover:text-white'
        : 'border border-transparent bg-transparent text-gray-400 hover:bg-white/5 hover:text-white';

    return (
        <div className="min-h-screen bg-black text-white flex items-center justify-center px-4 sm:px-6 py-12">
            <div className="absolute inset-0 opacity-[0.08] pointer-events-none">
                <div
                    className="absolute inset-0"
                    style={{
                        backgroundImage: isPro
                            ? 'radial-gradient(circle at 20% 20%, #eab308 0%, transparent 45%), radial-gradient(circle at 80% 80%, #f59e0b 0%, transparent 45%)'
                            : 'radial-gradient(circle at 25% 25%, #22d3ee 0%, transparent 50%), radial-gradient(circle at 75% 75%, #3b82f6 0%, transparent 50%)',
                        backgroundSize: '420px 420px',
                    }}
                />
            </div>

            <div className="relative z-10 w-full max-w-lg">
                <div className="text-center mb-6 sm:mb-8">
                    <div
                        className={`text-3xl font-serif font-bold mb-2 ${
                            isPro
                                ? 'text-yellow-500'
                                : 'bg-gradient-to-r from-cyan-400 via-sky-400 to-blue-500 bg-clip-text text-transparent'
                        }`}
                    >
                        {isPro ? 'EventFest PRO' : 'EventFest'}
                    </div>
                    <h1 className="text-xl sm:text-2xl font-semibold text-white mb-2">{resolvedTitle}</h1>
                    <p className="text-gray-400 text-sm sm:text-base max-w-md mx-auto">{resolvedSubtitle}</p>
                </div>

                <Card
                    className={`bg-black/80 backdrop-blur-sm border ${accentBorder} rounded-2xl shadow-2xl ${accentShadow}`}
                >
                    <CardContent className="p-6 sm:p-8 space-y-6">
                        <div className="flex flex-col items-center text-center">
                            <div
                                className={`relative mb-4 flex h-20 w-20 items-center justify-center rounded-full ${accentBg} ring-1 ${accentRing}`}
                            >
                                <span
                                    className={`absolute inset-0 rounded-full animate-ping opacity-25 ${isPro ? 'bg-yellow-500' : 'bg-cyan-500'}`}
                                />
                                <Mail className={`h-9 w-9 ${accentText}`} />
                            </div>
                            <p className="text-sm text-gray-400 mb-2">Enviamos a confirmação para</p>
                            <p className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 font-mono text-sm sm:text-base text-white">
                                {maskEmail(email)}
                            </p>
                        </div>

                        {showDraftSaved && (
                            <div
                                className={`flex gap-3 rounded-xl border ${isPro ? 'border-yellow-500/25 bg-yellow-500/5' : 'border-cyan-500/25 bg-cyan-500/5'} p-4`}
                            >
                                <ShieldCheck className={`h-5 w-5 shrink-0 mt-0.5 ${accentText}`} />
                                <div className="text-sm text-left">
                                    <p className="font-medium text-white">Dados da empresa salvos neste navegador</p>
                                    <p className="text-gray-400 mt-1">
                                        Após confirmar o e-mail, retorne a esta página ou clique no link do e-mail
                                        para concluir o cadastro da empresa automaticamente.
                                    </p>
                                </div>
                            </div>
                        )}

                        <ol className="space-y-3">
                            {resolvedSteps?.map((step, index) => (
                                <li
                                    key={step.title}
                                    className="flex gap-3 rounded-xl border border-white/10 bg-black/40 p-4"
                                >
                                    <span
                                        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${accentBg} ${accentText}`}
                                    >
                                        {index + 1}
                                    </span>
                                    <div className="text-left">
                                        <p className="text-sm font-medium text-white">{step.title}</p>
                                        <p className="text-xs text-gray-400 mt-1 leading-relaxed">{step.description}</p>
                                    </div>
                                </li>
                            ))}
                        </ol>

                        <div className="flex items-start gap-2 rounded-lg border border-white/5 bg-white/[0.03] px-3 py-2 text-xs text-gray-500">
                            <Inbox className="h-4 w-4 shrink-0 mt-0.5" />
                            <span>
                                Não encontrou? Verifique spam, promoções ou lixeira. Aguarde alguns minutos antes de
                                reenviar.
                            </span>
                        </div>

                        <div className="flex flex-col gap-3 pt-1">
                            <Button
                                asChild
                                variant="outline"
                                className={cn(
                                    'w-full rounded-xl py-3 text-base font-semibold',
                                    primaryBtnClass,
                                )}
                            >
                                <Link to={loginTo} state={loginState}>
                                    <CheckCircle2 className="h-5 w-5 shrink-0" />
                                    Já confirmei — continuar cadastro
                                </Link>
                            </Button>

                            {resendEnabled && (
                                <Button
                                    type="button"
                                    variant="outline"
                                    disabled={cooldown > 0 || isResending}
                                    onClick={() => void handleResend()}
                                    className={cn(
                                        'w-full rounded-xl py-3 text-base font-semibold',
                                        outlineBtnClass,
                                    )}
                                >
                                    <RefreshCw
                                        className={cn('h-4 w-4 shrink-0', isResending && 'animate-spin')}
                                    />
                                    {cooldown > 0
                                        ? `Reenviar e-mail (${cooldown}s)`
                                        : 'Reenviar e-mail de confirmação'}
                                </Button>
                            )}

                            {onBack && (
                                <Button
                                    type="button"
                                    variant="outline"
                                    onClick={onBack}
                                    className={cn(
                                        'w-full rounded-xl py-3 text-base font-medium',
                                        ghostBtnClass,
                                    )}
                                >
                                    {backLabel}
                                </Button>
                            )}
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
};

export default EmailConfirmationScreen;
