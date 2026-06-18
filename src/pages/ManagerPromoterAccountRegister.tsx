import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Loader2, UserPlus, ArrowLeft } from 'lucide-react';
import EmailConfirmationScreen from '@/components/EmailConfirmationScreen';
import { showError } from '@/utils/toast';
import { registerPromoterAccountViaResend, MANAGER_ACCOUNT_REGISTER_PATH, MANAGER_COMPANY_REGISTER_PATH } from '@/utils/promoter-registration-flow';

const ManagerPromoterAccountRegister: React.FC = () => {
    const navigate = useNavigate();
    const [accountName, setAccountName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [passwordConfirm, setPasswordConfirm] = useState('');
    const [isSaving, setIsSaving] = useState(false);
    const [pendingConfirmationEmail, setPendingConfirmationEmail] = useState<string | null>(null);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!accountName.trim()) {
            showError('Informe o nome do responsável.');
            return;
        }
        if (!email.trim()) {
            showError('Informe o e-mail de acesso.');
            return;
        }
        if (password.length < 6) {
            showError('A senha deve ter no mínimo 6 caracteres.');
            return;
        }
        if (password !== passwordConfirm) {
            showError('As senhas não conferem.');
            return;
        }

        setIsSaving(true);
        const result = await registerPromoterAccountViaResend({
            email,
            password,
            accountName: accountName.trim(),
        });
        setIsSaving(false);

        if (!result.ok) {
            showError(result.message);
            return;
        }

        if (result.needsConfirmation) {
            setPendingConfirmationEmail(email.trim().toLowerCase());
            return;
        }

        navigate(MANAGER_COMPANY_REGISTER_PATH, {
            state: { fromPromoterCta: true },
            replace: true,
        });
    };

    if (pendingConfirmationEmail) {
        return (
            <EmailConfirmationScreen
                email={pendingConfirmationEmail}
                variant="pro"
                loginTo={MANAGER_ACCOUNT_REGISTER_PATH}
                resendRedirectPath={MANAGER_COMPANY_REGISTER_PATH}
                onBack={() => navigate('/')}
                backLabel="Voltar para a página inicial"
            />
        );
    }

    return (
        <div className="min-h-screen bg-black text-white flex items-center justify-center px-4 sm:px-6 py-12">
            <div className="relative z-10 w-full max-w-lg">
                <div className="text-center mb-6 sm:mb-8">
                    <div
                        className="text-3xl font-serif text-yellow-500 font-bold mb-2 cursor-pointer"
                        onClick={() => navigate('/')}
                    >
                        EventFest
                    </div>
                    <h1 className="text-xl sm:text-2xl font-semibold text-white mb-2">
                        Seja um Promotor
                    </h1>
                    <p className="text-gray-400 text-sm sm:text-base max-w-md mx-auto">
                        Primeiro passo: crie sua conta e confirme o e-mail. Depois você cadastra os
                        dados da empresa uma única vez.
                    </p>
                </div>

                <Card className="bg-black border border-yellow-500/30 rounded-2xl shadow-2xl shadow-yellow-500/10">
                    <CardHeader>
                        <CardTitle className="text-white text-xl flex items-center gap-2">
                            <UserPlus className="h-6 w-6 text-yellow-500" />
                            Conta de acesso
                        </CardTitle>
                        <CardDescription className="text-gray-400 text-sm">
                            Etapa 1 de 2 — confirmação por e-mail
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
                            <div>
                                <label className="block text-sm text-white mb-2">
                                    Nome do responsável *
                                </label>
                                <Input
                                    value={accountName}
                                    onChange={(e) => setAccountName(e.target.value)}
                                    className="bg-black/60 border-yellow-500/30 text-white"
                                    disabled={isSaving}
                                />
                            </div>
                            <div>
                                <label className="block text-sm text-white mb-2">E-mail *</label>
                                <Input
                                    type="email"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    className="bg-black/60 border-yellow-500/30 text-white"
                                    disabled={isSaving}
                                    placeholder="seu@email.com"
                                />
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm text-white mb-2">Senha *</label>
                                    <Input
                                        type="password"
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        className="bg-black/60 border-yellow-500/30 text-white"
                                        disabled={isSaving}
                                        minLength={6}
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm text-white mb-2">
                                        Confirmar senha *
                                    </label>
                                    <Input
                                        type="password"
                                        value={passwordConfirm}
                                        onChange={(e) => setPasswordConfirm(e.target.value)}
                                        className="bg-black/60 border-yellow-500/30 text-white"
                                        disabled={isSaving}
                                        minLength={6}
                                    />
                                </div>
                            </div>
                            <p className="text-xs text-gray-500">
                                Já tem conta?{' '}
                                <Link
                                    to="/login"
                                    state={{ from: MANAGER_COMPANY_REGISTER_PATH }}
                                    className="text-yellow-500 hover:underline"
                                >
                                    Faça login
                                </Link>{' '}
                                e continue o cadastro da empresa.
                            </p>
                            <div className="flex flex-col sm:flex-row gap-3 pt-2">
                                <Button
                                    type="submit"
                                    disabled={isSaving}
                                    className="flex-1 bg-yellow-500 text-black hover:bg-yellow-600 py-3 font-semibold"
                                >
                                    {isSaving ? (
                                        <>
                                            <Loader2 className="w-5 h-5 animate-spin mr-2" />
                                            Enviando...
                                        </>
                                    ) : (
                                        'Enviar confirmação por e-mail'
                                    )}
                                </Button>
                                <Button
                                    type="button"
                                    variant="outline"
                                    onClick={() => navigate('/')}
                                    className="flex-1 border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10"
                                    disabled={isSaving}
                                >
                                    <ArrowLeft className="mr-2 h-4 w-4" />
                                    Voltar
                                </Button>
                            </div>
                        </form>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
};

export default ManagerPromoterAccountRegister;
