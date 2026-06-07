import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
    ArrowLeft,
    Copy,
    Gift,
    Loader2,
    Mail,
    MessageCircle,
    Trash2,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useEventBatchInventorySummary } from '@/hooks/use-event-batch-inventory-summary';
import { showError, showLoading, showSuccess, dismissToast } from '@/utils/toast';
import { buildComplimentaryBundleUrl } from '@/utils/public-app-url';
import { buildBundleWhatsAppMessage } from '@/utils/complimentary-share-text';
import { copyTextToClipboard } from '@/utils/copy-to-clipboard';

type ComplimentaryBundleRow = {
    id: string;
    recipient_name: string;
    recipient_email: string | null;
    quantity: number;
    public_token: string;
    status: string;
    expires_at: string;
    created_at: string;
    batch_name: string;
    redeemed_count: number;
    available_count: number;
    holder_claimed: boolean;
    email_sent_at: string | null;
};

async function fetchBundles(eventId: string): Promise<ComplimentaryBundleRow[]> {
    const { data, error } = await supabase.rpc('list_complimentary_bundles', {
        p_event_id: eventId,
    });
    if (error) throw error;
    const payload = data as { ok?: boolean; bundles?: ComplimentaryBundleRow[]; error?: string };
    if (!payload?.ok) {
        throw new Error(payload?.error ?? 'Erro ao listar pacotes.');
    }
    return payload.bundles ?? [];
}

/** Mesmo padrão de campos escuros do gestor (EventFormSteps). */
const MANAGER_FIELD_CLASS =
    'bg-black/60 border-yellow-500/30 text-white placeholder:text-gray-500 focus:border-yellow-500 focus-visible:ring-yellow-500/30';

const statusLabel: Record<string, string> = {
    active: 'Ativo',
    expired: 'Expirado',
    cancelled: 'Cancelado',
    fully_redeemed: 'Totalmente resgatado',
};

