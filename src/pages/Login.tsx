import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { resolveClientPostLoginPath } from '@/utils/safe-login-redirect';
import { Button } from "@/components/ui/button";
import { supabase } from '@/integrations/supabase/client';
import { showSuccess, showError } from '@/utils/toast';

const Login: React.FC = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const returnTo = (location.state as { from?: string } | null)?.from;
    const [loginData, setLoginData] = useState({ email: '', password: '' });
    const [isLoading, setIsLoading] = useState(false);
    const [showPassword, setShowPassword] = useState(false);
    const [rememberMe, setRememberMe] = useState(true); // Adicionando estado para Lembrar-me

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsLoading(true);

        try {
            // 1. Autenticação com Supabase
            const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
                email: loginData.email,
                password: loginData.password,
            });

            if (authError) {
                // Trata erros de credenciais inválidas ou usuário não encontrado
                showError("Credenciais inválidas ou usuário não encontrado.");
                setIsLoading(false);
                return;
            }

            const user = authData.user;

            if (user) {
                // 2. Buscar o Tipo de Usuário na tabela profiles
                const { data: profileData, error: profileError } = await supabase
                    .from('profiles')
                    .select('tipo_usuario_id')
                    .eq('id', user.id)
                    .single();

                if (profileError || !profileData) {
                    console.error("Erro ao buscar perfil:", profileError);
                    showError("Erro ao carregar dados do perfil. Tente novamente.");
                    // Opcional: forçar logout se o perfil não for encontrado
                    await supabase.auth.signOut({ scope: 'local' });
                    setIsLoading(false);
                    return;
                }

                const userType = profileData.tipo_usuario_id;
                let successMessage = "Login realizado com sucesso!";
                let redirectPath = '/';

                // 3. Determinar mensagem de sucesso e rota de redirecionamento
                if (userType === 1) {
                    successMessage = "Login de Administrador Master realizado com sucesso!";
                    redirectPath = '/admin/dashboard';
                } else if (userType === 2) {
                    successMessage = "Login de Gestor PRO realizado com sucesso!";
                    redirectPath = '/manager/dashboard';
                } else if (userType === 3) {
                    successMessage = "Login de Cliente realizado com sucesso!";
                    // UX: cliente volta ao site (ou à página em que estava antes do login)
                    redirectPath = resolveClientPostLoginPath(returnTo);
                } else {
                    showError("Tipo de usuário desconhecido. Acesso negado.");
                    await supabase.auth.signOut({ scope: 'local' });
                    setIsLoading(false);
                    return;
                }
                
                showSuccess(successMessage);
                navigate(redirectPath, { replace: true });
            } else {
                // Isso pode acontecer se o e-mail não estiver confirmado, dependendo da configuração do Supabase
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
            <div className="absolute inset-0 opacity-10">
                <div className="absolute inset-0" style={{
                    backgroundImage: 'radial-gradient(circle at 25% 25%, #fbbf24 0%, transparent 50%), radial-gradient(circle at 75% 75%, #fbbf24 0%, transparent 50%)',
                    backgroundSize: '400px 400px'
                }}></div>
            </div>
            <div className="relative z-10 w-full max-w-sm sm:max-w-md">
                <div className="text-center mb-6 sm:mb-8">
                    <div className="text-3xl font-serif text-yellow-500 font-bold mb-2">
                        EventFest
                    </div>
                    <h1 className="text-xl sm:text-2xl font-semibold text-white mb-2">Acessar Conta</h1>
                    <p className="text-gray-400 text-sm sm:text-base">Bem-vindo de volta!</p>
                </div>
                <div className="bg-black/80 backdrop-blur-sm border border-yellow-500/30 rounded-2xl p-6 sm:p-8 shadow-2xl shadow-yellow-500/10">
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
                                    className="w-full bg-black/60 border border-yellow-500/30 rounded-xl px-4 py-3 text-white placeholder-gray-400 text-sm sm:text-base focus:outline-none focus:ring-2 focus:border-yellow-500 focus:ring-yellow-500/20 transition-all duration-300"
                                    placeholder="seu@email.com"
                                    required
                                />
                                <i className="fas fa-envelope absolute right-4 top-1/2 transform -translate-y-1/2 text-yellow-500/60 text-sm"></i>
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
                                    className="w-full bg-black/60 border border-yellow-500/30 rounded-xl px-4 py-3 text-white placeholder-gray-400 text-sm sm:text-base focus:outline-none focus:ring-2 focus:border-yellow-500 focus:ring-yellow-500/20 transition-all duration-300"
                                    placeholder="Digite sua senha"
                                    required
                                />
                                <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-4 top-1/2 transform -translate-y-1/2 text-yellow-500/60 hover:text-yellow-500 transition-colors">
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
                                    className="mr-2 accent-yellow-500" 
                                />
                                <span className="text-xs sm:text-sm text-gray-300">Lembrar-me</span>
                            </label>
                            <button 
                                type="button" 
                                onClick={() => navigate('/forgot-password')}
                                className="text-xs sm:text-sm text-yellow-500 hover:text-yellow-400 transition-colors cursor-pointer"
                            >
                                Esqueci a senha
                            </button>
                        </div>
                        <div className="space-y-4">
                            <Button
                                type="submit"
                                disabled={isLoading}
                                className="w-full bg-yellow-500 text-black hover:bg-yellow-600 py-3 text-base sm:text-lg font-semibold transition-all duration-300 cursor-pointer hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed"
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
                                className="w-full bg-transparent border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 py-3 text-base sm:text-lg font-semibold transition-all duration-300 cursor-pointer"
                            >
                                Voltar
                            </Button>
                        </div>
                        <div className="text-center pt-4 border-t border-yellow-500/20">
                            <p className="text-gray-400 text-sm">
                                Não tem uma conta?{' '}
                                <button
                                    type="button"
                                    onClick={() => navigate('/register')}
                                    className="text-yellow-500 hover:text-yellow-400 font-semibold transition-colors cursor-pointer"
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