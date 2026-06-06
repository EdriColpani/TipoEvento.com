import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Copy, Gift, Loader2, LogIn, MessageCircle, UserPlus } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { showError, showSuccess } from '@/utils/toast';
import { buildComplimentarySeatUrl } from '@/utils/public-app-url';
import { buildSeatWhatsAppMessage } from '@/utils/complimentary-share-text';
import { copyTextToClipboard } from '@/utils/copy-to-clipboard';
import { parseEventLocalDay } from '@/utils/format-event-date';
import { saveComplimentaryReturnPath } from '@/utils/complimentary-auth-return';
import { useProfile } from '@/hooks/use-profile';

type BundlePublic = {
    ok: boolean;
    error?: string;
    bundle_id?: string;
    public_token?: string;
    status?: string;
    recipient_name?: string;
    quantity?: number;
    redeemed_count?: number;
    available_count?: number;
    expires_at?: string;
    holder_claimed?: boolean;
    is_holder?: boolean;
    batch_name?: string;
    event_id?: string;
    event_title?: string;
    event_date?: string;
    event_location?: string;
};

type HolderSeat = {
    seat_number: number;
    status: string;
    redeem_token: string;
    redeemed_at?: string | null;
};

type HolderView = {
    ok: boolean;
    error?: string;
    public_token?: string;
    status?: string;
    recipient_name?: string;
    quantity?: number;
    batch_name?: string;
    event_title?: string;
    event_date?: string;
    expires_at?: string;
    seats?: HolderSeat[];
};

const statusMessages: Record<string, string> = {
    expired: 'Este pacote expirou.',
    cancelled: 'Este pacote foi cancelado.',
    fully_redeemed: 'Todos os ingressos deste pacote já foram resgatados.',
};