const ManagerComplimentaryBundles: React.FC = () => {
    const { eventId } = useParams<{ eventId: string }>();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const { data: inventory, isLoading: loadingInventory } = useEventBatchInventorySummary(eventId);

    const [recipientName, setRecipientName] = useState('');
    const [recipientEmail, setRecipientEmail] = useState('');
    const [batchId, setBatchId] = useState('');
    const [quantity, setQuantity] = useState('1');
    const [expiresDays, setExpiresDays] = useState('30');
    const [notes, setNotes] = useState('');
    const [isCreating, setIsCreating] = useState(false);

    const freeBatches = useMemo(
        () => (inventory?.batches ?? []).filter((b) => b.price === 0 && b.available > 0),
        [inventory],
    );

    useEffect(() => {
        if (!batchId && freeBatches.length > 0) {
            setBatchId(freeBatches[0].batch_id);
        }
    }, [batchId, freeBatches]);

    const bundlesQuery = useQuery({
        queryKey: ['complimentaryBundles', eventId],
        enabled: Boolean(eventId),
        queryFn: () => fetchBundles(eventId!),
    });

    const copyText = async (text: string, label: string) => {
        const ok = await copyTextToClipboard(text);
        if (ok) {
            showSuccess(`${label} copiado.`);
        } else {
            showError('Não foi possível copiar. Selecione o link abaixo e copie manualmente.');
        }
    };

    const sendBundleEmail = async (bundle: ComplimentaryBundleRow) => {
        if (!bundle.recipient_email) {
            showError('Este pacote não tem e-mail do destinatário.');
            return;
        }
        const bundleUrl = buildComplimentaryBundleUrl(bundle.public_token);
        const url = import.meta.env.VITE_SUPABASE_URL;
        const anon =
            import.meta.env.VITE_SUPABASE_ANON_KEY ||
            import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
        if (!url || !anon) {
            showError('Configuração de e-mail indisponível no ambiente.');
            return;
        }
        const toastId = showLoading('Enviando e-mail…');
        try {
            const res = await fetch(`${url}/functions/v1/send-complimentary-bundle-email`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${anon}`,
                    apikey: anon,
                },
                body: JSON.stringify({
                    bundleId: bundle.id,
                    email: bundle.recipient_email,
                    recipientName: bundle.recipient_name,
                    eventTitle: inventory?.event_title ?? 'Evento',
                    batchName: bundle.batch_name,
                    quantity: bundle.quantity,
                    bundleUrl,
                    expiresAt: bundle.expires_at,
                }),
            });
            const result = (await res.json().catch(() => ({}))) as {
                success?: boolean;
                already_sent?: boolean;
                error?: string;
            };
            dismissToast(toastId);
            if (result.success) {
                showSuccess(result.already_sent ? 'E-mail já havia sido enviado.' : 'E-mail enviado.');
                void queryClient.invalidateQueries({ queryKey: ['complimentaryBundles', eventId] });
            } else {
                showError('Não foi possível enviar o e-mail.');
            }
        } catch {
            dismissToast(toastId);
            showError('Erro ao enviar e-mail.');
        }
    };

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!eventId || !batchId) return;

        const qty = parseInt(quantity, 10);
        const days = parseInt(expiresDays, 10);
        if (!recipientName.trim()) {
            showError('Informe o nome do destinatário.');
            return;
        }
        if (!Number.isFinite(qty) || qty < 1 || qty > 50) {
            showError('Quantidade deve ser entre 1 e 50.');
            return;
        }

        setIsCreating(true);
        try {
            const { data, error } = await supabase.rpc('create_complimentary_bundle', {
                p_event_id: eventId,
                p_batch_id: batchId,
                p_recipient_name: recipientName.trim(),
                p_recipient_email: recipientEmail.trim() || null,
                p_quantity: qty,
                p_expires_days: Number.isFinite(days) ? days : 30,
                p_notes: notes.trim() || null,
            });
            if (error) throw error;

            const result = data as {
                ok?: boolean;
                error?: string;
                public_token?: string;
                available?: number;
            };
            if (!result?.ok) {
                if (result?.error === 'insufficient_stock') {
                    showError(`Estoque insuficiente. Disponível: ${result.available ?? 0}.`);
                } else {
                    showError('Não foi possível criar o pacote cortesia.');
                }
                return;
            }

            showSuccess('Pacote cortesia criado. Copie o link ou envie por e-mail/WhatsApp.');
            setRecipientName('');
            setRecipientEmail('');
            setQuantity('1');
            setNotes('');
            void queryClient.invalidateQueries({ queryKey: ['complimentaryBundles', eventId] });
            void queryClient.invalidateQueries({ queryKey: ['eventBatchInventorySummary', eventId] });

            if (result.public_token) {
                await copyText(buildComplimentaryBundleUrl(result.public_token), 'Link do pacote');
            }
        } catch (err) {
            showError(err instanceof Error ? err.message : 'Erro ao criar pacote.');
        } finally {
            setIsCreating(false);
        }
    };

    const handleResetHolder = async (bundle: ComplimentaryBundleRow) => {
        if (
            !window.confirm(
                `Liberar o vínculo do pacote de "${bundle.recipient_name}"? ` +
                    'Outra conta poderá acessar o link e distribuir os ingressos.',
            )
        ) {
            return;
        }
        const { data, error } = await supabase.rpc('reset_complimentary_bundle_holder', {
            p_bundle_id: bundle.id,
        });
        const payload = data as { ok?: boolean; error?: string; redeemed_count?: number };
        if (error || !payload?.ok) {
            if (payload?.error === 'seats_already_redeemed') {
                showError('Não é possível liberar: já há ingressos resgatados deste pacote.');
            } else {
                showError('Não foi possível liberar o vínculo.');
            }
            return;
        }
        showSuccess('Vínculo liberado. Envie o link novamente ao destinatário.');
        void queryClient.invalidateQueries({ queryKey: ['complimentaryBundles', eventId] });
    };

    const handleCancel = async (bundleId: string) => {
        if (!window.confirm('Cancelar este pacote e liberar o estoque não resgatado?')) return;
        const { data, error } = await supabase.rpc('cancel_complimentary_bundle', {
            p_bundle_id: bundleId,
        });
        if (error || !(data as { ok?: boolean })?.ok) {
            showError('Não foi possível cancelar o pacote.');
            return;
        }
        showSuccess('Pacote cancelado.');
        void queryClient.invalidateQueries({ queryKey: ['complimentaryBundles', eventId] });
        void queryClient.invalidateQueries({ queryKey: ['eventBatchInventorySummary', eventId] });
    };

    if (loadingInventory || !eventId) {
        return (
            <div className="max-w-4xl mx-auto py-20 text-center">
                <Loader2 className="h-8 w-8 animate-spin text-yellow-500 mx-auto mb-4" />
                <p className="text-gray-400">Carregando…</p>
            </div>
        );
    }

    if (inventory?.inventory_mode !== 'counter') {
        return (
            <div className="max-w-4xl mx-auto py-10">
                <p className="text-gray-300">Pacotes cortesia disponíveis apenas em eventos de grande porte.</p>
                <Button className="mt-4" variant="outline" onClick={() => navigate('/manager/events')}>
                    Voltar
                </Button>
            </div>
        );
    }

    return (
        <div className="max-w-4xl mx-auto space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                <div>
                    <Button
                        variant="ghost"
                        className="text-yellow-500 hover:text-yellow-400 px-0 mb-2"
                        onClick={() => navigate(`/manager/events/edit/${eventId}`)}
                    >
                        <ArrowLeft className="h-4 w-4 mr-2" />
                        Voltar ao evento
                    </Button>
                    <h1 className="text-2xl font-serif text-yellow-500 flex items-center gap-2">
                        <Gift className="h-7 w-7" />
                        Pacotes cortesia
                    </h1>
                    <p className="text-gray-400 text-sm mt-1">{inventory.event_title}</p>
                </div>
                <Button
                    variant="outline"
                    className="border-cyan-500/30 text-cyan-300 shrink-0"
                    onClick={() => navigate('/manager/reports/complimentary-bundles')}
                >
                    Ver relatório
                </Button>
            </div>

            <Card className="bg-black border border-yellow-500/30">
                <CardHeader>
                    <CardTitle className="text-white text-lg">Novo pacote</CardTitle>
                    <p className="text-sm text-gray-400">
                        Crie um pacote com vários ingressos e envie <strong className="text-gray-200">um único link</strong> ao
                        destinatário. Ele distribui os ingressos individuais para família ou convidados.
                    </p>
                </CardHeader>
                <CardContent>
                    {freeBatches.length === 0 ? (
                        <p className="text-amber-300 text-sm rounded-lg border border-amber-500/30 bg-amber-950/30 p-4">
                            Nenhum lote gratuito com estoque disponível. Cadastre um lote com preço R$ 0,00 (ex.: Staff) na
                            edição do evento.
                        </p>
                    ) : (
                        <form onSubmit={handleCreate} className="space-y-4 [&_label]:text-gray-200">
                            <div className="grid sm:grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label htmlFor="batch" className="text-gray-200">Lote cortesia</Label>
                                    <Select value={batchId} onValueChange={setBatchId}>
                                        <SelectTrigger id="batch" className={MANAGER_FIELD_CLASS}>
                                            <SelectValue placeholder="Selecione" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {freeBatches.map((b) => (
                                                <SelectItem key={b.batch_id} value={b.batch_id}>
                                                    {b.name} — disp. {b.available.toLocaleString('pt-BR')}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="quantity" className="text-gray-200">Quantidade de ingressos</Label>
                                    <Input
                                        id="quantity"
                                        type="number"
                                        min={1}
                                        max={50}
                                        value={quantity}
                                        onChange={(e) => setQuantity(e.target.value)}
                                        className={MANAGER_FIELD_CLASS}
                                    />
                                </div>
                            </div>
                            <div className="grid sm:grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label htmlFor="recipientName" className="text-gray-200">Nome do destinatário</Label>
                                    <Input
                                        id="recipientName"
                                        value={recipientName}
                                        onChange={(e) => setRecipientName(e.target.value)}
                                        placeholder="Ex.: João Silva"
                                        className={MANAGER_FIELD_CLASS}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="recipientEmail" className="text-gray-200">E-mail (opcional)</Label>
                                    <Input
                                        id="recipientEmail"
                                        type="email"
                                        value={recipientEmail}
                                        onChange={(e) => setRecipientEmail(e.target.value)}
                                        placeholder="Para restringir quem abre o pacote"
                                        className={MANAGER_FIELD_CLASS}
                                    />
                                </div>
                            </div>
                            <div className="grid sm:grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label htmlFor="expiresDays" className="text-gray-200">Validade (dias)</Label>
                                    <Input
                                        id="expiresDays"
                                        type="number"
                                        min={1}
                                        max={365}
                                        value={expiresDays}
                                        onChange={(e) => setExpiresDays(e.target.value)}
                                        className={MANAGER_FIELD_CLASS}
                                    />
                                </div>
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="notes" className="text-gray-200">Observações internas (opcional)</Label>
                                <Textarea
                                    id="notes"
                                    value={notes}
                                    onChange={(e) => setNotes(e.target.value)}
                                    className={MANAGER_FIELD_CLASS}
                                    rows={2}
                                />
                            </div>
                            <Button
                                type="submit"
                                disabled={isCreating}
                                className="bg-yellow-500 text-black hover:bg-yellow-600"
                            >
                                {isCreating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                                Criar pacote e copiar link
                            </Button>
                        </form>
                    )}
                </CardContent>
            </Card>

            <Card className="bg-black border border-yellow-500/20">
                <CardHeader>
                    <CardTitle className="text-white text-lg">Pacotes enviados</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    {bundlesQuery.isLoading ? (
                        <div className="text-center py-8">
                            <Loader2 className="h-6 w-6 animate-spin text-yellow-500 mx-auto" />
                        </div>
                    ) : (bundlesQuery.data ?? []).length === 0 ? (
                        <p className="text-gray-500 text-sm">Nenhum pacote criado ainda.</p>
                    ) : (
                        (bundlesQuery.data ?? []).map((bundle) => {
                            const link = buildComplimentaryBundleUrl(bundle.public_token);
                            const whatsapp = buildBundleWhatsAppMessage({
                                recipientName: bundle.recipient_name,
                                eventTitle: inventory.event_title,
                                quantity: bundle.quantity,
                                batchName: bundle.batch_name,
                                publicToken: bundle.public_token,
                                expiresAt: bundle.expires_at,
                            });
                            return (
                                <div
                                    key={bundle.id}
                                    className="rounded-xl border border-yellow-500/20 bg-black/40 p-4 space-y-3"
                                >
                                    <div className="flex flex-wrap items-start justify-between gap-2">
                                        <div>
                                            <p className="text-white font-medium">{bundle.recipient_name}</p>
                                            <p className="text-xs text-gray-400">
                                                {bundle.batch_name} · {bundle.quantity} ingresso(s) ·{' '}
                                                {bundle.redeemed_count}/{bundle.quantity} resgatados
                                            </p>
                                            <p className="text-xs text-gray-500 mt-1">
                                                {statusLabel[bundle.status] ?? bundle.status}
                                                {bundle.holder_claimed ? ' · Destinatário já acessou' : ''}
                                                {bundle.email_sent_at ? ' · E-mail enviado' : ''}
                                            </p>
                                        </div>
                                        {bundle.status === 'active' && (
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                className="border-red-500/40 text-red-400 hover:bg-red-950/30"
                                                onClick={() => void handleCancel(bundle.id)}
                                            >
                                                <Trash2 className="h-4 w-4 mr-1" />
                                                Cancelar
                                            </Button>
                                        )}
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                        {bundle.status === 'active' && bundle.holder_claimed && bundle.redeemed_count === 0 && (
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                className="border-cyan-500/40 text-cyan-300 hover:bg-cyan-950/30"
                                                onClick={() => void handleResetHolder(bundle)}
                                            >
                                                Liberar vínculo
                                            </Button>
                                        )}
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            className="border-yellow-500/30 text-yellow-500"
                                            onClick={() => void copyText(link, 'Link do pacote')}
                                        >
                                            <Copy className="h-4 w-4 mr-1" />
                                            Copiar link
                                        </Button>
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            className="border-green-500/30 text-green-400"
                                            onClick={() => void copyText(whatsapp, 'Mensagem WhatsApp')}
                                        >
                                            <MessageCircle className="h-4 w-4 mr-1" />
                                            Copiar WhatsApp
                                        </Button>
                                        {bundle.recipient_email && bundle.status === 'active' && (
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                className="border-cyan-500/30 text-cyan-300"
                                                onClick={() => void sendBundleEmail(bundle)}
                                            >
                                                <Mail className="h-4 w-4 mr-1" />
                                                Enviar e-mail
                                            </Button>
                                        )}
                                    </div>
                                    <p className="text-[11px] text-gray-400 break-all select-all">{link}</p>
                                </div>
                            );
                        })
                    )}
                </CardContent>
            </Card>
        </div>
    );
};

export default ManagerComplimentaryBundles;
