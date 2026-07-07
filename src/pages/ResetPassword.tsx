import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Subscription } from '@supabase/supabase-js';
import { Button } from '@/components/ui/button';
import SiteLogo from '@/components/SiteLogo';
import { supabase } from '@/integrations/supabase/client';
import { showError, showSuccess } from '@/utils/toast';
import { acceptCompanyMemberInvites } from '@/utils/company-members';
import { updatePasswordViaRest } from '@/utils/auth-rest';
import { readCachedAuthSession } from '@/utils/auth-session-cache';
import { MANAGER_BILLING_SETUP_PATH } from '@/constants/manager-billing-gate';
import { resolvePostLoginRedirect } from '@/utils/post-login-redirect';
import { withTimeout } from '@/utils/promise-timeout';
import {
    INVITED_PARTNER_OWNER_KEY,
    PASSWORD_SETUP_REQUIRED_KEY,
    userMustSetPartnerPassword,
} from '@/utils/partner-password-setup';

function hashIndicatesPasswordSetup(): boolean {
    const hash = window.location.hash;
    return (
        hash.includes('type=invite') ||
        hash.includes('type=recovery') ||
        hash.includes('type=magiclink')
    );
}

const ResetPassword = () => {
    const navigate = useNavigate();
    const authSubRef = useRef<Subscription | null>(null);
    const [ready, setReady] = useState(false);
    const [validSession, setValidSession] = useState(false);
    const [isPartnerSetup, setIsPartnerSetup] = useState(() => hashIndicatesPasswordSetup());
    const [password, setPassword] = useState('');
    const [confirm, setConfirm] = useState('');
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        let cancelled = false;

        const syncSession = async () => {
            const cached = readCachedAuthSession();
            if (cached.userId) {
                const partnerSetup =
                    hashIndicatesPasswordSetup() ||
                    (await userMustSetPartnerPassword({ id: cached.userId } as { id: string }));
                setIsPartnerSetup(partnerSetup);
                setValidSession(true);
                setReady(true);
                return;
            }

            const {
                data: { session },
            } = await withTimeout(supabase.auth.getSession(), 4_000, { data: { session: null } });
            if (cancelled) return;
            const user = session?.user;
            const partnerSetup =
                hashIndicatesPasswordSetup() || (await userMustSetPartnerPassword(user));
            setIsPartnerSetup(partnerSetup);
            setValidSession(!!session);
            setReady(true);
        };

        void syncSession();

        const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
            if (!cancelled) {
                setValidSession(!!session);
            }
        });
        authSubRef.current = sub.subscription;

        return () => {
            cancelled = true;
            sub.subscription.unsubscribe();
            authSubRef.current = null;
        };
    }, []);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (password.length < 6) {
            showError('A senha deve ter pelo menos 6 caracteres.');
            return;
        }
        if (password !== confirm) {
            showError('As senhas não conferem.');
            return;
        }

        setLoading(true);
        authSubRef.current?.unsubscribe();
        authSubRef.current = null;

        const wasPartnerSetup = isPartnerSetup || hashIndicatesPasswordSetup();

        try {
            const metadata = {
                [PASSWORD_SETUP_REQUIRED_KEY]: false,
                [INVITED_PARTNER_OWNER_KEY]: false,
            };

            let user: { id?: string } | null | undefined;
            const restResult = await updatePasswordViaRest(password, metadata);
            if (restResult.error?.message) {
                const { data: updateData, error } = await withTimeout(
                    supabase.auth.updateUser({ password, data: metadata }),
                    12_000,
                    { data: { user: null }, error: { message: 'Tempo esgotado ao salvar a senha.' } },
                );
                if (error?.message) {
                    showError(error.message || restResult.error.message);
                    return;
                }
                user = updateData?.user;
            } else {
                user = restResult.user;
            }

            if (!user?.id) {
                showError('Senha salva, mas a sessão não foi confirmada. Tente entrar com a nova senha.');
                navigate('/login', { replace: true });
                return;
            }

            if (wasPartnerSetup) {
                void withTimeout(acceptCompanyMemberInvites(), 6_000, 0).catch((inviteError) => {
                    console.warn('[ResetPassword] accept invites:', inviteError);
                });

                const cachedUserId = user.id;
                showSuccess('Senha criada! Redirecionando…');
                navigate(MANAGER_BILLING_SETUP_PATH, { replace: true });

                void withTimeout(
                    resolvePostLoginRedirect(cachedUserId, undefined, { id: cachedUserId } as { id: string }),
                    8_000,
                    { path: MANAGER_BILLING_SETUP_PATH, message: '' },
                )
                    .then((resolved) => {
                        if (resolved.path && resolved.path !== MANAGER_BILLING_SETUP_PATH) {
                            navigate(resolved.path, { replace: true });
                        }
                    })
                    .catch((redirectError) => {
                        console.warn('[ResetPassword] post-login redirect:', redirectError);
                    });
                return;
            }

            showSuccess('Senha atualizada. Entre de novo com a nova senha.');
            await supabase.auth.signOut({ scope: 'local' });
            navigate('/login', { replace: true });
        } catch (err) {
            console.error('[ResetPassword] submit:', err);
            showError('Não foi possível salvar a senha. Tente novamente.');
        } finally {
            setLoading(false);
        }
    };

    const inputClass =
        'w-full bg-black/60 border border-cyan-500/30 rounded-xl px-4 py-3 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:border-cyan-400 focus:ring-cyan-400/25 transition-all duration-300';

    if (!ready) {
        return (
            <div className="min-h-screen bg-black text-white flex items-center justify-center">
                <div className="w-8 h-8 border-2 border-cyan-500/30 border-t-cyan-400 rounded-full animate-spin" />
            </div>
        );
    }

    if (!validSession) {
        return (
            <div className="min-h-screen bg-black text-white flex items-center justify-center px-4 py-12">
                <div className="absolute inset-0 opacity-[0.12] pointer-events-none">
                    <div
                        className="absolute inset-0"
                        style={{
                            backgroundImage:
                                'radial-gradient(circle at 25% 25%, #22d3ee 0%, transparent 50%), radial-gradient(circle at 75% 75%, #3b82f6 0%, transparent 50%)',
                            backgroundSize: '400px 400px',
                        }}
                    />
                </div>
                <div className="relative z-10 w-full max-w-md bg-black/80 backdrop-blur-sm border border-cyan-500/30 rounded-2xl p-8 text-center shadow-2xl shadow-cyan-500/15">
                    <div className="flex justify-center mb-6">
                        <SiteLogo feature />
                    </div>
                    <h1 className="text-xl font-semibold mb-2">Link inválido ou expirado</h1>
                    <p className="text-gray-400 text-sm mb-6">
                        {isPartnerSetup
                            ? 'Peça um novo convite ao administrador EventFest e abra o link no navegador.'
                            : 'Peça um novo link em "Esqueci minha senha" e abra o e-mail no navegador.'}
                    </p>
                    <Button
                        className="w-full bg-gradient-to-r from-cyan-500 to-blue-600 text-black hover:from-cyan-400 hover:to-blue-500 py-3 font-semibold"
                        onClick={() => navigate(isPartnerSetup ? '/login' : '/forgot-password')}
                    >
                        {isPartnerSetup ? 'Ir para o login' : 'Solicitar novo link'}
                    </Button>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-black text-white flex items-center justify-center px-4 py-12">
            <div className="absolute inset-0 opacity-[0.12] pointer-events-none">
                <div
                    className="absolute inset-0"
                    style={{
                        backgroundImage:
                            'radial-gradient(circle at 25% 25%, #22d3ee 0%, transparent 50%), radial-gradient(circle at 75% 75%, #3b82f6 0%, transparent 50%)',
                        backgroundSize: '400px 400px',
                    }}
                />
            </div>
            <div className="relative z-10 w-full max-w-md">
                <div className="text-center mb-6">
                    <div className="flex justify-center mb-4">
                        <SiteLogo feature />
                    </div>
                    <h1 className="text-2xl font-semibold">
                        {isPartnerSetup ? 'Criar sua senha' : 'Nova senha'}
                    </h1>
                    <p className="text-gray-400 text-sm mt-1">
                        {isPartnerSetup
                            ? 'Você foi convidado como gestor. Defina sua senha para acessar o painel EventFest.'
                            : 'Link de recuperação ativo — defina a nova senha e depois entre de novo.'}
                    </p>
                </div>
                <form
                    onSubmit={handleSubmit}
                    className="bg-black/80 backdrop-blur-sm border border-cyan-500/30 rounded-2xl p-8 space-y-4 shadow-2xl shadow-cyan-500/15"
                >
                    <div>
                        <label htmlFor="np" className="block text-sm text-white mb-2">
                            {isPartnerSetup ? 'Senha' : 'Nova senha'}
                        </label>
                        <input
                            id="np"
                            type="password"
                            autoComplete="new-password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            className={inputClass}
                            required
                            minLength={6}
                            disabled={loading}
                        />
                    </div>
                    <div>
                        <label htmlFor="npc" className="block text-sm text-white mb-2">
                            Confirmar senha
                        </label>
                        <input
                            id="npc"
                            type="password"
                            autoComplete="new-password"
                            value={confirm}
                            onChange={(e) => setConfirm(e.target.value)}
                            className={inputClass}
                            required
                            minLength={6}
                            disabled={loading}
                        />
                    </div>
                    <Button
                        type="submit"
                        disabled={loading}
                        className="w-full bg-gradient-to-r from-cyan-500 to-blue-600 text-black hover:from-cyan-400 hover:to-blue-500 py-3 font-semibold disabled:opacity-50"
                    >
                        {loading ? 'Salvando…' : isPartnerSetup ? 'Criar senha e entrar' : 'Salvar nova senha'}
                    </Button>
                </form>
            </div>
        </div>
    );
};

export default ResetPassword;
