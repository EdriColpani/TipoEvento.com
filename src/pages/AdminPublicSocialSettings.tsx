import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { ArrowLeft, Loader2, Share2, Info, Instagram, Linkedin, Phone } from 'lucide-react';
import { usePageAuth } from '@/hooks/use-page-auth';
import { useUserRole } from '@/hooks/use-user-role';
import { showError, showLoading, showSuccess, dismissToast } from '@/utils/toast';
import { useInvalidatePublicSiteContact } from '@/hooks/use-public-site-contact';
import {
    buildInstagramUrl,
    normalizeInstagramHandle,
    normalizeLinkedInUrl,
} from '@/utils/public-site-contact';
import { formatPhoneInput } from '@/utils/phone-format';
import { restGet, restPatch } from '@/utils/supabase-rest';

const ADMIN_MASTER_USER_TYPE_ID = 1;

type SocialFormState = {
    instagram_handle: string;
    linkedin_url: string;
    public_contact_phone: string;
    public_contact_label: string;
};

const DEFAULT_FORM: SocialFormState = {
    instagram_handle: 'eventfest.app',
    linkedin_url: '',
    public_contact_phone: '',
    public_contact_label: 'EventFest',
};

const AdminPublicSocialSettings: React.FC = () => {
    const navigate = useNavigate();
    const invalidateContact = useInvalidatePublicSiteContact();
    const { userId, authPending, sessionReady, bootExpired } = usePageAuth();
    const { tipoUsuarioId, isFetched: roleFetched } = useUserRole(userId);
    const [form, setForm] = useState<SocialFormState>(DEFAULT_FORM);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);

    const isAdminMaster = Number(tipoUsuarioId) === ADMIN_MASTER_USER_TYPE_ID;

    useEffect(() => {
        if (authPending) return;
        if (!userId && (sessionReady || bootExpired)) {
            showError('Sessão expirada. Faça login novamente.');
            navigate('/login');
            return;
        }

        let cancelled = false;
        const load = async () => {
            try {
                const rows = await restGet<
                    {
                        public_instagram_handle?: string | null;
                        public_linkedin_url?: string | null;
                        public_contact_phone?: string | null;
                        public_contact_label?: string | null;
                    }[]
                >(
                    'system_billing_settings?id=eq.1&select=public_instagram_handle,public_linkedin_url,public_contact_phone,public_contact_label&limit=1',
                    12_000,
                );
                const data = rows?.[0];
                if (cancelled || !data) return;
                setForm({
                    instagram_handle: String(data.public_instagram_handle ?? 'eventfest.app'),
                    linkedin_url: String(data.public_linkedin_url ?? ''),
                    public_contact_phone: data.public_contact_phone
                        ? formatPhoneInput(String(data.public_contact_phone))
                        : '',
                    public_contact_label: String(data.public_contact_label ?? 'EventFest'),
                });
            } catch (e) {
                console.warn('public social settings load failed', e);
            } finally {
                if (!cancelled) setIsLoading(false);
            }
        };
        void load();

        return () => {
            cancelled = true;
        };
    }, [authPending, userId, sessionReady, bootExpired, navigate]);

    const handleSave = async () => {
        if (!userId) {
            showError('Sessão expirada. Faça login novamente.');
            return;
        }

        const handle = normalizeInstagramHandle(form.instagram_handle);
        if (!handle) {
            showError('Informe o usuário do Instagram.');
            return;
        }

        setIsSaving(true);
        const toastId = showLoading('Salvando redes e contato público...');
        try {
            const phoneDigits = form.public_contact_phone.replace(/\D/g, '');

            await restPatch(
                'system_billing_settings?id=eq.1',
                {
                    public_instagram_handle: handle,
                    public_linkedin_url: normalizeLinkedInUrl(form.linkedin_url),
                    public_contact_phone: phoneDigits.length >= 10 ? phoneDigits : null,
                    public_contact_label: form.public_contact_label.trim() || 'EventFest',
                    updated_at: new Date().toISOString(),
                    updated_by: userId,
                },
                15_000,
            );

            invalidateContact();
            dismissToast(toastId);
            showSuccess('Redes sociais e contato público atualizados.');
        } catch (e: unknown) {
            dismissToast(toastId);
            showError(e instanceof Error ? e.message : 'Não foi possível salvar.');
        } finally {
            setIsSaving(false);
        }
    };

    if (authPending || isLoading || (userId && !roleFetched && tipoUsuarioId == null)) {
        return (
            <div className="max-w-4xl mx-auto px-4 sm:px-0 text-center py-20">
                <Loader2 className="h-10 w-10 animate-spin text-yellow-500 mx-auto mb-4" />
                <p className="text-gray-400">Carregando configurações...</p>
            </div>
        );
    }

    if (!isAdminMaster) {
        return (
            <div className="max-w-4xl mx-auto px-4 text-center py-20 text-gray-400">
                Acesso restrito ao Administrador Master.
            </div>
        );
    }

    const instagramPreview = buildInstagramUrl(form.instagram_handle);

    return (
        <div className="max-w-4xl mx-auto px-4 sm:px-0">
            <div className="flex items-center justify-between mb-8 gap-4">
                <h1 className="text-2xl sm:text-3xl font-serif text-yellow-500 flex items-center">
                    <Share2 className="h-7 w-7 mr-3 shrink-0" />
                    Redes e contato público
                </h1>
                <Button
                    type="button"
                    onClick={() => navigate('/manager/settings')}
                    variant="outline"
                    className="bg-black/60 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 text-sm shrink-0"
                >
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Voltar
                </Button>
            </div>

            <Alert className="mb-6 border-cyan-500/30 bg-cyan-500/5">
                <Info className="h-4 w-4 text-cyan-300" />
                <AlertTitle className="text-cyan-200">Site e divulgação</AlertTitle>
                <AlertDescription className="text-gray-300 text-sm">
                    Estes dados aparecem no rodapé da landing, na página de pré-lançamento e no formulário de
                    contato. Altere aqui quando mudar Instagram, LinkedIn ou telefone de atendimento ao público.
                </AlertDescription>
            </Alert>

            <Card className="bg-black border border-yellow-500/30 rounded-2xl shadow-2xl shadow-yellow-500/10">
                <CardHeader>
                    <CardTitle className="text-white text-xl font-semibold">Canais oficiais</CardTitle>
                    <CardDescription className="text-gray-400 text-sm">
                        Telefone dedicado ao público (opcional). Se vazio, usa o telefone da primeira empresa
                        cadastrada.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-5">
                    <div>
                        <label className="flex items-center gap-2 text-sm font-medium text-white mb-2">
                            <Instagram className="h-4 w-4 text-cyan-400" />
                            Instagram (usuário, sem @)
                        </label>
                        <Input
                            value={form.instagram_handle}
                            onChange={(e) =>
                                setForm((prev) => ({ ...prev, instagram_handle: e.target.value }))
                            }
                            placeholder="eventfest.app"
                            className="bg-black/60 border-yellow-500/30 text-white"
                        />
                        <p className="text-xs text-gray-500 mt-1">
                            Link: {instagramPreview}
                        </p>
                    </div>

                    <div>
                        <label className="flex items-center gap-2 text-sm font-medium text-white mb-2">
                            <Linkedin className="h-4 w-4 text-cyan-400" />
                            LinkedIn (URL completa)
                        </label>
                        <Input
                            value={form.linkedin_url}
                            onChange={(e) => setForm((prev) => ({ ...prev, linkedin_url: e.target.value }))}
                            placeholder="https://linkedin.com/company/eventfest"
                            className="bg-black/60 border-yellow-500/30 text-white"
                        />
                    </div>

                    <div>
                        <label className="flex items-center gap-2 text-sm font-medium text-white mb-2">
                            <Phone className="h-4 w-4 text-cyan-400" />
                            Telefone de contato público
                        </label>
                        <Input
                            type="tel"
                            inputMode="tel"
                            value={form.public_contact_phone}
                            onChange={(e) =>
                                setForm((prev) => ({
                                    ...prev,
                                    public_contact_phone: formatPhoneInput(e.target.value),
                                }))
                            }
                            placeholder="(46) 99999-9999"
                            className="bg-black/60 border-yellow-500/30 text-white"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-white mb-2">
                            Nome exibido no contato
                        </label>
                        <Input
                            value={form.public_contact_label}
                            onChange={(e) =>
                                setForm((prev) => ({ ...prev, public_contact_label: e.target.value }))
                            }
                            placeholder="EventFest"
                            className="bg-black/60 border-yellow-500/30 text-white"
                        />
                    </div>

                    <Button
                        type="button"
                        onClick={() => void handleSave()}
                        disabled={isSaving}
                        className="bg-yellow-500 text-black hover:bg-yellow-400 disabled:opacity-50"
                    >
                        {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                        Salvar configuração
                    </Button>
                </CardContent>
            </Card>
        </div>
    );
};

export default AdminPublicSocialSettings;
