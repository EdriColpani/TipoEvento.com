import React, { useEffect, useState } from 'react';
import { Loader2, Shield } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import LandingFooter from '@/components/landing/LandingFooter';
import { useDevice } from '@/hooks/use-device';
import { callRpcPublicRest } from '@/utils/supabase-rest-rpc';

const PAGE_TITLE = 'Exclusão de Conta e Dados | EventFest';
const CANONICAL = 'https://www.eventfest.com.br/exclusao-de-conta';
const PRIVACY_URL = 'https://www.lfcdigital.com.br/politica-de-privacidade';
const CONTACT_EMAIL = 'contato@lfcdigital.com.br';
const SUCCESS_MESSAGE =
    'Solicitação enviada com sucesso.\n\nRecebemos sua solicitação de exclusão. Nossa equipe analisará o pedido e realizará as providências cabíveis após a validação necessária.';
const ERROR_MESSAGE =
    'Não foi possível enviar sua solicitação. Verifique os dados informados e tente novamente.';

const EMAIL_RE = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;

type FormState = {
    name: string;
    email: string;
    reason: string;
    declared: boolean;
};

const AccountDeletionPage: React.FC = () => {
    const { isMobile } = useDevice();
    const [form, setForm] = useState<FormState>({
        name: '',
        email: '',
        reason: '',
        declared: false,
    });
    const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
    const [sending, setSending] = useState(false);
    const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

    useEffect(() => {
        document.title = PAGE_TITLE;
        const desc = document.querySelector('meta[name="description"]');
        const prevDesc = desc?.getAttribute('content') ?? '';
        if (desc) {
            desc.setAttribute(
                'content',
                'Solicite a exclusão da sua conta e dos dados associados ao EventFest.',
            );
        }
        let canonical = document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
        const createdCanonical = !canonical;
        if (!canonical) {
            canonical = document.createElement('link');
            canonical.rel = 'canonical';
            document.head.appendChild(canonical);
        }
        const prevCanonical = canonical.href;
        canonical.href = CANONICAL;

        return () => {
            document.title = 'EventFest';
            if (desc) desc.setAttribute('content', prevDesc);
            if (createdCanonical) canonical?.remove();
            else if (canonical) canonical.href = prevCanonical;
        };
    }, []);

    const validate = (): boolean => {
        const next: Partial<Record<keyof FormState, string>> = {};
        if (form.name.trim().length < 2) next.name = 'Informe seu nome.';
        if (!EMAIL_RE.test(form.email.trim())) next.email = 'Informe um e-mail válido.';
        if (!form.declared) next.declared = 'Confirme a declaração para enviar a solicitação.';
        if (form.reason.trim().length > 2000) next.reason = 'O motivo deve ter no máximo 2000 caracteres.';
        setErrors(next);
        return Object.keys(next).length === 0;
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (sending) return;
        setFeedback(null);
        if (!validate()) return;

        setSending(true);
        try {
            await callRpcPublicRest(
                'create_account_deletion_request',
                {
                    p_name: form.name.trim(),
                    p_email: form.email.trim(),
                    p_reason: form.reason.trim() || null,
                    p_declared_titular: true,
                },
                15_000,
            );
            setFeedback({ type: 'success', text: SUCCESS_MESSAGE });
            setForm({ name: '', email: '', reason: '', declared: false });
            setErrors({});
        } catch {
            setFeedback({ type: 'error', text: ERROR_MESSAGE });
        } finally {
            setSending(false);
        }
    };

    const cardClass = 'bg-black/80 border border-yellow-500/30 rounded-2xl';

    return (
        <div className="landing-ef-theme min-h-screen bg-black text-white">
            <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
                <div className="flex items-center gap-2 text-yellow-500 mb-4">
                    <Shield className="h-5 w-5" aria-hidden />
                    <span className="text-sm font-medium">Solicitação segura</span>
                </div>
                <h1 className="text-2xl sm:text-3xl font-serif text-yellow-500 mb-3">
                    Exclusão de conta e dados
                </h1>
                <p className="text-gray-200 text-base sm:text-lg mb-4">
                    Solicite a exclusão da sua conta EventFest e dos dados associados a ela.
                </p>
                <p className="text-gray-400 text-sm sm:text-base leading-relaxed mb-8">
                    O EventFest respeita sua privacidade e disponibiliza este canal para que você possa
                    solicitar a exclusão da sua conta e dos dados pessoais associados ao seu cadastro.
                </p>

                <Card className={`${cardClass} mb-6`}>
                    <CardHeader>
                        <CardTitle className="text-white text-lg">Como solicitar a exclusão</CardTitle>
                    </CardHeader>
                    <CardContent className="text-gray-300 text-sm sm:text-base leading-relaxed space-y-3">
                        <ol className="list-decimal pl-5 space-y-2">
                            <li>Informe o e-mail utilizado no cadastro do EventFest.</li>
                            <li>Envie a solicitação de exclusão.</li>
                            <li>
                                A equipe do EventFest verificará a solicitação e a identidade do titular
                                quando necessário.
                            </li>
                            <li>
                                Após a validação, a conta e os dados elegíveis serão excluídos ou
                                anonimizados de acordo com as obrigações legais e os prazos de retenção
                                aplicáveis.
                            </li>
                        </ol>
                        <p className="text-gray-400 text-sm">
                            Esta página registra um pedido para análise. A exclusão não é automática e não
                            ocorre apenas pelo envio do formulário.
                        </p>
                    </CardContent>
                </Card>

                <Card className={`${cardClass} mb-6`}>
                    <CardHeader>
                        <CardTitle className="text-white text-lg">Solicitar exclusão</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <form
                            onSubmit={handleSubmit}
                            className="space-y-4"
                            noValidate
                            aria-busy={sending}
                        >
                            <div>
                                <label htmlFor="deletion-name" className="block text-sm text-white mb-2">
                                    Nome <span className="text-yellow-500" aria-hidden>*</span>
                                </label>
                                <Input
                                    id="deletion-name"
                                    name="name"
                                    autoComplete="name"
                                    value={form.name}
                                    onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))}
                                    disabled={sending}
                                    required
                                    aria-required="true"
                                    aria-invalid={Boolean(errors.name)}
                                    aria-describedby={errors.name ? 'deletion-name-error' : undefined}
                                    className="bg-black/60 border-yellow-500/30 text-white focus-visible:ring-2 focus-visible:ring-yellow-500"
                                />
                                {errors.name && (
                                    <p id="deletion-name-error" className="text-red-400 text-xs mt-1">
                                        {errors.name}
                                    </p>
                                )}
                            </div>
                            <div>
                                <label htmlFor="deletion-email" className="block text-sm text-white mb-2">
                                    E-mail cadastrado no EventFest{' '}
                                    <span className="text-yellow-500" aria-hidden>*</span>
                                </label>
                                <Input
                                    id="deletion-email"
                                    name="email"
                                    type="email"
                                    autoComplete="email"
                                    inputMode="email"
                                    value={form.email}
                                    onChange={(e) => setForm((s) => ({ ...s, email: e.target.value }))}
                                    disabled={sending}
                                    required
                                    aria-required="true"
                                    aria-invalid={Boolean(errors.email)}
                                    aria-describedby={errors.email ? 'deletion-email-error' : undefined}
                                    className="bg-black/60 border-yellow-500/30 text-white focus-visible:ring-2 focus-visible:ring-yellow-500"
                                />
                                {errors.email && (
                                    <p id="deletion-email-error" className="text-red-400 text-xs mt-1">
                                        {errors.email}
                                    </p>
                                )}
                            </div>
                            <div>
                                <label htmlFor="deletion-reason" className="block text-sm text-white mb-2">
                                    Motivo da solicitação (opcional)
                                </label>
                                <Textarea
                                    id="deletion-reason"
                                    name="reason"
                                    value={form.reason}
                                    onChange={(e) => setForm((s) => ({ ...s, reason: e.target.value }))}
                                    disabled={sending}
                                    maxLength={2000}
                                    rows={4}
                                    className="bg-black/60 border-yellow-500/30 text-white focus-visible:ring-2 focus-visible:ring-yellow-500"
                                />
                                {errors.reason && (
                                    <p className="text-red-400 text-xs mt-1">{errors.reason}</p>
                                )}
                            </div>
                            <div>
                                <label className="flex items-start gap-3 text-sm text-gray-200 cursor-pointer">
                                    <input
                                        id="deletion-declared"
                                        type="checkbox"
                                        checked={form.declared}
                                        onChange={(e) =>
                                            setForm((s) => ({ ...s, declared: e.target.checked }))
                                        }
                                        disabled={sending}
                                        className="mt-1 h-4 w-4 accent-yellow-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-yellow-500"
                                        required
                                        aria-required="true"
                                        aria-invalid={Boolean(errors.declared)}
                                        aria-describedby={errors.declared ? 'deletion-declared-error' : undefined}
                                    />
                                    <span>
                                        Declaro que sou o titular da conta ou estou autorizado a solicitar a
                                        exclusão dos dados.
                                    </span>
                                </label>
                                {errors.declared && (
                                    <p id="deletion-declared-error" className="text-red-400 text-xs mt-1">
                                        {errors.declared}
                                    </p>
                                )}
                            </div>
                            <Button
                                type="submit"
                                disabled={sending}
                                className="w-full bg-yellow-500 text-black hover:bg-yellow-600 disabled:opacity-50"
                            >
                                {sending ? (
                                    <>
                                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                        Enviando…
                                    </>
                                ) : (
                                    'Solicitar exclusão da conta'
                                )}
                            </Button>
                            {feedback && (
                                <div
                                    role="status"
                                    className={
                                        feedback.type === 'success'
                                            ? 'rounded-xl border border-green-500/40 bg-green-950/40 p-4 text-green-100 text-sm whitespace-pre-line'
                                            : 'rounded-xl border border-red-500/40 bg-red-950/40 p-4 text-red-100 text-sm'
                                    }
                                >
                                    {feedback.text}
                                </div>
                            )}
                        </form>
                    </CardContent>
                </Card>

                <Card className={`${cardClass} mb-6`}>
                    <CardHeader>
                        <CardTitle className="text-white text-lg">Quais dados podem ser excluídos?</CardTitle>
                    </CardHeader>
                    <CardContent className="text-gray-300 text-sm sm:text-base leading-relaxed space-y-3">
                        <p>
                            A solicitação pode abranger dados associados à conta, como nome, endereço de
                            e-mail, número de telefone, identificadores da conta, informações de perfil e
                            outros dados pessoais associados ao cadastro, quando aplicável.
                        </p>
                    </CardContent>
                </Card>

                <Card className={`${cardClass} mb-6`}>
                    <CardHeader>
                        <CardTitle className="text-white text-lg">
                            Informações que podem ser mantidas
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="text-gray-300 text-sm sm:text-base leading-relaxed space-y-3">
                        <p>
                            Algumas informações poderão ser mantidas quando houver obrigação legal,
                            necessidade de cumprimento de obrigações, prevenção a fraude, segurança, defesa
                            de direitos ou outras bases legais aplicáveis. Quando a manutenção for
                            necessária, os dados serão mantidos somente pelo período aplicável.
                        </p>
                        <p className="text-gray-400">
                            Após o recebimento e a validação da solicitação, o EventFest realizará as
                            providências cabíveis dentro dos prazos aplicáveis.
                        </p>
                    </CardContent>
                </Card>

                <Card className={`${cardClass} mb-6`}>
                    <CardHeader>
                        <CardTitle className="text-white text-lg">Privacidade</CardTitle>
                    </CardHeader>
                    <CardContent className="text-gray-300 text-sm sm:text-base leading-relaxed">
                        <p className="mb-3">
                            Para saber mais sobre como o EventFest coleta, utiliza, armazena e protege seus
                            dados pessoais, consulte nossa Política de Privacidade.
                        </p>
                        <a
                            href={PRIVACY_URL}
                            className="text-yellow-500 hover:text-yellow-400 underline underline-offset-2"
                        >
                            Política de Privacidade
                        </a>
                    </CardContent>
                </Card>

                <Card className={`${cardClass} mb-10`}>
                    <CardHeader>
                        <CardTitle className="text-white text-lg">Precisa de ajuda?</CardTitle>
                    </CardHeader>
                    <CardContent className="text-gray-300 text-sm sm:text-base leading-relaxed">
                        <p className="mb-2">
                            Se você tiver dúvidas sobre a exclusão da conta ou sobre o tratamento dos seus
                            dados, entre em contato conosco.
                        </p>
                        <a
                            href={`mailto:${CONTACT_EMAIL}`}
                            className="text-yellow-500 hover:text-yellow-400 underline underline-offset-2"
                        >
                            {CONTACT_EMAIL}
                        </a>
                    </CardContent>
                </Card>
            </div>
            <footer className="border-t border-yellow-500/20 px-4 sm:px-6 py-10">
                <div className="max-w-6xl mx-auto">
                    <LandingFooter isMobile={isMobile} />
                    <div className="border-t border-yellow-500/20 pt-6 text-center">
                        <p className="text-gray-400 text-sm">© 2025 EventFest. Todos os direitos reservados.</p>
                    </div>
                </div>
            </footer>
        </div>
    );
};

export default AccountDeletionPage;
