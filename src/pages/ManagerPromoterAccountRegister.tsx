import React, { useRef, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Loader2, UserPlus, ArrowLeft } from 'lucide-react';
import EmailConfirmationScreen from '@/components/EmailConfirmationScreen';
import { showError } from '@/utils/toast';
import { registerPromoterAccountViaResend } from '@/utils/promoter-registration-flow';
import { resolveManagerOnboardingPath } from '@/utils/manager-registration-kind';
import {
    clearCompanyRegistrationPostpone,
    postponeCompanyRegistration,
} from '@/utils/manager-company-registration';

function isValidAccountEmail(value: string): boolean {
    const email = value.trim().toLowerCase();
    if (!email.includes('@')) return false;
    const [local, domain] = email.split('@');
    if (!local || !domain || email.split('@').length !== 2) return false;
    if (local.startsWith('.') || local.endsWith('.') || local.includes('..')) return false;
    const labels = domain.split('.');
    if (labels.length < 2) return false;
    return labels.every((part) => /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(part));
}

const EMAIL_INVALID_MESSAGE =
    'Informe um e-mail válido, com @ e domínio (ex.: nome@empresa.com.br).';

const ManagerPromoterAccountRegister: React.FC = () => {
    const navigate = useNavigate();
    const [accountName, setAccountName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [passwordConfirm, setPasswordConfirm] = useState('');
    const [isSaving, setIsSaving] = useState(false);
    const [pendingConfirmationEmail, setPendingConfirmationEmail] = useState<string | null>(null);
    const [fieldErrors, setFieldErrors] = useState<{
        email?: string;
        password?: string;
        passwordConfirm?: string;
    }>({});
    const emailInputRef = useRef<HTMLInputElement>(null);
    const continuePath = resolveManagerOnboardingPath();

    const inputClass = (hasError?: boolean) =>
        `bg-black/60 text-white ${
            hasError
                ? 'border-red-500 focus-visible:ring-red-500/30'
                : 'border-yellow-500/30'
        }`;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const errors: { email?: string; password?: string; passwordConfirm?: string } = {};

        if (!accountName.trim()) {
            showError('Informe o nome do responsável.');
            return;
        }
        if (!email.trim()) {
            errors.email = 'Informe o e-mail de acesso.';
        } else if (!isValidAccountEmail(email)) {
            errors.email = EMAIL_INVALID_MESSAGE;
        }
        if (password.length < 6) {
            errors.password = 'A senha deve ter no mínimo 6 caracteres.';
        }
        if (!passwordConfirm) {
            errors.passwordConfirm = 'Confirme a senha.';
        } else if (password !== passwordConfirm) {
            errors.passwordConfirm = 'As senhas não conferem.';
        }

        setFieldErrors(errors);
        if (errors.email || errors.password || errors.passwordConfirm) {
            showError(errors.email || errors.password || errors.passwordConfirm || 'Verifique os dados.');
            if (errors.email) {
                window.setTimeout(() => emailInputRef.current?.focus(), 0);
            }
            return;
        }

        setIsSaving(true);
        clearCompanyRegistrationPostpone();
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

        navigate(continuePath, {
            state: { fromPromoterCta: true },
            replace: true,
        });
    };

    if (pendingConfirmationEmail) {
        return (
            <EmailConfirmationScreen
                email={pendingConfirmationEmail}
                variant="pro"
                loginTo="/login"
                loginState={{ from: continuePath }}
                continuePath={continuePath}
                resendRedirectPath={continuePath}
                onBack={() => {
                    postponeCompanyRegistration();
                    navigate('/');
                }}
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
                        onClick={() => {
                            postponeCompanyRegistration();
                            navigate('/');
                        }}
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
                        <form noValidate onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
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
                                    ref={emailInputRef}
                                    type="email"
                                    value={email}
                                    onChange={(e) => {
                                        setEmail(e.target.value);
                                        if (fieldErrors.email) {
                                            setFieldErrors((prev) => ({ ...prev, email: undefined }));
                                        }
                                    }}
                                    className={inputClass(Boolean(fieldErrors.email))}
                                    disabled={isSaving}
                                    placeholder="nome@empresa.com.br"
                                    autoComplete="email"
                                    inputMode="email"
                                />
                                <p className={`text-xs mt-1 ${fieldErrors.email ? 'text-red-400' : 'text-gray-500'}`}>
                                    {fieldErrors.email || 'Precisa ter @ e um domínio, como .com ou .com.br.'}
                                </p>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm text-white mb-2">Senha *</label>
                                    <Input
                                        type="password"
                                        value={password}
                                        onChange={(e) => {
                                            setPassword(e.target.value);
                                            if (fieldErrors.password) {
                                                setFieldErrors((prev) => ({ ...prev, password: undefined }));
                                            }
                                        }}
                                        className={inputClass(Boolean(fieldErrors.password))}
                                        disabled={isSaving}
                                        placeholder="Mínimo 6 caracteres"
                                        autoComplete="new-password"
                                    />
                                    <p className={`text-xs mt-1 ${fieldErrors.password ? 'text-red-400' : 'text-gray-500'}`}>
                                        {fieldErrors.password || 'Use no mínimo 6 caracteres.'}
                                    </p>
                                </div>
                                <div>
                                    <label className="block text-sm text-white mb-2">
                                        Confirmar senha *
                                    </label>
                                    <Input
                                        type="password"
                                        value={passwordConfirm}
                                        onChange={(e) => {
                                            setPasswordConfirm(e.target.value);
                                            if (fieldErrors.passwordConfirm) {
                                                setFieldErrors((prev) => ({ ...prev, passwordConfirm: undefined }));
                                            }
                                        }}
                                        className={inputClass(Boolean(fieldErrors.passwordConfirm))}
                                        disabled={isSaving}
                                        placeholder="Repita a senha"
                                        autoComplete="new-password"
                                    />
                                    {fieldErrors.passwordConfirm && (
                                        <p className="text-red-400 text-xs mt-1">{fieldErrors.passwordConfirm}</p>
                                    )}
                                </div>
                            </div>
                            <p className="text-xs text-gray-500">
                                Já tem conta?{' '}
                                <Link
                                    to="/login"
                                    state={{ from: continuePath }}
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
                                    className="flex-1 bg-yellow-500 text-black hover:bg-yellow-600 py-3 font-semibold disabled:opacity-50"
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
                                    onClick={() => {
                                        postponeCompanyRegistration();
                                        navigate('/');
                                    }}
                                    className="flex-1 bg-black/60 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 hover:text-yellow-400 disabled:opacity-50"
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
