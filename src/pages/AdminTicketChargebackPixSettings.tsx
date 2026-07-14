import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, KeyRound, Loader2, Phone } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { usePageAuth } from '@/hooks/use-page-auth';
import { useProfile } from '@/hooks/use-profile';
import { callRpcRest } from '@/utils/supabase-rest-rpc';
import { showError, showSuccess } from '@/utils/toast';
import { formatPhoneDisplay } from '@/hooks/use-company-ticket-chargeback-block';

const ADMIN_MASTER_USER_TYPE_ID = 1;

type PixForm = {
    pix_key: string;
    pix_holder: string;
    instructions: string;
};

const AdminTicketChargebackPixSettings: React.FC = () => {
    const navigate = useNavigate();
    const { userId, authPending, sessionReady, bootExpired } = usePageAuth();
    const { profile, isLoading: isLoadingProfile } = useProfile(userId);
    const isAdminMaster = Number(profile?.tipo_usuario_id) === ADMIN_MASTER_USER_TYPE_ID;

    const [form, setForm] = useState<PixForm>({ pix_key: '', pix_holder: '', instructions: '' });
    const [contactPhone, setContactPhone] = useState<string>('');
    const [contactLabel, setContactLabel] = useState<string>('EventFest');
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        if (authPending) return;
        if (!userId && (sessionReady || bootExpired)) {
            showError('Sessão expirada. Faça login novamente.');
            navigate('/login');
        }
    }, [authPending, userId, sessionReady, bootExpired, navigate]);

    useEffect(() => {
        if (!isAdminMaster || isLoadingProfile) return;

        let cancelled = false;
        (async () => {
            try {
                const [pix, contact] = await Promise.all([
                    callRpcRest<{
                        pix_key?: string | null;
                        pix_holder?: string | null;
                        instructions?: string | null;
                    }>('get_ticket_chargeback_payment_instructions', {}, 15_000),
                    callRpcRest<{
                        phone?: string | null;
                        company_name?: string | null;
                    }>('get_public_contact_info', {}, 15_000),
                ]);
                if (cancelled) return;
                setForm({
                    pix_key: pix?.pix_key ?? '',
                    pix_holder: pix?.pix_holder ?? '',
                    instructions: pix?.instructions ?? '',
                });
                setContactPhone(String(contact?.phone ?? ''));
                setContactLabel(String(contact?.company_name ?? 'EventFest'));
            } catch (e) {
                showError(e instanceof Error ? e.message : 'Falha ao carregar chave PIX.');
            } finally {
                if (!cancelled) setIsLoading(false);
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [isAdminMaster, isLoadingProfile]);

    const handleSave = async () => {
        setIsSaving(true);
        try {
            await callRpcRest(
                'admin_update_ticket_chargeback_payment_instructions',
                {
                    p_pix_key: form.pix_key,
                    p_pix_holder: form.pix_holder,
                    p_instructions: form.instructions,
                },
                20_000,
            );
            showSuccess('Chave PIX de chargeback salva.');
        } catch (e) {
            showError(e instanceof Error ? e.message : 'Falha ao salvar.');
        } finally {
            setIsSaving(false);
        }
    };

    if (authPending || isLoadingProfile || (isAdminMaster && isLoading)) {
        return (
            <div className="max-w-3xl mx-auto text-center py-20">
                <Loader2 className="h-10 w-10 animate-spin text-yellow-500 mx-auto mb-4" />
                <p className="text-gray-400">Carregando…</p>
            </div>
        );
    }

    if (!isAdminMaster) {
        return (
            <div className="max-w-3xl mx-auto text-center py-16 text-gray-400">
                Apenas Admin Master pode configurar a chave PIX de chargeback.
                <Button
                    variant="outline"
                    className="mt-4 block mx-auto bg-black/60 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10"
                    onClick={() => navigate('/manager/settings')}
                >
                    Voltar
                </Button>
            </div>
        );
    }

    const phoneDisplay = formatPhoneDisplay(contactPhone);

    return (
        <div className="max-w-3xl mx-auto">
            <div className="flex items-center gap-4 mb-6">
                <Button variant="ghost" className="text-gray-400" onClick={() => navigate('/manager/settings')}>
                    <ArrowLeft className="h-4 w-4 mr-1" /> Configurações
                </Button>
                <h1 className="text-2xl font-serif text-yellow-500 flex items-center gap-2">
                    <KeyRound className="h-6 w-6" />
                    Chave PIX — chargeback
                </h1>
            </div>

            <Alert className="mb-6 border-cyan-500/30 bg-cyan-950/40 text-cyan-50">
                <Phone className="h-4 w-4 text-cyan-300" />
                <AlertTitle className="text-cyan-100">Telefone de contato</AlertTitle>
                <AlertDescription className="text-cyan-50/90 text-sm space-y-2">
                    <p>
                        O telefone exibido aos gestores (chargeback / WhatsApp) e na landing é o mesmo cadastro de{' '}
                        <strong>Redes e contato público</strong>.
                    </p>
                    {phoneDisplay ? (
                        <p>
                            Atual: <strong className="text-yellow-400">{phoneDisplay}</strong>
                            {contactLabel ? ` (${contactLabel})` : ''}
                        </p>
                    ) : (
                        <p className="text-amber-200/90">
                            Ainda não há telefone público configurado. Cadastre em Redes e contato público.
                        </p>
                    )}
                    <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="bg-black/60 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 hover:text-yellow-400"
                        asChild
                    >
                        <Link to="/admin/settings/public-social">Abrir redes e contato público</Link>
                    </Button>
                </AlertDescription>
            </Alert>

            <Card className="bg-black border-yellow-500/30">
                <CardHeader>
                    <CardTitle className="text-white">Chave PIX EventFest</CardTitle>
                    <CardDescription className="text-gray-400">
                        Usada pelos gestores (plano só ingresso) para devolver valores de chargeback. Aparece no
                        painel de chargebacks e nos avisos de bloqueio.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div>
                        <Label className="text-gray-300">Recebedor</Label>
                        <Input
                            value={form.pix_holder}
                            onChange={(e) => setForm((f) => ({ ...f, pix_holder: e.target.value }))}
                            className="bg-black border-yellow-500/30 text-white mt-1"
                            placeholder="EventFest / razão social"
                        />
                    </div>
                    <div>
                        <Label className="text-gray-300">Chave PIX</Label>
                        <Input
                            value={form.pix_key}
                            onChange={(e) => setForm((f) => ({ ...f, pix_key: e.target.value }))}
                            className="bg-black border-yellow-500/30 text-white mt-1"
                            placeholder="e-mail, CPF/CNPJ ou chave aleatória"
                        />
                    </div>
                    <div>
                        <Label className="text-gray-300">Instruções extras (opcional)</Label>
                        <Input
                            value={form.instructions}
                            onChange={(e) => setForm((f) => ({ ...f, instructions: e.target.value }))}
                            className="bg-black border-yellow-500/30 text-white mt-1"
                            placeholder="Banco, TED, e-mail para comprovante…"
                        />
                    </div>
                    <Button
                        type="button"
                        disabled={isSaving}
                        className="bg-yellow-500 text-black hover:bg-yellow-600 disabled:opacity-50"
                        onClick={() => void handleSave()}
                    >
                        {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                        Salvar chave PIX
                    </Button>
                </CardContent>
            </Card>
        </div>
    );
};

export default AdminTicketChargebackPixSettings;
