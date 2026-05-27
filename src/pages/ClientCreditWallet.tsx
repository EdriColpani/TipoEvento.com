import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
    Wallet,
    Loader2,
    Plus,
    RefreshCw,
    MapPin,
    Download,
    AlertTriangle,
    Store,
    CalendarDays,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useClientCreditWallet } from '@/hooks/use-client-credit-wallet';
import {
    useCreditAcceptanceNetwork,
    useCreditTopupPolling,
    useCreditWalletStatus,
} from '@/hooks/use-credit-wallet-phase2';
import { startCreditTopupCheckout } from '@/utils/credit-topup-checkout';
import { exportCreditLedgerCsv } from '@/utils/export-credit-ledger-csv';
import { showError, showSuccess } from '@/utils/toast';
import { supabase } from '@/integrations/supabase/client';
import { formatEventDateForDisplay } from '@/utils/format-event-date';
import WalletQrModal from '@/components/WalletQrModal';
import WalletBiometricSection from '@/components/WalletBiometricSection';
import WalletPwaInstallHint from '@/components/WalletPwaInstallHint';
import { useDevice } from '@/hooks/use-device';

const PRESET_AMOUNTS = [50, 100, 250, 500];

function formatMoney(value: number): string {
    return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

const ClientCreditWallet: React.FC = () => {
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    const { balance, isLoading, ledger, refresh, status: accountStatus } = useClientCreditWallet();
    const { data: walletStatus, isLoading: statusLoading } = useCreditWalletStatus();
    const { data: network, isLoading: networkLoading } = useCreditAcceptanceNetwork(true);
    const [customAmount, setCustomAmount] = useState('');
    const [isPaying, setIsPaying] = useState(false);
    const [walletQrOpen, setWalletQrOpen] = useState(false);
    const [userId, setUserId] = useState<string | undefined>();
    const [userLabel, setUserLabel] = useState<string | undefined>();
    const { isMobile } = useDevice();

    const returnStatus = searchParams.get('status');
    const topupId = searchParams.get('topup_id');
    const shouldPoll = returnStatus === 'success' && !!topupId;

    const clearReturnParams = useCallback(() => {
        setSearchParams({}, { replace: true });
    }, [setSearchParams]);

    const handlePollSettled = useCallback(() => {
        refresh();
        if (returnStatus === 'success') {
            showSuccess('Recarga confirmada! Seu saldo foi atualizado.');
        }
        clearReturnParams();
    }, [refresh, returnStatus, clearReturnParams]);

    const { isPolling } = useCreditTopupPolling({
        orderId: topupId,
        active: shouldPoll,
        onSettled: handlePollSettled,
    });

    useEffect(() => {
        const checkAuth = async () => {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) navigate('/login?redirect=/wallet');
            else {
                setUserId(user.id);
                setUserLabel(user.email ?? user.id);
            }
        };
        checkAuth();
    }, [navigate]);

    useEffect(() => {
        if (returnStatus === 'pending') {
            showSuccess('Pagamento pendente. O saldo será creditado após a confirmação do Mercado Pago.');
            clearReturnParams();
        } else if (returnStatus === 'failure') {
            showError('Pagamento não concluído. Tente novamente.');
            clearReturnParams();
        } else if (returnStatus === 'success' && !topupId) {
            showSuccess('Pagamento recebido. Atualizando saldo…');
            refresh();
            clearReturnParams();
        }
    }, [returnStatus, topupId, refresh, clearReturnParams]);

    const moduleGloballyOn = walletStatus?.module_enabled === true;
    const hasWalletActivity = balance > 0 || ledger.length > 0;
    const canTopup = moduleGloballyOn && walletStatus?.can_topup !== false && accountStatus === 'active';
    const topupPausedMessage =
        walletStatus?.message ||
        'Novas recargas estão pausadas. Seu saldo e extrato continuam disponíveis.';

    const networkEmpty =
        !networkLoading &&
        (network?.events?.length ?? 0) === 0 &&
        (network?.establishments?.length ?? 0) === 0;

    const handleTopup = async (amount: number) => {
        if (!canTopup) {
            showError(topupPausedMessage);
            return;
        }
        if (amount < 10 || amount > 10000) {
            showError('Valor entre R$ 10 e R$ 10.000.');
            return;
        }
        setIsPaying(true);
        try {
            const { checkoutUrl } = await startCreditTopupCheckout(amount);
            window.location.href = checkoutUrl;
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : 'Erro ao abrir pagamento.';
            showError(msg);
        } finally {
            setIsPaying(false);
        }
    };

    const handleCustomTopup = () => {
        const parsed = Number(customAmount.replace(',', '.'));
        if (!Number.isFinite(parsed)) {
            showError('Informe um valor válido.');
            return;
        }
        handleTopup(parsed);
    };

    const handleExportCsv = () => {
        if (ledger.length === 0) {
            showError('Não há movimentações para exportar.');
            return;
        }
        exportCreditLedgerCsv(ledger);
        showSuccess('Extrato exportado.');
    };

    const acceptanceHint = useMemo(() => {
        if (networkLoading) return null;
        if (networkEmpty) {
            return 'Nenhum evento ou estabelecimento parceiro habilitado ainda. Novos pontos aparecerão aqui.';
        }
        return null;
    }, [networkLoading, networkEmpty]);

    return (
        <div
            className={`min-h-[calc(100vh-4.75rem)] md:min-h-[calc(100vh-6rem)] bg-black text-white px-4 pt-4 pb-8 max-w-2xl mx-auto ${isMobile ? 'pb-28' : ''}`}
        >
            <div className="flex items-center gap-3 mb-6">
                <Wallet className="h-8 w-8 text-yellow-500" />
                <div>
                    <h1 className="text-2xl font-bold text-yellow-500">Carteira EventFest</h1>
                    <p className="text-gray-400 text-sm">
                        Crédito válido na rede de eventos e estabelecimentos parceiros.
                    </p>
                </div>
            </div>

            <WalletPwaInstallHint />

            {(isPolling || shouldPoll) && (
                <Alert className="mb-6 border-yellow-500/40 bg-yellow-500/10">
                    <Loader2 className="h-4 w-4 animate-spin text-yellow-500" />
                    <AlertTitle className="text-yellow-400">Confirmando pagamento</AlertTitle>
                    <AlertDescription className="text-gray-300">
                        Aguardando confirmação do Mercado Pago. Seu saldo será atualizado em instantes.
                    </AlertDescription>
                </Alert>
            )}

            {accountStatus === 'frozen' && (
                <Alert className="mb-6 border-red-500/40 bg-red-500/10">
                    <AlertTriangle className="h-4 w-4 text-red-400" />
                    <AlertTitle className="text-red-400">Carteira suspensa</AlertTitle>
                    <AlertDescription className="text-gray-300">
                        Entre em contato com o suporte EventFest para regularizar sua carteira.
                    </AlertDescription>
                </Alert>
            )}

            <Card className="bg-black border-yellow-500/30 mb-6">
                <CardHeader>
                    <CardDescription className="text-gray-400">Saldo disponível</CardDescription>
                    <CardTitle className="text-3xl text-yellow-400">
                        {isLoading ? (
                            <Loader2 className="h-8 w-8 animate-spin" />
                        ) : (
                            formatMoney(balance)
                        )}
                    </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-2">
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="border-yellow-500/40 text-yellow-500"
                        onClick={() => refresh()}
                        disabled={isPolling}
                    >
                        <RefreshCw className={`h-4 w-4 mr-1 ${isPolling ? 'animate-spin' : ''}`} />
                        Atualizar
                    </Button>
                    {canTopup && accountStatus === 'active' && (
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="border-yellow-500/40 text-yellow-500"
                            onClick={() => setWalletQrOpen(true)}
                        >
                            <Wallet className="h-4 w-4 mr-1" />
                            Mostrar QR no PDV
                        </Button>
                    )}
                </CardContent>
            </Card>

            <WalletBiometricSection
                threshold={Number(walletStatus?.biometric_threshold ?? 200)}
                userId={userId}
                userLabel={userLabel}
            />

            <WalletQrModal
                isOpen={walletQrOpen}
                onClose={() => setWalletQrOpen(false)}
                balanceLabel={formatMoney(balance)}
            />

            <Card className="bg-black border-yellow-500/30 mb-6">
                <CardHeader>
                    <CardTitle className="text-lg text-white flex items-center gap-2">
                        <MapPin className="h-5 w-5 text-yellow-500" />
                        Onde usar seu crédito
                    </CardTitle>
                    <CardDescription className="text-gray-400 text-sm">
                        Eventos e estabelecimentos da rede EventFest que aceitam crédito.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    {networkLoading ? (
                        <div className="flex justify-center py-6">
                            <Loader2 className="h-6 w-6 animate-spin text-yellow-500" />
                        </div>
                    ) : acceptanceHint ? (
                        <p className="text-gray-500 text-sm text-center py-4">{acceptanceHint}</p>
                    ) : (
                        <>
                            {!moduleGloballyOn && network?.message && (
                                <p className="text-amber-400/90 text-xs mb-3">{network.message}</p>
                            )}
                            {(network?.events?.length ?? 0) > 0 && (
                                <div>
                                    <p className="text-xs text-yellow-500/80 uppercase tracking-wide mb-2 flex items-center gap-1">
                                        <CalendarDays className="h-3 w-3" /> Eventos
                                    </p>
                                    <ul className="space-y-2">
                                        {network!.events.map((ev) => (
                                            <li
                                                key={ev.event_id}
                                                className="rounded-lg border border-yellow-500/20 p-3 hover:border-yellow-500/40 transition-colors"
                                            >
                                                <button
                                                    type="button"
                                                    className="text-left w-full"
                                                    onClick={() => navigate(`/events/${ev.event_id}`)}
                                                >
                                                    <p className="text-white font-medium">{ev.title}</p>
                                                    <p className="text-gray-500 text-xs mt-1">
                                                        {ev.company_name}
                                                        {ev.event_date
                                                            ? ` · ${formatEventDateForDisplay(ev.event_date)}`
                                                            : ''}
                                                        {ev.location ? ` · ${ev.location}` : ''}
                                                    </p>
                                                </button>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                            {(network?.establishments?.length ?? 0) > 0 && (
                                <div>
                                    <p className="text-xs text-yellow-500/80 uppercase tracking-wide mb-2 flex items-center gap-1">
                                        <Store className="h-3 w-3" /> Estabelecimentos
                                    </p>
                                    <ul className="space-y-2">
                                        {network!.establishments.map((est) => (
                                            <li
                                                key={est.establishment_id}
                                                className="rounded-lg border border-yellow-500/20 p-3"
                                            >
                                                <p className="text-white font-medium">{est.name}</p>
                                                <p className="text-gray-500 text-xs mt-1">
                                                    {est.company_name}
                                                    {est.event_title ? ` · ${est.event_title}` : ''}
                                                </p>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                        </>
                    )}
                </CardContent>
            </Card>

            <Card className="bg-black border-yellow-500/30 mb-6">
                <CardHeader>
                    <CardTitle className="text-lg text-white">Recarregar crédito</CardTitle>
                    <CardDescription className="text-gray-400 text-sm">
                        Você paga e recebe o mesmo valor em crédito na carteira. A taxa do Mercado
                        Pago não reduz seu saldo, conforme os Termos de Uso.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    {!statusLoading && !moduleGloballyOn && (
                        <Alert className="border-amber-500/40 bg-amber-500/10">
                            <AlertTriangle className="h-4 w-4 text-amber-400" />
                            <AlertTitle className="text-amber-400 text-sm">Recargas pausadas</AlertTitle>
                            <AlertDescription className="text-gray-300 text-sm">
                                {topupPausedMessage}
                                {hasWalletActivity
                                    ? ' Você pode usar o saldo atual nos parceiros da rede.'
                                    : ''}
                            </AlertDescription>
                        </Alert>
                    )}
                    <div className="flex flex-wrap gap-2">
                        {PRESET_AMOUNTS.map((amt) => (
                            <Button
                                key={amt}
                                type="button"
                                disabled={isPaying || !canTopup}
                                className="bg-yellow-500 text-black hover:bg-yellow-400 disabled:opacity-50"
                                onClick={() => handleTopup(amt)}
                            >
                                {formatMoney(amt)}
                            </Button>
                        ))}
                    </div>
                    <div className="flex gap-2">
                        <Input
                            type="text"
                            inputMode="decimal"
                            placeholder="Outro valor (ex. 250)"
                            value={customAmount}
                            onChange={(e) => setCustomAmount(e.target.value)}
                            className="bg-black/60 border-yellow-500/30 text-white"
                            disabled={!canTopup}
                        />
                        <Button
                            type="button"
                            disabled={isPaying || !canTopup}
                            className="bg-yellow-500 text-black shrink-0 disabled:opacity-50"
                            onClick={handleCustomTopup}
                        >
                            {isPaying ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                                <>
                                    <Plus className="h-4 w-4 mr-1" />
                                    Pagar
                                </>
                            )}
                        </Button>
                    </div>
                </CardContent>
            </Card>

            <Card className="bg-black border-yellow-500/30">
                <CardHeader className="flex flex-row items-start justify-between gap-2">
                    <div>
                        <CardTitle className="text-lg text-white">Extrato</CardTitle>
                        <CardDescription className="text-gray-400 text-sm">
                            Histórico detalhado de recargas e usos de crédito.
                        </CardDescription>
                    </div>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="border-yellow-500/40 text-yellow-500 shrink-0"
                        onClick={handleExportCsv}
                        disabled={ledger.length === 0}
                    >
                        <Download className="h-4 w-4 mr-1" />
                        CSV
                    </Button>
                </CardHeader>
                <CardContent>
                    {isLoading ? (
                        <div className="flex justify-center py-8">
                            <Loader2 className="h-8 w-8 animate-spin text-yellow-500" />
                        </div>
                    ) : ledger.length === 0 ? (
                        <p className="text-gray-500 text-center py-6 text-sm">
                            Nenhuma movimentação ainda.
                        </p>
                    ) : (
                        <ul className="space-y-4">
                            {ledger.map((entry) => (
                                <li
                                    key={entry.id}
                                    className="border-b border-yellow-500/10 pb-4 last:border-0"
                                >
                                    <div className="flex justify-between gap-2 text-sm mb-1">
                                        <span
                                            className={
                                                entry.amount >= 0
                                                    ? 'text-green-400 font-medium'
                                                    : 'text-amber-400 font-medium'
                                            }
                                        >
                                            {entry.amount >= 0 ? '+' : ''}
                                            {formatMoney(entry.amount)}
                                        </span>
                                        <span className="text-gray-500 shrink-0">
                                            {new Date(entry.created_at).toLocaleString('pt-BR')}
                                        </span>
                                    </div>
                                    <p className="text-gray-300 text-sm leading-relaxed">
                                        {entry.public_description}
                                    </p>
                                    <p className="text-gray-600 text-xs mt-1">
                                        Saldo após: {formatMoney(Number(entry.balance_after))}
                                    </p>
                                </li>
                            ))}
                        </ul>
                    )}
                </CardContent>
            </Card>
        </div>
    );
};

export default ClientCreditWallet;
