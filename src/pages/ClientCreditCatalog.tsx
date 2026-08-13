import React, { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, Loader2, Minus, Plus, QrCode, Store, Wallet } from 'lucide-react';
import QRCode from 'react-qr-code';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
    useClientEstablishmentCreditCatalog,
    useClientEventCreditCatalog,
    type ClientCreditCatalogProduct,
} from '@/hooks/use-client-credit-catalog';
import { useAuthUserId } from '@/hooks/use-auth-user-id';
import { showError, showSuccess } from '@/utils/toast';
import { checkoutCreditConsumption } from '@/utils/credit-consumption-intent';
import { useQueryClient } from '@tanstack/react-query';

function formatMoney(value: number): string {
    return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

type CartProduct = {
    id: string;
    name: string;
    unitPrice: number;
    listPrice: number;
    discountPct: number;
    stock: number;
    packagingType?: string | null;
    unitsPerBox?: number | null;
    imageUrl?: string | null;
    description?: string | null;
};

function toCartProduct(p: ClientCreditCatalogProduct): CartProduct {
    const listPrice = Number(p.unit_price);
    const discountPct = Number(p.app_discount_pct ?? 0);
    const appPrice = Number(p.app_unit_price ?? listPrice * (1 - discountPct / 100));
    return {
        id: p.id,
        name: p.name,
        unitPrice: discountPct > 0 ? appPrice : listPrice,
        listPrice,
        discountPct,
        stock: Number(p.stock_quantity ?? 0),
        packagingType: p.packaging_type,
        unitsPerBox: p.units_per_box,
        imageUrl: p.image_url,
        description: p.description,
    };
}

const ClientCreditCatalog: React.FC = () => {
    const navigate = useNavigate();
    const { eventId, establishmentId } = useParams<{
        eventId?: string;
        establishmentId?: string;
    }>();
    const { userId } = useAuthUserId();
    const queryClient = useQueryClient();

    const eventQuery = useClientEventCreditCatalog(eventId);
    const estQuery = useClientEstablishmentCreditCatalog(
        eventId ? undefined : establishmentId,
    );

    const [selectedEstablishmentId, setSelectedEstablishmentId] = useState<string | null>(null);
    const [quantities, setQuantities] = useState<Record<string, number>>({});
    const [paying, setPaying] = useState(false);
    const [deliveryToken, setDeliveryToken] = useState<string | null>(null);

    const isEventMode = !!eventId;
    const isLoading = isEventMode ? eventQuery.isLoading : estQuery.isLoading;
    const isError = isEventMode ? eventQuery.isError : estQuery.isError;
    const error = isEventMode ? eventQuery.error : estQuery.error;

    const establishments = eventQuery.data?.establishments ?? [];

    React.useEffect(() => {
        if (!isEventMode || establishments.length === 0) return;
        if (selectedEstablishmentId) return;
        setSelectedEstablishmentId(establishments[0].establishment_id);
    }, [isEventMode, establishments, selectedEstablishmentId]);

    const activeEstablishmentId = isEventMode
        ? selectedEstablishmentId
        : establishmentId ?? null;

    const products: CartProduct[] = useMemo(() => {
        if (isEventMode) {
            const est = establishments.find((e) => e.establishment_id === activeEstablishmentId);
            return (est?.products ?? []).map(toCartProduct);
        }
        return (estQuery.data?.products ?? []).map(toCartProduct);
    }, [isEventMode, establishments, activeEstablishmentId, estQuery.data?.products]);

    const title = useMemo(() => {
        if (isEventMode) {
            return eventQuery.data?.event?.title ?? 'Consumo no evento';
        }
        return estQuery.data?.establishment?.name ?? 'Cardápio';
    }, [isEventMode, eventQuery.data?.event?.title, estQuery.data?.establishment?.name]);

    const subtitle = useMemo(() => {
        if (isEventMode) {
            const company = eventQuery.data?.event?.company_name;
            return company ? `Crédito EventFest · ${company}` : 'Pague com crédito e retire no balcão.';
        }
        const est = estQuery.data?.establishment;
        if (!est) return 'Pague com crédito e retire no balcão.';
        return [est.company_name, est.event_title].filter(Boolean).join(' · ');
    }, [isEventMode, eventQuery.data?.event?.company_name, estQuery.data?.establishment]);

    const emptyMessage = isEventMode
        ? eventQuery.data?.message
        : estQuery.data?.message;

    const cartItems = useMemo(
        () =>
            products
                .map((p) => ({ product: p, quantity: quantities[p.id] ?? 0 }))
                .filter((row) => row.quantity > 0),
        [products, quantities],
    );

    const cartTotal = useMemo(
        () => cartItems.reduce((sum, row) => sum + row.product.unitPrice * row.quantity, 0),
        [cartItems],
    );

    const setQty = (productId: string, next: number, maxStock: number) => {
        setQuantities((prev) => ({
            ...prev,
            [productId]: Math.max(0, Math.min(maxStock, Math.min(99, next))),
        }));
    };

    const handleCheckout = async () => {
        if (!activeEstablishmentId) {
            showError('Selecione um estabelecimento.');
            return;
        }
        if (cartItems.length === 0) {
            showError('Selecione ao menos um item.');
            return;
        }
        if (!userId) {
            const redirect = encodeURIComponent(window.location.pathname + window.location.search);
            navigate(`/login?redirect=${redirect}`);
            return;
        }
        setPaying(true);
        try {
            const result = await checkoutCreditConsumption({
                userId,
                establishmentId: activeEstablishmentId,
                eventId: eventId || undefined,
                items: cartItems.map((row) => ({
                    productId: row.product.id,
                    quantity: row.quantity,
                })),
            });
            setDeliveryToken(result.deliveryToken ?? null);
            setQuantities({});
            showSuccess(
                `Pagamento confirmado: ${formatMoney(Number(result.grossAmount ?? cartTotal))}. Mostre o QR na retirada.`,
            );
            if (isEventMode) void eventQuery.refetch();
            else void estQuery.refetch();
            void queryClient.invalidateQueries({ queryKey: ['clientCreditOrders'] });
            void queryClient.invalidateQueries({ queryKey: ['client-credit-balance'] });
            void queryClient.invalidateQueries({ queryKey: ['client-credit-ledger'] });
        } catch (e: unknown) {
            showError(e instanceof Error ? e.message : 'Não foi possível concluir o pagamento.');
        } finally {
            setPaying(false);
        }
    };

    if (deliveryToken) {
        return (
            <div className="min-h-[calc(100vh-4.75rem)] md:min-h-[calc(100vh-6rem)] bg-black text-white px-4 pt-4 pb-8 max-w-2xl mx-auto">
                <div className="mb-6">
                    <h1 className="text-2xl font-bold text-yellow-500 flex items-center gap-2">
                        <QrCode className="h-7 w-7" />
                        Pedido pago — retire no balcão
                    </h1>
                    <p className="text-gray-400 text-sm mt-1">
                        Apresente este QR ao estabelecimento para receber os produtos.
                    </p>
                </div>
                <Card className="bg-black border-yellow-500/30">
                    <CardContent className="py-6 flex flex-col items-center gap-4">
                        <div className="bg-white p-4 rounded-lg">
                            <QRCode value={deliveryToken} size={220} />
                        </div>
                        <p className="text-xs text-gray-500 break-all text-center font-mono">{deliveryToken}</p>
                        <Button
                            type="button"
                            className="w-full bg-yellow-500 text-black hover:bg-yellow-600"
                            onClick={() => setDeliveryToken(null)}
                        >
                            Fazer outro pedido
                        </Button>
                        <Button
                            type="button"
                            variant="outline"
                            className="w-full bg-black/60 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10"
                            onClick={() => navigate('/wallet/pedidos')}
                        >
                            Ver meus pedidos
                        </Button>
                        <Button
                            type="button"
                            variant="outline"
                            className="w-full bg-black/60 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10"
                            onClick={() => navigate('/wallet')}
                        >
                            <Wallet className="h-4 w-4 mr-1" />
                            Ir para carteira
                        </Button>
                    </CardContent>
                </Card>
            </div>
        );
    }

    return (
        <div className="min-h-[calc(100vh-4.75rem)] md:min-h-[calc(100vh-6rem)] bg-black text-white px-4 pt-4 pb-8 max-w-2xl mx-auto">
            <div className="mb-6">
                <h1 className="text-2xl font-bold text-yellow-500 flex items-center gap-2">
                    <Store className="h-7 w-7" />
                    {title}
                </h1>
                <p className="text-gray-400 text-sm mt-1">{subtitle}</p>
            </div>

            {isLoading && (
                <div className="flex justify-center py-10">
                    <Loader2 className="h-7 w-7 animate-spin text-yellow-500" />
                </div>
            )}

            {isError && (
                <Card className="bg-black border-red-500/30">
                    <CardContent className="py-6 text-sm text-red-300">
                        {error instanceof Error ? error.message : 'Não foi possível carregar o cardápio.'}
                    </CardContent>
                </Card>
            )}

            {!isLoading && !isError && emptyMessage && products.length === 0 && (
                <Card className="bg-black border-amber-500/30">
                    <CardContent className="py-6 text-sm text-amber-100 flex items-start gap-2">
                        <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                        {emptyMessage}
                    </CardContent>
                </Card>
            )}

            {!isLoading && !isError && isEventMode && establishments.length > 1 && (
                <Card className="bg-black border-yellow-500/30 mb-4">
                    <CardHeader>
                        <CardTitle className="text-white text-lg">Estabelecimento</CardTitle>
                    </CardHeader>
                    <CardContent className="flex flex-wrap gap-2">
                        {establishments.map((est) => (
                            <Button
                                key={est.establishment_id}
                                type="button"
                                variant="outline"
                                size="sm"
                                className={
                                    selectedEstablishmentId === est.establishment_id
                                        ? 'bg-yellow-500 text-black border-yellow-500 hover:bg-yellow-600'
                                        : 'bg-black/60 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10'
                                }
                                onClick={() => {
                                    setSelectedEstablishmentId(est.establishment_id);
                                    setQuantities({});
                                }}
                            >
                                {est.name}
                            </Button>
                        ))}
                    </CardContent>
                </Card>
            )}

            {!isLoading && !isError && products.length > 0 && (
                <>
                    <Card className="bg-black border-yellow-500/30">
                        <CardHeader>
                            <CardTitle className="text-white">Produtos</CardTitle>
                            <CardDescription className="text-gray-400">
                                {products.length} item(ns) com estoque disponível.
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <ul className="space-y-2">
                                {products.map((item) => (
                                    <li
                                        key={item.id}
                                        className="rounded-lg border border-yellow-500/20 p-3 flex items-start justify-between gap-3"
                                    >
                                        <div className="flex items-start gap-3 min-w-0">
                                            {item.imageUrl ? (
                                                <img
                                                    src={item.imageUrl}
                                                    alt={item.name}
                                                    className="h-12 w-12 rounded-lg object-cover border border-yellow-500/20 shrink-0"
                                                />
                                            ) : null}
                                            <div className="min-w-0">
                                                <p className="text-white font-medium">{item.name}</p>
                                                {item.description ? (
                                                    <p className="text-xs text-gray-500 mt-1">{item.description}</p>
                                                ) : null}
                                                {item.packagingType === 'box' && item.unitsPerBox ? (
                                                    <p className="text-xs text-yellow-500/80 mt-1">
                                                        Caixa com {item.unitsPerBox} unidades
                                                    </p>
                                                ) : null}
                                                <p className="text-xs text-gray-500 mt-1">
                                                    Estoque: {item.stock}
                                                </p>
                                            </div>
                                        </div>
                                        <div className="text-right">
                                            {item.discountPct > 0 ? (
                                                <>
                                                    <p className="text-xs text-gray-500 line-through">
                                                        {formatMoney(item.listPrice)}
                                                    </p>
                                                    <p className="text-yellow-500 font-semibold">
                                                        {formatMoney(item.unitPrice)}
                                                    </p>
                                                    <p className="text-[11px] text-yellow-400">
                                                        {item.discountPct.toLocaleString('pt-BR')}% no app
                                                    </p>
                                                </>
                                            ) : (
                                                <p className="text-yellow-500 font-semibold">
                                                    {formatMoney(item.unitPrice)}
                                                </p>
                                            )}
                                            <div className="mt-2 inline-flex items-center gap-2">
                                                <Button
                                                    type="button"
                                                    size="sm"
                                                    variant="outline"
                                                    className="h-7 w-7 p-0 bg-black/60 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10"
                                                    onClick={() =>
                                                        setQty(item.id, (quantities[item.id] ?? 0) - 1, item.stock)
                                                    }
                                                >
                                                    <Minus className="h-3 w-3" />
                                                </Button>
                                                <span className="w-5 text-center text-sm text-white">
                                                    {quantities[item.id] ?? 0}
                                                </span>
                                                <Button
                                                    type="button"
                                                    size="sm"
                                                    variant="outline"
                                                    className="h-7 w-7 p-0 bg-black/60 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10"
                                                    onClick={() =>
                                                        setQty(item.id, (quantities[item.id] ?? 0) + 1, item.stock)
                                                    }
                                                >
                                                    <Plus className="h-3 w-3" />
                                                </Button>
                                            </div>
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        </CardContent>
                    </Card>

                    <Card className="bg-black border-yellow-500/30 mt-4">
                        <CardHeader>
                            <CardTitle className="text-white text-lg">Resumo do pedido</CardTitle>
                            <CardDescription className="text-gray-400">
                                O crédito é debitado agora. Depois mostre o QR na retirada.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            {cartItems.length > 0 ? (
                                <ul className="space-y-1 text-sm">
                                    {cartItems.map((row) => (
                                        <li
                                            key={row.product.id}
                                            className="flex items-center justify-between text-gray-300"
                                        >
                                            <span>
                                                {row.quantity}x {row.product.name}
                                            </span>
                                            <span>{formatMoney(row.quantity * row.product.unitPrice)}</span>
                                        </li>
                                    ))}
                                </ul>
                            ) : (
                                <p className="text-sm text-gray-500">Nenhum item selecionado.</p>
                            )}
                            <div className="flex items-center justify-between text-yellow-500 font-semibold border-t border-yellow-500/20 pt-3">
                                <span>Total</span>
                                <span>{formatMoney(cartTotal)}</span>
                            </div>
                            <Button
                                type="button"
                                className="w-full bg-yellow-500 text-black hover:bg-yellow-600 disabled:opacity-50"
                                onClick={handleCheckout}
                                disabled={paying || cartItems.length === 0}
                            >
                                {paying ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                                Pagar com crédito EventFest
                            </Button>
                        </CardContent>
                    </Card>
                </>
            )}

            <Button
                type="button"
                variant="outline"
                className="w-full mt-4 bg-black/60 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10"
                onClick={() => navigate(isEventMode ? '/tickets' : '/wallet')}
            >
                Voltar
            </Button>
        </div>
    );
};

export default ClientCreditCatalog;
