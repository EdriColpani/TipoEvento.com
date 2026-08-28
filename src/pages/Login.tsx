import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Button } from "@/components/ui/button";
import { supabase } from '@/integrations/supabase/client';
import { signInWithPasswordResilient, fetchAuthUserViaRest, refreshSessionViaRest, INVALID_LOGIN_MESSAGE } from '@/utils/auth-rest';
import { signOutSession, clearAuthSessionStorage, clearAuthSessionIfCurrentToken } from '@/utils/sign-out-session';
import {
    readCachedAuthSession,
    isAccessTokenTimeValid,
    isAuthApiRejectedStatus,
} from '@/utils/auth-session-cache';
import { showSuccess, showError } from '@/utils/toast';
import { isAuthEmailConfirmed } from '@/utils/auth-email-confirmed';
import { resolvePostLoginRedirect } from '@/utils/post-login-redirect';
import {
    isComplimentaryReturnPath,
    resolveComplimentaryReturnPath,
} from '@/utils/complimentary-auth-return';
import { usePublicSiteAuth } from '@/contexts/PublicLaunchModeContext';
import {
    isPartnerOwnerInviteCallback,
    RESET_PASSWORD_PATH,
    userMustSetPartnerPassword,
} from '@/utils/partner-password-setup';
import {
    clearStayOnLoginForPassword,
    getAuthUrlCallbackAtBoot,
    isSignupEmailCallback,
    shouldStayOnLoginForPassword,
    signupCallbackErrorMessage,
    stripAuthCallbackFromUrl,
} from '@/utils/auth-url-callback';
import type { User } from '@supabase/supabase-js';

/** JWT vencido: tenta refresh antes de limpar (evita perder sessão no retorno do MP). */
async function ensureFreshCachedSession(): Promise<void> {
    const cached = readCachedAuthSession();
    if (!cached.accessToken) {
        if (cached.refreshToken) {
            await refreshSessionViaRest(8_000);
        }
        return;
    }
    if (isAccessTokenTimeValid(cached.accessToken)) return;

    const refreshed = await refreshSessionViaRest(8_000);
    if (!refreshed) {
        clearAuthSessionStorage();
    }
}

/**
 * Só considera logado com token no cache validado pelo Auth REST.
 * getSession() em memória + usuário inventado em timeout mandavam /login de volta à landing.
 */
async function resolveExistingSessionUser(): Promise<User | null> {
    await ensureFreshCachedSession();
    const cached = readCachedAuthSession();
    if (!cached.accessToken) return null;

    const rest = await fetchAuthUserViaRest(cached.accessToken, 5_000);
    if (rest.user) return rest.user;

    if (isAuthApiRejectedStatus(rest.error?.status)) {
        const refreshed = await refreshSessionViaRest(8_000);
        if (refreshed) return refreshed;
        clearAuthSessionIfCurrentToken(cached.accessToken);
        return null;
    }

    return null;
}

