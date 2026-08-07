import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, Package, QrCode, Wallet } from 'lucide-react';
import QRCode from 'react-qr-code';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import ClientAccountPageShell from '@/components/client/ClientAccountPageShell';
import { CLIENT_ACCOUNT_CARD_CLASS } from '@/constants/client-account-ui';
import {
    isDeliveryQrActive,
    useClientCreditOrders,
    type ClientCreditOrder,
} from '@/hooks/use-client-credit-orders';
import { usePageAuth } from '@/hooks/use-page-auth';
import { showSuccess } from '@/utils/toast';

function formatMoney(value: number): string {
    return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function statusLabel(status: string): string {
    switch (status) {
        case 'ready_for_pickup':
            return 'Aguardando retirada';
        case 'in_preparation':
            return 'Em preparo';
        case 'completed':
            return 'Entregue';
        case 'cancelled':
            return 'Cancelado';
        case 'new':
            return 'Novo';
        default:
            return status;
    }
}

const ClientCreditOrders: React.FC = () => {
    const navigate = useNavigate();
    const { userId, authPending, sessionReady, bootExpired } = usePageAuth();
    const { data: orders = [], isLoading, isError, refetch, isFetching } = useClientCreditOrders(!!userId);
    const [qrOrder, setQrOrder] = useState<ClientCreditOrder | null>(null);
    const knownStatusesRef = React.useRef<Record<string, string>>({});
    const statusesReadyRef = React.useRef(false);

    React.useEffect(() => {
        if (authPending) return;
        if (!userId && (sessionReady || bootExpired)) {
            navigate('/login?redirect=/wallet/pedidos');
        }
    }, [authPending, userId, sessionReady, bootExpired, navigate]);

    React.useEffect(() => {
        if (!orders.length && !statusesReadyRef.current) return;

        if (!statusesReadyRef.current) {
            for (const order of orders) {
                knownStatusesRef.current[order.id] = order.status;
            }
            statusesReadyRef.current = true;
            return;
        }

        for (const order of orders) {
            const prev = knownStatusesRef.current[order.id];
            if (prev && prev !== 'completed' && order.status === 'completed') {
                showSuccess(`Pedido em ${order.establishment_name} foi entregue.`);
                if (qrOrder?.id === order.id) setQrOrder(null);
            }
            knownStatusesRef.current[order.id] = order.status;
        }
    }, [orders, qrOrder?.id]);

    const openOrders = useMemo(
        () => orders.filter((o) => o.status !== 'completed' && o.status !== 'cancelled'),
        [orders],
    );
    const pastOrders = useMemo(
        () => orders.filter((o) => o.status === 'completed' || o.status === 'cancelled'),
        [orders],
    );

    const renderOrder = (order: ClientCreditOrder) => {
        const canShowQr = isDeliveryQrActive(order);
        return (
            <li key={order.id} className="rounded-lg border border-yellow-500/20 p-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                        <p className="text-white font-medium truncate">{order.establishment_name}</p>
                        <p className="text-xs text-gray-500 mt-0.5">
                            {order.event_title ? `${order.event_title} · ` : ''}
                            {new Date(order.paid_at ?? order.created_at).toLocaleString('pt-BR')}
                        </p>
                    </div>
                    <span className="text-xs text-yellow-500 shrink-0">{statusLabel(order.status)}</span>
                </div>
                <ul className="text-sm text-gray-300 space-y-0.5">
                    {(order.items ?? []).map((item) => (
                        <li key={`${order.id}-${item.product_id}`}>
                            {item.quantity}x {item.product_name}
                        </li>
                    ))}
                </ul>
                <div className="flex items-center justify-between gap-2 pt-1">
                    <span className="text-yellow-500 font-semibold">
                        {formatMoney(Number(order.gross_amount))}
                    </span>
                    {canShowQr ? (
                        <Button
                            type="button"
                            size="sm"
                            className="bg-yellow-500 text-black hover:bg-yellow-600"
                            onClick={() => setQrOrder(order)}
                        >
                            <QrCode className="h-4 w-4 mr-1" />
                            Ver QR
                        </Button>
                    ) : null}
                </div>
            </li>
        );
    };

    if (qrOrder?.delivery_token) {
        return (
            <ClientAccountPageShell
                title="QR de retirada"
                subtitle="Mostre este código no balcão para receber o pedido."
                icon={<QrCode className="h-8 w-8 text-yellow-500" aria-hidden />}
            >
                <Card className={CLIENT_ACCOUNT_CARD_CLASS}>
                    <CardContent className="py-6 flex flex-col items-center gap-4">
                        <div className="bg-white p-4 rounded-lg">
                            <QRCode value={qrOrder.delivery_token} size={220} />
                        </div>
                        <p className="text-xs text-gray-500 break-all text-center font-mono">
                            {qrOrder.delivery_token}
                        </p>
                        <p className="text-sm text-gray-300 text-center">
                            {qrOrder.establishment_name} · {formatMoney(Number(qrOrder.gross_amount))}
                        </p>
                        <Button
                            type="button"
                            variant="outline"
                            className="w-full bg-black/60 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10"
                            onClick={() => setQrOrder(null)}
                        >
                            Voltar aos pedidos
                        </Button>
                    </CardContent>
                </Card>
            </ClientAccountPageShell>
        );
    }

    return (
        <ClientAccountPageShell
            title="Meus pedidos"
            subtitle="Consumo pago com crédito EventFest — QR de retirada e histórico."
            icon={<Package className="h-8 w-8 text-yellow-500" aria-hidden />}
            showBackToProfile={false}
        >
            <div className="flex flex-wrap gap-2 mb-4">
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="bg-black/60 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10"
                    onClick={() => navigate('/wallet')}
                >
                    <Wallet className="h-4 w-4 mr-1" />
                    Carteira
                </Button>
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="bg-black/60 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 disabled:opacity-50"
                    onClick={() => void refetch()}
                    disabled={isFetching}
                >
                    {isFetching ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                    Atualizar
                </Button>
            </div>

            {isLoading ? (
                <div className="flex justify-center py-10">
                    <Loader2 className="h-7 w-7 animate-spin text-yellow-500" />
                </div>
            ) : isError ? (
                <Card className={CLIENT_ACCOUNT_CARD_CLASS}>
                    <CardContent className="py-6 text-sm text-red-300">
                        Não foi possível carregar seus pedidos.
                    </CardContent>
                </Card>
            ) : orders.length === 0 ? (
                <Card className={CLIENT_ACCOUNT_CARD_CLASS}>
                    <CardContent className="py-8 text-center text-gray-400 text-sm">
                        Você ainda não tem pedidos de consumo pagos.
                    </CardContent>
                </Card>
            ) : (
                <div className="space-y-6">
                    <Card className={CLIENT_ACCOUNT_CARD_CLASS}>
                        <CardHeader>
                            <CardTitle className="text-white text-lg">Em andamento</CardTitle>
                            <CardDescription className="text-gray-400">
                                Pedidos pagos aguardando preparo ou retirada.
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            {openOrders.length === 0 ? (
                                <p className="text-sm text-gray-500">Nenhum pedido em aberto.</p>
                            ) : (
                                <ul className="space-y-3">{openOrders.map(renderOrder)}</ul>
                            )}
                        </CardContent>
                    </Card>

                    <Card className={CLIENT_ACCOUNT_CARD_CLASS}>
                        <CardHeader>
                            <CardTitle className="text-white text-lg">Histórico</CardTitle>
                            <CardDescription className="text-gray-400">
                                Pedidos já entregues ou cancelados.
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            {pastOrders.length === 0 ? (
                                <p className="text-sm text-gray-500">Sem histórico ainda.</p>
                            ) : (
                                <ul className="space-y-3">{pastOrders.map(renderOrder)}</ul>
                            )}
                        </CardContent>
                    </Card>
                </div>
            )}
        </ClientAccountPageShell>
    );
};

export default ClientCreditOrders;