const ComplimentaryBundlePage: React.FC = () => {
    const [searchParams] = useSearchParams();
    const token = searchParams.get('token')?.trim() ?? '';
    const navigate = useNavigate();

    const [loading, setLoading] = useState(true);
    const [claiming, setClaiming] = useState(false);
    const [bundle, setBundle] = useState<BundlePublic | null>(null);
    const [holderView, setHolderView] = useState<HolderView | null>(null);
    const [userId, setUserId] = useState<string | null>(null);

    const { profile } = useProfile(userId ?? undefined);
    const isManagerAccount = profile?.tipo_usuario_id === 2;

    const returnPath = useMemo(
        () => (token ? `/cortesia/pacote?token=${encodeURIComponent(token)}` : '/'),
        [token],
    );

    const loadBundle = useCallback(async () => {
        if (!token) {
            setLoading(false);
            return;
        }
        const { data, error } = await supabase.rpc('get_complimentary_bundle_public', {
            p_public_token: token,
        });
        if (error) {
            showError('Não foi possível carregar o pacote.');
            setLoading(false);
            return;
        }
        const payload = data as BundlePublic;
        setBundle(payload);
        setLoading(false);
    }, [token]);

    const loadHolderView = useCallback(async () => {
        if (!token) return;
        const { data, error } = await supabase.rpc('get_complimentary_bundle_holder_view', {
            p_public_token: token,
        });
        if (error) return;
        const payload = data as HolderView;
        if (payload.ok) {
            setHolderView(payload);
        }
    }, [token]);

    useEffect(() => {
        if (token) {
            saveComplimentaryReturnPath(`/cortesia/pacote?token=${encodeURIComponent(token)}`);
        }
    }, [token]);

    useEffect(() => {
        void supabase.auth.getUser().then(({ data: { user } }) => {
            setUserId(user?.id ?? null);
        });
        const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
            setUserId(session?.user?.id ?? null);
        });
        return () => authListener.subscription.unsubscribe();
    }, []);

    useEffect(() => {
        void loadBundle();
    }, [loadBundle]);

    useEffect(() => {
        if (userId && token) {
            void loadBundle();
        }
    }, [userId, token, loadBundle]);

    useEffect(() => {
        if (bundle?.is_holder && token) {
            void loadHolderView();
        }
    }, [bundle?.is_holder, token, loadHolderView]);

    const handleClaimHolder = async () => {
        if (!token) return;
        setClaiming(true);
        try {
            const { data, error } = await supabase.rpc('claim_complimentary_bundle_holder', {
                p_public_token: token,
            });
            if (error) throw error;
            const payload = data as HolderView & { error?: string };
            if (!payload.ok) {
                if (payload.error === 'email_mismatch') {
                    showError('Entre com o e-mail indicado pelo organizador do evento.');
                } else if (payload.error === 'holder_already_claimed') {
                    showError('Este pacote já foi vinculado a outra conta.');
                } else {
                    showError('Não foi possível acessar o pacote.');
                }
                return;
            }
            setHolderView(payload);
            setBundle((prev) => (prev ? { ...prev, is_holder: true, holder_claimed: true } : prev));
            showSuccess('Pacote liberado. Compartilhe os links abaixo.');
        } catch {
            showError('Erro ao acessar pacote.');
        } finally {
            setClaiming(false);
        }
    };

    const copyText = async (text: string) => {
        const ok = await copyTextToClipboard(text);
        if (ok) {
            showSuccess('Copiado.');
        } else {
            showError('Não foi possível copiar. Selecione o link e copie manualmente.');
        }
    };

    if (!token) {
        return (
            <div className="min-h-[60vh] flex items-center justify-center px-4">
                <p className="text-gray-400">Link inválido. Verifique o endereço enviado pelo organizador.</p>
            </div>
        );
    }

    if (loading) {
        return (
            <div className="min-h-[60vh] flex items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-yellow-500" />
            </div>
        );
    }

    if (!bundle?.ok) {
        return (
            <div className="min-h-[60vh] flex items-center justify-center px-4">
                <p className="text-gray-400">Pacote não encontrado ou link inválido.</p>
            </div>
        );
    }

    const eventDateLabel = bundle.event_date
        ? parseEventLocalDay(bundle.event_date)?.toLocaleDateString('pt-BR') ?? bundle.event_date
        : '';

    const inactiveMessage = bundle.status && bundle.status !== 'active' ? statusMessages[bundle.status] : null;

    return (
        <div className="max-w-2xl mx-auto py-8 px-4 space-y-6">
            <div className="text-center space-y-2">
                <Gift className="h-10 w-10 text-yellow-500 mx-auto" />
                <h1 className="text-2xl font-serif text-yellow-500">Pacote cortesia</h1>
                <p className="text-gray-300 text-sm">
                    Olá, <span className="text-white font-medium">{bundle.recipient_name}</span>
                </p>
            </div>

            <Card className="bg-black/80 border border-yellow-500/30">
                <CardHeader>
                    <CardTitle className="text-white text-lg">{bundle.event_title}</CardTitle>
                    <p className="text-sm text-gray-400">
                        {bundle.batch_name} · {bundle.quantity} ingresso(s)
                        {eventDateLabel ? ` · ${eventDateLabel}` : ''}
                        {bundle.event_location ? ` · ${bundle.event_location}` : ''}
                    </p>
                    <p className="text-xs text-gray-500">
                        Resgatados: {bundle.redeemed_count}/{bundle.quantity}
                        {bundle.expires_at
                            ? ` · Válido até ${new Date(bundle.expires_at).toLocaleDateString('pt-BR')}`
                            : ''}
                    </p>
                </CardHeader>
                <CardContent className="space-y-4">
                    {inactiveMessage && (
                        <p className="text-amber-300 text-sm rounded-lg border border-amber-500/30 bg-amber-950/30 p-3">
                            {inactiveMessage}
                        </p>
                    )}

                    {isManagerAccount && userId && bundle.status === 'active' && (
                        <p className="text-cyan-200/90 text-xs rounded-lg border border-cyan-500/30 bg-cyan-950/30 p-3">
                            Você entrou com conta de gestor. Use esta tela para distribuir cortesias deste pacote.
                            Após cada convidado resgatar, o ingresso dele aparece em{' '}
                            <strong className="text-white">Meus Ingressos</strong> na conta dele — o seu ingresso
                            pessoal (se resgatar um link individual) também ficará em Meus Ingressos.
                        </p>
                    )}

                    {!userId && bundle.status === 'active' && (
                        <div className="rounded-xl border border-cyan-500/30 bg-cyan-950/30 p-4 space-y-3">
                            <p className="text-sm text-cyan-100">
                                Entre com sua conta EventFest para gerenciar e distribuir os ingressos deste pacote.
                            </p>
                            <div className="flex flex-wrap gap-2">
                                <Button
                                    className="bg-yellow-500 text-black hover:bg-yellow-600"
                                    onClick={() => navigate('/login', { state: { from: returnPath } })}
                                >
                                    <LogIn className="h-4 w-4 mr-2" />
                                    Entrar
                                </Button>
                                <Button variant="outline" className="border-yellow-500/30 text-yellow-500" asChild>
                                    <Link to="/register" state={{ from: returnPath }}>
                                        <UserPlus className="h-4 w-4 mr-2" />
                                        Criar conta
                                    </Link>
                                </Button>
                            </div>
                        </div>
                    )}

                    {userId && !bundle.is_holder && !holderView?.ok && bundle.status === 'active' && (
                        <Button
                            className="w-full bg-yellow-500 text-black hover:bg-yellow-600"
                            disabled={claiming}
                            onClick={() => void handleClaimHolder()}
                        >
                            {claiming ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                            Acessar pacote e distribuir ingressos
                        </Button>
                    )}

                    {holderView?.ok && holderView.seats && (
                        <div className="space-y-3">
                            <p className="text-sm text-gray-300">
                                Compartilhe um link por pessoa. Cada convidado deve entrar com a própria conta para
                                resgatar o ingresso.
                            </p>
                            {holderView.seats.map((seat) => {
                                if (seat.status !== 'available') {
                                    return (
                                        <div
                                            key={seat.seat_number}
                                            className="rounded-lg border border-gray-700/50 bg-black/40 p-3 text-sm text-gray-500"
                                        >
                                            Ingresso {seat.seat_number} — já resgatado
                                        </div>
                                    );
                                }
                                const seatUrl = buildComplimentarySeatUrl(seat.redeem_token);
                                const whatsapp = buildSeatWhatsAppMessage({
                                    eventTitle: bundle.event_title ?? 'Evento',
                                    batchName: bundle.batch_name ?? 'Cortesia',
                                    seatNumber: seat.seat_number,
                                    redeemToken: seat.redeem_token,
                                });
                                return (
                                    <div
                                        key={seat.seat_number}
                                        className="rounded-lg border border-yellow-500/20 bg-black/40 p-3 space-y-2"
                                    >
                                        <p className="text-white text-sm font-medium">
                                            Ingresso {seat.seat_number} de {bundle.quantity}
                                        </p>
                                        <div className="flex flex-wrap gap-2">
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                className="border-yellow-500/30 text-yellow-500"
                                                onClick={() => void copyText(seatUrl)}
                                            >
                                                <Copy className="h-4 w-4 mr-1" />
                                                Copiar link
                                            </Button>
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                className="border-green-500/30 text-green-400"
                                                onClick={() => void copyText(whatsapp)}
                                            >
                                                <MessageCircle className="h-4 w-4 mr-1" />
                                                WhatsApp
                                            </Button>
                                        </div>
                                        <p className="text-[10px] text-gray-400 break-all select-all">{seatUrl}</p>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
};

export default ComplimentaryBundlePage;
