import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import QRCode from 'react-qr-code';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, LogIn, Ticket, UserPlus } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { showError, showSuccess } from '@/utils/toast';
import { parseEventLocalDay } from '@/utils/format-event-date';

type SeatPublic = {
    ok: boolean;
    error?: string;
    seat_number?: number;
    seat_status?: string;
    bundle_status?: string;
    batch_name?: string;
    event_id?: string;
    event_title?: string;
    event_date?: string;
    event_location?: string;
    expires_at?: string;
    already_redeemed?: boolean;
};

type RedeemResult = {
    ok: boolean;
    error?: string;
    analytics_id?: string;
    code_wristbands?: string;
    access_type?: string;
    event_id?: string;
    event_title?: string;
    event_date?: string;
    event_location?: string;
    batch_name?: string;
};

const ComplimentarySeatRedeemPage: React.FC = () => {
    const [searchParams] = useSearchParams();
    const token = searchParams.get('token')?.trim() ?? '';
    const navigate = useNavigate();

    const [loading, setLoading] = useState(true);
    const [redeeming, setRedeeming] = useState(false);
    const [seat, setSeat] = useState<SeatPublic | null>(null);
    const [redeemed, setRedeemed] = useState<RedeemResult | null>(null);
    const [userId, setUserId] = useState<string | null>(null);

    const returnPath = useMemo(
        () => (token ? `/cortesia/resgatar?token=${encodeURIComponent(token)}` : '/'),
        [token],
    );

    const loadSeat = useCallback(async () => {
        if (!token) {
            setLoading(false);
            return;
        }
        const { data, error } = await supabase.rpc('get_complimentary_seat_public', {
            p_redeem_token: token,
        });
        if (error) {
            showError('Não foi possível carregar o ingresso.');
            setLoading(false);
            return;
        }
        setSeat(data as SeatPublic);
        setLoading(false);
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
        void loadSeat();
    }, [loadSeat]);

    const handleRedeem = async () => {
        if (!token) return;
        setRedeeming(true);
        try {
            const { data, error } = await supabase.rpc('redeem_complimentary_seat', {
                p_redeem_token: token,
            });
            if (error) throw error;
            const result = data as RedeemResult;
            if (!result.ok) {
                if (result.error === 'already_redeemed') {
                    showError('Este ingresso já foi resgatado.');
                } else if (result.error === 'bundle_not_active') {
                    showError('Pacote expirado ou cancelado.');
                } else {
                    showError('Não foi possível resgatar o ingresso.');
                }
                return;
            }
            setRedeemed(result);
            showSuccess('Ingresso resgatado! Guarde o QR code.');
        } catch {
            showError('Erro ao resgatar ingresso.');
        } finally {
            setRedeeming(false);
        }
    };

    if (!token) {
        return (
            <div className="min-h-[60vh] flex items-center justify-center px-4">
                <p className="text-gray-400">Link inválido.</p>
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

    if (!seat?.ok) {
        return (
            <div className="min-h-[60vh] flex items-center justify-center px-4">
                <p className="text-gray-400">Ingresso não encontrado.</p>
            </div>
        );
    }

    const eventDateLabel = seat.event_date
        ? parseEventLocalDay(seat.event_date)?.toLocaleDateString('pt-BR') ?? seat.event_date
        : '';

    if (redeemed?.ok && redeemed.analytics_id) {
        return (
            <div className="max-w-md mx-auto py-8 px-4">
                <Card className="bg-black/80 border border-yellow-500/30 text-center">
                    <CardHeader>
                        <CardTitle className="text-yellow-500 font-serif text-2xl">Ingresso resgatado!</CardTitle>
                        <p className="text-gray-300 text-sm">{redeemed.event_title}</p>
                        <p className="text-xs text-gray-500">
                            {redeemed.batch_name} · {redeemed.access_type}
                        </p>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="bg-white p-4 rounded-xl inline-block mx-auto">
                            <QRCode value={redeemed.analytics_id} size={200} />
                        </div>
                        {redeemed.code_wristbands && (
                            <p className="text-sm text-gray-400">
                                Código:{' '}
                                <span className="font-mono text-yellow-400">{redeemed.code_wristbands}</span>
                            </p>
                        )}
                        <p className="text-xs text-gray-500">
                            Apresente este QR na entrada. Também disponível em Meus Ingressos.
                        </p>
                        <Button
                            className="w-full bg-yellow-500 text-black hover:bg-yellow-600"
                            onClick={() => navigate('/tickets')}
                        >
                            Ver meus ingressos
                        </Button>
                    </CardContent>
                </Card>
            </div>
        );
    }

    const inactive =
        seat.seat_status === 'redeemed' ||
        seat.already_redeemed ||
        (seat.bundle_status && seat.bundle_status !== 'active');

    return (
        <div className="max-w-md mx-auto py-8 px-4 space-y-6">
            <div className="text-center">
                <Ticket className="h-10 w-10 text-yellow-500 mx-auto mb-2" />
                <h1 className="text-2xl font-serif text-yellow-500">Resgatar cortesia</h1>
            </div>

            <Card className="bg-black/80 border border-yellow-500/30">
                <CardHeader>
                    <CardTitle className="text-white text-lg">{seat.event_title}</CardTitle>
                    <p className="text-sm text-gray-400">
                        {seat.batch_name} · Ingresso {seat.seat_number}
                        {eventDateLabel ? ` · ${eventDateLabel}` : ''}
                    </p>
                </CardHeader>
                <CardContent className="space-y-4">
                    {inactive && (
                        <p className="text-amber-300 text-sm rounded-lg border border-amber-500/30 bg-amber-950/30 p-3">
                            {seat.seat_status === 'redeemed' || seat.already_redeemed
                                ? 'Este ingresso já foi resgatado.'
                                : 'Este pacote não está mais disponível.'}
                        </p>
                    )}

                    {!userId && !inactive && (
                        <div className="rounded-xl border border-cyan-500/30 bg-cyan-950/30 p-4 space-y-3">
                            <p className="text-sm text-cyan-100">
                                Entre com sua conta para resgatar este ingresso cortesia.
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

                    {userId && !inactive && (
                        <Button
                            className="w-full bg-yellow-500 text-black hover:bg-yellow-600"
                            disabled={redeeming}
                            onClick={() => void handleRedeem()}
                        >
                            {redeeming ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                            Confirmar resgate do ingresso
                        </Button>
                    )}
                </CardContent>
            </Card>
        </div>
    );
};

export default ComplimentarySeatRedeemPage;