const Login: React.FC = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const returnToFromQuery = (() => {
        const raw = new URLSearchParams(location.search).get('returnTo');
        if (!raw) return undefined;
        try {
            return decodeURIComponent(raw);
        } catch {
            return raw;
        }
    })();
    const returnTo =
        (location.state as { from?: string } | null)?.from ??
        (isComplimentaryReturnPath(returnToFromQuery) ? returnToFromQuery : undefined) ??
        resolveComplimentaryReturnPath(undefined) ??
        undefined;
    const [loginData, setLoginData] = useState({ email: '', password: '' });
    const [isLoading, setIsLoading] = useState(false);
    const [showPassword, setShowPassword] = useState(false);
    const [rememberMe, setRememberMe] = useState(true);
    const [signupNotice, setSignupNotice] = useState<'confirmed' | 'error' | null>(() => {
        const cb = getAuthUrlCallbackAtBoot();
        if (!isSignupEmailCallback(cb)) return null;
        return cb.error ? 'error' : 'confirmed';
    });
    const [signupNoticeText, setSignupNoticeText] = useState(() => {
        const cb = getAuthUrlCallbackAtBoot();
        return isSignupEmailCallback(cb) ? signupCallbackErrorMessage(cb) : '';
    });
    const { tipoUsuarioId: contextTipo, isAuthenticated, sessionReady } = usePublicSiteAuth();
    const redirectingRef = useRef(false);
    const stayOnLoginRef = useRef(
        shouldStayOnLoginForPassword() || isSignupEmailCallback(getAuthUrlCallbackAtBoot()),
    );
    const signupCallbackHandledRef = useRef(false);
    const passwordLoginInFlightRef = useRef(false);

    const completeAuthenticatedRedirect = async (
        userId: string,
        authUser?: User | null,
        options?: { silent?: boolean },
    ) => {
        if (redirectingRef.current) return;
        redirectingRef.current = true;
        try {
            const { path, message } = await resolvePostLoginRedirect(userId, returnTo, authUser);
            if (!options?.silent) {
                showSuccess(message);
            }
            navigate(path, { replace: true });
        } catch (error) {
            redirectingRef.current = false;
            const code = error instanceof Error ? error.message : '';
            if (code === 'PROFILE_NOT_FOUND') {
                // Silent: sessão residual/perfil lento — permanece no formulário.
                if (options?.silent) return;
                // Cold boot: NÃO desloga — evita /login com menu ainda autenticado.
                showError(
                    'Sessão ativa, mas o perfil demorou a responder. Continuando…',
                );
                const tipo = Number(contextTipo);
                if (tipo === 1) {
                    navigate('/admin/dashboard', { replace: true });
                } else if (tipo === 2) {
                    navigate('/manager/dashboard', { replace: true });
                } else {
                    navigate('/', { replace: true });
                }
                return;
            }
            if (code === 'UNKNOWN_USER_TYPE') {
                showError('Tipo de usuário desconhecido. Acesso negado.');
                await signOutSession();
                return;
            }
            showError('Ocorreu um erro inesperado. Tente novamente.');
            await signOutSession();
        }
    };

    useEffect(() => {
        let cancelled = false;

        const hash = window.location.hash;
        if (
            hash.includes('type=invite') ||
            hash.includes('type=recovery') ||
            hash.includes('type=magiclink')
        ) {
            navigate(`${RESET_PASSWORD_PATH}${hash}`, { replace: true });
            return;
        }

        const signupCallback = getAuthUrlCallbackAtBoot();
        // Se o usuário já submeteu a senha, não reviver o modo "só formulário"
        // (o snapshot type=signup sobrevivia e o SIGNED_IN chamava signOut no meio do login).
        if (stayOnLoginRef.current && !passwordLoginInFlightRef.current) {
            const stayOnLoginForPassword =
                shouldStayOnLoginForPassword() || isSignupEmailCallback(signupCallback);
            stayOnLoginRef.current = stayOnLoginForPassword;

            if (stayOnLoginForPassword && !signupCallbackHandledRef.current) {
                signupCallbackHandledRef.current = true;
                if (isSignupEmailCallback(signupCallback)) {
                    setSignupNotice(signupCallback.error ? 'error' : 'confirmed');
                    setSignupNoticeText(signupCallbackErrorMessage(signupCallback));
                    if (!signupCallback.error) {
                        showSuccess('E-mail confirmado! Entre com e-mail e senha.');
                    } else {
                        showError(signupCallbackErrorMessage(signupCallback));
                    }
                }
                stripAuthCallbackFromUrl();
                void signOutSession();
            }
        } else {
            stayOnLoginRef.current = false;
        }

        const isAuthCallbackUrl = () => {
            const currentHash = window.location.hash;
            const search = window.location.search;
            return (
                currentHash.includes('access_token') ||
                currentHash.includes('type=signup') ||
                search.includes('code=')
            );
        };

        const redirectIfPasswordSetupRequired = async (user: User) => {
            if (!(await userMustSetPartnerPassword(user))) {
                return false;
            }
            if (!cancelled) {
                navigate(RESET_PASSWORD_PATH, { replace: true });
            }
            return true;
        };

        /** Só sai de /login se o menu já mostra sessão autenticada e o Auth REST confirma. */
        const redirectIfAlreadyAuthenticated = async () => {
            if (stayOnLoginRef.current || shouldStayOnLoginForPassword()) return;
            if (!sessionReady || !isAuthenticated) return;

            const user = await resolveExistingSessionUser();
            if (cancelled || !user?.id) return;

            if (await redirectIfPasswordSetupRequired(user)) return;

            if (!isAuthEmailConfirmed(user)) {
                return;
            }

            if (isPartnerOwnerInviteCallback()) {
                navigate(`${RESET_PASSWORD_PATH}${window.location.hash}`, { replace: true });
                return;
            }

            await completeAuthenticatedRedirect(user.id, user, { silent: true });
        };

        void redirectIfAlreadyAuthenticated();

        const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
            if (cancelled || !session?.user?.id) return;

            // INITIAL_SESSION / TOKEN_REFRESHED com JWT morto causava loop de redirect.
            // Só confia em SIGNED_IN real (login / setSession fresco).
            if (event !== 'SIGNED_IN') return;

            void (async () => {
                if (
                    !passwordLoginInFlightRef.current &&
                    (stayOnLoginRef.current || shouldStayOnLoginForPassword())
                ) {
                    await signOutSession();
                    return;
                }

                // Revalida: sessão client pode estar stale.
                const verified = await resolveExistingSessionUser();
                if (cancelled || !verified?.id) return;

                if (await redirectIfPasswordSetupRequired(verified)) return;
                if (isPartnerOwnerInviteCallback()) {
                    navigate(`${RESET_PASSWORD_PATH}${window.location.hash}`, { replace: true });
                    return;
                }
                if (!isAuthEmailConfirmed(verified)) return;

                await completeAuthenticatedRedirect(verified.id, verified, {
                    silent: isAuthCallbackUrl(),
                });
            })();
        });

        return () => {
            cancelled = true;
            authListener.subscription.unsubscribe();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- montagem /login + sessão
    }, [navigate, returnTo, sessionReady, isAuthenticated]);

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsLoading(true);
        redirectingRef.current = false;
        stayOnLoginRef.current = false;
        passwordLoginInFlightRef.current = true;
        clearStayOnLoginForPassword();
        clearAuthSessionStorage();

        try {
            const { data: authData, error: authError } = await signInWithPasswordResilient(
                loginData.email,
                loginData.password,
            );

            if (authError || !authData?.user) {
                showError(authError?.message ?? INVALID_LOGIN_MESSAGE);
                return;
            }

            const user = authData.user;

            if (!isAuthEmailConfirmed(user)) {
                await signOutSession();
                showError('Confirme seu e-mail antes de entrar. Verifique sua caixa de entrada.');
                return;
            }

            if (await userMustSetPartnerPassword(user)) {
                navigate(RESET_PASSWORD_PATH, { replace: true });
                return;
            }

            await completeAuthenticatedRedirect(user.id, user);

        } catch (error) {
            console.error('Erro inesperado no login:', error);
            showError("Ocorreu um erro inesperado. Tente novamente.");
        } finally {
            passwordLoginInFlightRef.current = false;
            setIsLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-black text-white flex items-center justify-center px-4 sm:px-6 py-12">
            <div className="absolute inset-0 opacity-[0.12]">
                <div
                    className="absolute inset-0"
                    style={{
                        backgroundImage:
                            'radial-gradient(circle at 25% 25%, #22d3ee 0%, transparent 50%), radial-gradient(circle at 75% 75%, #3b82f6 0%, transparent 50%)',
                        backgroundSize: '400px 400px',
                    }}
                />
            </div>
            <div className="relative z-10 w-full max-w-sm sm:max-w-md">
                <div className="text-center mb-6 sm:mb-8">
                    <div className="text-3xl font-serif font-bold mb-2 bg-gradient-to-r from-cyan-400 via-sky-400 to-blue-500 bg-clip-text text-transparent">
                        EventFest
                    </div>
                    <h1 className="text-xl sm:text-2xl font-semibold text-white mb-2">Acessar Conta</h1>
                    <p className="text-gray-400 text-sm sm:text-base">
                        Cliente, gestor ou administrador — um único acesso para todos.
                    </p>
                </div>
                <div className="bg-black/80 backdrop-blur-sm border border-cyan-500/30 rounded-2xl p-6 sm:p-8 shadow-2xl shadow-cyan-500/15">
                    {signupNotice ? (
                        <div
                            className={`mb-5 rounded-xl border px-4 py-3 text-sm ${
                                signupNotice === 'error'
                                    ? 'border-amber-500/40 bg-amber-950/60 text-amber-50'
                                    : 'border-cyan-500/40 bg-cyan-950/60 text-cyan-50'
                            }`}
                        >
                            {signupNoticeText}
                        </div>
                    ) : null}
                    <form onSubmit={handleLogin} className="space-y-5 sm:space-y-6">
                        <div>
                            <label htmlFor="email" className="block text-sm font-medium text-white mb-2">
                                E-mail
                            </label>
                            <div className="relative">
                                <input
                                    type="email"
                                    id="email"
                                    value={loginData.email}
                                    onChange={(e) => setLoginData(prev => ({ ...prev, email: e.target.value }))}
                                    className="w-full bg-black/60 border border-cyan-500/30 rounded-xl px-4 py-3 text-white placeholder-gray-400 text-sm sm:text-base focus:outline-none focus:ring-2 focus:border-cyan-400 focus:ring-cyan-400/25 transition-all duration-300"
                                    placeholder="seu@email.com"
                                    required
                                />
                                <i className="fas fa-envelope absolute right-4 top-1/2 transform -translate-y-1/2 text-cyan-400/70 text-sm"></i>
                            </div>
                        </div>
                        <div>
                            <label htmlFor="password" className="block text-sm font-medium text-white mb-2">
                                Senha
                            </label>
                            <div className="relative">
                                <input
                                    type={showPassword ? 'text' : 'password'}
                                    id="password"
                                    value={loginData.password}
                                    onChange={(e) => setLoginData(prev => ({ ...prev, password: e.target.value }))}
                                    className="w-full bg-black/60 border border-cyan-500/30 rounded-xl px-4 py-3 text-white placeholder-gray-400 text-sm sm:text-base focus:outline-none focus:ring-2 focus:border-cyan-400 focus:ring-cyan-400/25 transition-all duration-300"
                                    placeholder="Digite sua senha"
                                    required
                                />
                                <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-4 top-1/2 transform -translate-y-1/2 text-cyan-400/70 hover:text-cyan-300 transition-colors">
                                    <i className={`fas ${showPassword ? 'fa-eye-slash' : 'fa-eye'}`}></i>
                                </button>
                            </div>
                        </div>
                        <div className="flex items-center justify-between">
                            <label className="flex items-center cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={rememberMe}
                                    onChange={(e) => setRememberMe(e.target.checked)}
                                    className="mr-2 h-4 w-4 accent-[#22d3ee] focus:outline-none focus:ring-2 focus:ring-cyan-400/50 focus:ring-offset-2 focus:ring-offset-black/80"
                                    style={{ accentColor: '#22d3ee' }}
                                />
                                <span className="text-xs sm:text-sm text-gray-300">Lembrar-me</span>
                            </label>
                            <button
                                type="button"
                                onClick={() => navigate('/forgot-password')}
                                className="text-xs sm:text-sm text-cyan-400 hover:text-cyan-300 transition-colors cursor-pointer"
                            >
                                Esqueci a senha
                            </button>
                        </div>
                        <div className="space-y-4">
                            <Button
                                type="submit"
                                disabled={isLoading}
                                className="w-full bg-gradient-to-r from-cyan-500 to-blue-600 text-black hover:from-cyan-400 hover:to-blue-500 py-3 text-base sm:text-lg font-semibold transition-all duration-300 cursor-pointer hover:scale-[1.02] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
                            >
                                {isLoading ? (
                                    <div className="flex items-center justify-center">
                                        <div className="w-5 h-5 border-2 border-black/20 border-t-black rounded-full animate-spin mr-2"></div>
                                        Entrando...
                                    </div>
                                ) : (
                                    'Entrar'
                                )}
                            </Button>
                            <Button
                                type="button"
                                onClick={() => navigate('/')}
                                className="w-full bg-transparent border border-cyan-500/40 text-cyan-300 hover:bg-cyan-500/10 py-3 text-base sm:text-lg font-semibold transition-all duration-300 cursor-pointer"
                            >
                                Voltar
                            </Button>
                        </div>
                        <div className="text-center pt-4 border-t border-cyan-500/25">
                            <p className="text-gray-400 text-sm">
                                Não tem uma conta?{' '}
                                <button
                                    type="button"
                                    onClick={() =>
                                        navigate('/register', {
                                            state: returnTo ? { from: returnTo } : undefined,
                                        })
                                    }
                                    className="text-cyan-400 hover:text-cyan-300 font-semibold transition-colors cursor-pointer"
                                >
                                    Cadastre-se
                                </button>
                            </p>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    );
};

export default Login;
