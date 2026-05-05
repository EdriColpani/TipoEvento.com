import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from "@/components/ui/button";
import { supabase } from '@/integrations/supabase/client';
import { showError } from '@/utils/toast';

const ForgotPassword = () => {
    const navigate = useNavigate();
    const [email, setEmail] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [isSubmitted, setIsSubmitted] = useState(false);

    const handlePasswordReset = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!email) {
            showError("Por favor, insira seu e-mail.");
            return;
        }
        setIsLoading(true);

        const { error } = await supabase.auth.resetPasswordForEmail(email, {
            redirectTo: `${window.location.origin}/reset-password`,
        });

        setIsLoading(false);

        if (error) {
            console.error("Password reset error:", error);
        }

        setIsSubmitted(true);
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
                    <h1 className="text-xl sm:text-2xl font-semibold text-white mb-2">Redefinir Senha</h1>
                    <p className="text-gray-400 text-sm sm:text-base">
                        Insira seu e-mail para receber o link de redefinição
                    </p>
                </div>
                <div className="bg-black/80 backdrop-blur-sm border border-cyan-500/30 rounded-2xl p-6 sm:p-8 shadow-2xl shadow-cyan-500/15">
                    {isSubmitted ? (
                        <div className="text-center py-8">
                            <div className="w-16 h-16 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                                <i className="fas fa-paper-plane text-green-500 text-2xl"></i>
                            </div>
                            <h3 className="text-xl font-semibold text-white mb-2">Verifique seu E-mail</h3>
                            <p className="text-gray-400 text-sm mb-4">
                                Se uma conta com o e-mail informado existir, enviaremos um link para você redefinir sua senha.
                            </p>
                            <Button
                                onClick={() => navigate('/login')}
                                className="w-full bg-gradient-to-r from-cyan-500 to-blue-600 text-black hover:from-cyan-400 hover:to-blue-500 py-3 text-base sm:text-lg font-semibold transition-all duration-300 cursor-pointer"
                            >
                                Voltar para o Login
                            </Button>
                        </div>
                    ) : (
                        <form onSubmit={handlePasswordReset} className="space-y-6">
                            <div>
                                <label htmlFor="email" className="block text-sm font-medium text-white mb-2">
                                    E-mail
                                </label>
                                <div className="relative">
                                    <input
                                        type="email"
                                        id="email"
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        className="w-full bg-black/60 border border-cyan-500/30 rounded-xl px-4 py-3 text-white placeholder-gray-400 text-sm sm:text-base focus:outline-none focus:ring-2 focus:border-cyan-400 focus:ring-cyan-400/25 transition-all duration-300"
                                        placeholder="seu@email.com"
                                        required
                                    />
                                    <i className="fas fa-envelope absolute right-4 top-1/2 transform -translate-y-1/2 text-cyan-400/70 text-sm" aria-hidden />
                                </div>
                            </div>
                            <div className="space-y-4">
                                <Button
                                    type="submit"
                                    disabled={isLoading}
                                    className="w-full bg-gradient-to-r from-cyan-500 to-blue-600 text-black hover:from-cyan-400 hover:to-blue-500 py-3 text-base sm:text-lg font-semibold transition-all duration-300 cursor-pointer hover:scale-[1.02] disabled:opacity-50 disabled:hover:scale-100"
                                >
                                    {isLoading ? (
                                        <div className="flex items-center justify-center">
                                            <div className="w-5 h-5 border-2 border-black/20 border-t-black rounded-full animate-spin mr-2" />
                                            Enviando...
                                        </div>
                                    ) : (
                                        'Enviar Link de Redefinição'
                                    )}
                                </Button>
                                <Button
                                    type="button"
                                    onClick={() => navigate('/login')}
                                    className="w-full bg-transparent border border-cyan-500/40 text-cyan-300 hover:bg-cyan-500/10 py-3 text-base sm:text-lg font-semibold transition-all duration-300 cursor-pointer"
                                >
                                    Cancelar
                                </Button>
                            </div>
                        </form>
                    )}
                </div>
            </div>
        </div>
    );
};

export default ForgotPassword;
