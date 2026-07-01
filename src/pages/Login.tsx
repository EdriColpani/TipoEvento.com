import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Button } from "@/components/ui/button";
import { supabase } from '@/integrations/supabase/client';
import { showSuccess, showError } from '@/utils/toast';
import { isAuthEmailConfirmed } from '@/utils/auth-email-confirmed';
import { resolvePostLoginRedirect } from '@/utils/post-login-redirect';
import {
    isComplimentaryReturnPath,
    resolveComplimentaryReturnPath,
} from '@/utils/complimentary-auth-return';
import { usePublicLaunchMode } from '@/hooks/use-public-launch-mode';

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
    const { isPreview } = usePublicLaunchMode();

    const completeAuthenticatedRedirect = async (userId: string) => {
        try {
            const { path, message } = await resolvePostLoginRedirect(userId, returnTo);
            showSuccess(message);
            navigate(path, { replace: true });
        } catch (error) {
            const code = error instanceof Error ? error.message : '';
            if (code === 'PROFILE_NOT_FOUND') {
                showError('Erro ao carregar dados do perfil. Tente novamente.');
            } else if (code === 'UNKNOWN_USER_TYPE') {
                showError('Tipo de usuário desconhecido. Acesso negado.');
            } else {
                showError('Ocorreu um erro inesperado. Tente novamente.');
            }
            await supabase.auth.signOut({ scope: 'local' });
        }
    };

    useEffect(() => {
        let cancelled = false;

        const isAuthCallbackUrl = () => {
            const hash = window.location.hash;
            const search = window.location.search;
            return (
                hash.includes('access_token') ||
                hash.includes('type=signup') ||
                hash.includes('type=recovery') ||
                search.includes('code=')
            );
        };

        const handleEmailConfirmationReturn = async () => {
            if (!isAuthCallbackUrl()) {
                return;
            }
            const { data: { session } } = await supabase.auth.getSession();
            if (cancelled || !session?.user?.id || !isAuthEmailConfirmed(session.user)) {
                return;
            }
            await completeAuthenticatedRedirect(session.user.id);
        };

        void handleEmailConfirmationReturn();

        const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
            if (cancelled || event !== 'SIGNED_IN') {
                return;
            }
            if (!session?.user?.id || !isAuthEmailConfirmed(session.user)) {
                return;
            }
            void completeAuthenticatedRedirect(session.user.id);
        });

        return () => {
            cancelled = true;
            authListener.subscription.unsubscribe();
        };
    }, [navigate, returnTo]);

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsLoading(true);

        try {
            const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
                email: loginData.email,
                password: loginData.password,
            });

            if (authError) {
                showError("Credenciais inválidas ou usuário não encontrado.");
                setIsLoading(false);
                return;
            }

            const user = authData.user;

            if (user) {
                if (!isAuthEmailConfirmed(user)) {
                    await supabase.auth.signOut({ scope: 'local' });
                    showError('Confirme seu e-mail antes de entrar. Verifique sua caixa de entrada.');
                    setIsLoading(false);
                    return;
                }

                await completeAuthenticatedRedirect(user.id);
            } else {
                showError("Login falhou. Verifique seu e-mail e senha.");
            }

        } catch (error) {
            console.error('Erro inesperado no login:', error);
            showError("Ocorreu um erro inesperado. Tente novamente.");
        } finally {
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
                                onClick={() => navigate('/informacoes')}
                                className="w-full bg-transparent border border-cyan-500/40 text-cyan-300 hover:bg-cyan-500/10 py-3 text-base sm:text-lg font-semibold transition-all duration-300 cursor-pointer"
                            >
                                Voltar
                            </Button>
                        </div>
                        <div className="text-center pt-4 border-t border-cyan-500/25">
                            {isPreview ? (
                                <p className="text-gray-400 text-sm">
                                    Cadastros temporariamente indisponíveis. Estamos em fase de lançamento — use o
                                    formulário de contato na página de informações.
                                </p>
                            ) : (
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
                            )}
                        </div>
                    </form>
                </div>
            </div>
        </div>
    );
};

export default Login;