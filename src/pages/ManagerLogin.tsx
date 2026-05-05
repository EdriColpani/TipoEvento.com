import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from "@/components/ui/button";
import { supabase } from '@/integrations/supabase/client';
import { showSuccess, showError } from '@/utils/toast';

const ADMIN_USER_TYPE_ID = 1;
const MANAGER_USER_TYPE_ID = 2;
const CLIENT_USER_TYPE_ID = 3;

const ManagerLogin: React.FC = () => {
    const navigate = useNavigate();
    const [managerLoginData, setManagerLoginData] = useState({ email: '', password: '' });
    const [isLoading, setIsLoading] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsLoading(true);

        try {
            const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
                email: managerLoginData.email.trim(),
                password: managerLoginData.password,
            });

            if (authError) {
                showError('Credenciais inválidas ou usuário não encontrado.');
                return;
            }

            const user = authData.user;
            if (!user) {
                showError('Login falhou. Verifique seu e-mail e senha.');
                return;
            }

            const { data: profileData, error: profileError } = await supabase
                .from('profiles')
                .select('tipo_usuario_id')
                .eq('id', user.id)
                .single();

            if (profileError || !profileData) {
                showError('Erro ao carregar dados do perfil. Tente novamente.');
                await supabase.auth.signOut({ scope: 'local' });
                return;
            }

            const userType = profileData.tipo_usuario_id;

            if (userType === ADMIN_USER_TYPE_ID) {
                showSuccess('Login de Administrador Master realizado com sucesso!');
                navigate('/admin/dashboard', { replace: true });
                return;
            }

            if (userType === MANAGER_USER_TYPE_ID) {
                showSuccess('Login de Gestor PRO realizado com sucesso!');
                navigate('/manager/dashboard', { replace: true });
                return;
            }

            if (userType === CLIENT_USER_TYPE_ID) {
                showError('Conta de cliente: use o login do site em “Acessar Conta”.');
                await supabase.auth.signOut({ scope: 'local' });
                return;
            }

            showError('Tipo de usuário não autorizado nesta área.');
            await supabase.auth.signOut({ scope: 'local' });
        } catch {
            showError('Ocorreu um erro inesperado. Tente novamente.');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-black text-white flex items-center justify-center px-6 py-12">
            <div className="absolute inset-0 opacity-10">
                <div className="absolute inset-0" style={{
                    backgroundImage: 'radial-gradient(circle at 25% 25%, #fbbf24 0%, transparent 50%), radial-gradient(circle at 75% 75%, #fbbf24 0%, transparent 50%)',
                    backgroundSize: '400px 400px'
                }}></div>
            </div>
            <div className="relative z-10 w-full max-w-md">
                <div className="text-center mb-8">
                    <div 
                        className="text-3xl font-serif text-yellow-500 font-bold mb-2 flex items-center justify-center cursor-pointer"
                        onClick={() => navigate('/')} // Adicionado onClick para navegar para a home
                    >
                        EventFest
                        <span className="ml-3 bg-gradient-to-r from-yellow-500 to-yellow-600 text-black px-3 py-1 rounded-lg text-sm font-bold">PRO</span>
                    </div>
                    <h1 className="text-2xl font-semibold text-white mb-2">Área do Gestor</h1>
                    <p className="text-gray-400">Acesse seu painel de controle premium</p>
                </div>
                <div className="bg-black/80 backdrop-blur-sm border border-yellow-500/30 rounded-2xl p-8 shadow-2xl shadow-yellow-500/10">
                    <form onSubmit={handleSubmit} className="space-y-6">
                        <div>
                            <label htmlFor="managerEmail" className="block text-sm font-medium text-white mb-2">
                                E-mail Corporativo
                            </label>
                            <div className="relative">
                                <input
                                    type="email"
                                    id="managerEmail"
                                    value={managerLoginData.email}
                                    onChange={(e) => setManagerLoginData(prev => ({ ...prev, email: e.target.value }))}
                                    className="w-full bg-black/60 border border-yellow-500/30 rounded-xl px-4 py-3 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:border-yellow-500 focus:ring-yellow-500/20 transition-all duration-300"
                                    placeholder="gestor@empresa.com"
                                    required
                                />
                                <i className="fas fa-building absolute right-4 top-1/2 transform -translate-y-1/2 text-yellow-500/60 text-sm"></i>
                            </div>
                        </div>
                        <div>
                            <label htmlFor="managerPassword" className="block text-sm font-medium text-white mb-2">
                                Senha de Acesso
                            </label>
                            <div className="relative">
                                <input
                                    type="password"
                                    id="managerPassword"
                                    value={managerLoginData.password}
                                    onChange={(e) => setManagerLoginData(prev => ({ ...prev, password: e.target.value }))}
                                    className="w-full bg-black/60 border border-yellow-500/30 rounded-xl px-4 py-3 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:border-yellow-500 focus:ring-yellow-500/20 transition-all duration-300"
                                    placeholder="Digite sua senha"
                                    required
                                />
                                <i className="fas fa-shield-alt absolute right-4 top-1/2 transform -translate-y-1/2 text-yellow-500/60 text-sm"></i>
                            </div>
                        </div>
                        <div className="flex items-center justify-between">
                            <label className="flex items-center cursor-pointer">
                                <input type="checkbox" className="mr-2 accent-yellow-500" />
                                <span className="text-sm text-gray-300">Manter-me conectado</span>
                            </label>
                            <button
                                type="button"
                                onClick={() => navigate('/forgot-password')}
                                className="text-sm text-yellow-500 hover:text-yellow-400 transition-colors cursor-pointer"
                            >
                                Esqueci minha senha
                            </button>
                        </div>
                        <div className="space-y-4">
                            <Button
                                type="submit"
                                disabled={isLoading}
                                className="w-full bg-gradient-to-r from-yellow-500 to-yellow-600 text-black hover:from-yellow-600 hover:to-yellow-700 py-3 text-lg font-semibold transition-all duration-300 cursor-pointer hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
                            >
                                {isLoading ? (
                                    <span className="inline-flex items-center justify-center gap-2">
                                        <span className="h-5 w-5 border-2 border-black/20 border-t-black rounded-full animate-spin" aria-hidden />
                                        Entrando...
                                    </span>
                                ) : (
                                    <>
                                        <i className="fas fa-crown mr-2"></i>
                                        Acessar Dashboard PRO
                                    </>
                                )}
                            </Button>
                            <Button
                                type="button"
                                onClick={() => navigate('/')}
                                className="w-full bg-transparent border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 py-3 text-lg font-semibold transition-all duration-300 cursor-pointer"
                            >
                                Voltar ao Site
                            </Button>
                        </div>
                    </form>
                </div>
                <div className="mt-6 grid grid-cols-2 gap-4">
                    <div className="p-4 bg-black/40 rounded-xl border border-yellow-500/20 text-center">
                        <i className="fas fa-lock text-yellow-500 text-xl mb-2"></i>
                        <div className="text-xs text-gray-400">Criptografia SSL</div>
                    </div>
                    <div className="p-4 bg-black/40 rounded-xl border border-yellow-500/20 text-center">
                        <i className="fas fa-user-shield text-yellow-500 text-xl mb-2"></i>
                        <div className="text-xs text-gray-400">Autenticação 2FA</div>
                    </div>
                </div>
                <div className="mt-6 p-4 bg-gradient-to-r from-yellow-500/10 to-yellow-600/10 rounded-xl border border-yellow-500/30">
                    <div className="flex items-center text-yellow-500 mb-2">
                        <i className="fas fa-star mr-2"></i>
                        <span className="text-sm font-semibold">Recursos Premium PRO</span>
                    </div>
                    <ul className="text-gray-300 text-xs space-y-1">
                        <li>• Dashboard avançado com analytics em tempo real</li>
                        <li>• Gestão completa de eventos e vendas</li>
                        <li>• Sistema de pulseiras inteligentes</li>
                        <li>• Relatórios detalhados e exportação</li>
                    </ul>
                </div>
            </div>
        </div>
    );
};

export default ManagerLogin;