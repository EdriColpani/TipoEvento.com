import React, { useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AlertTriangle, Loader2, Minus, Plus, Store, Wallet } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useCreditMenu } from '@/hooks/use-credit-menu';
import { useAuthUserId } from '@/hooks/use-auth-user-id';
import { showError, showSuccess } from '@/utils/toast';
import { checkoutCreditConsumptionFromMenu } from '@/utils/credit-consumption-intent';

function formatMoney(value: number): string {
    return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

const ClientCreditMenu: React.FC = () => {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const menuToken = searchParams.get('m');
    const { userId } = useAuthUserId();
    const { data, isLoading, isError, error } = useCreditMenu(menuToken);
    const [quantities, setQuantities] = React.useState<Record<string, number>>({});
    const [paying, setPaying] = React.useState(false);

    const title = useMemo(() => {
        if (!data) return 'Cardápio digital';
        return data.establishment.name;
    }, [data]);

    const cartItems = useMemo(() => {
        if (!data) return [];
        return data.products
            .map((p) => ({ product: p, quantity: quantities[p.id] ?? 0 }))
            .filter((row) => row.quantity > 0);
    }, [data, quantities]);

    const cartTotal = useMemo(
        () => cartItems.reduce((sum, row) => sum + row.product.unitPrice * row.quantity, 0),
        [cartItems],
    );

    const setQty = (productId: string, next: number) => {
        setQuantities((prev) => ({
            ...prev,
            [productId]: Math.max(0, Math.min(99, next)),
        }));
    };

    const handleCheckout = async () => {
        if (!menuToken || !data) return;
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
            const result = await checkoutCreditConsumptionFromMenu({
                userId,
                menuToken,
                items: cartItems.map((row) => ({
                    productId: row.product.id,
                    quantity: row.quantity,
                })),
            });
            showSuccess(
                `Pedido enviado ao balcão: ${formatMoney(Number(result.gross_amount ?? cartTotal))}. Aguarde o atendimento para cobrança final.`,
            );
            navigate('/wallet');
        } catch (e: unknown) {
            showError(e instanceof Error ? e.message : 'Não foi possível concluir o pagamento.');
        } finally {
            setPaying(false);
        }
    };

    return (
        <div className="min-h-[calc(100vh-4.75rem)] md:min-h-[calc(100vh-6rem)] bg-black text-white px-4 pt-4 pb-8 max-w-2xl mx-auto">
            <div className="mb-6">
                <h1 className="text-2xl font-bold text-yellow-500 flex items-center gap-2">
                    <Store className="h-7 w-7" />
                    {title}
                </h1>
                <p className="text-gray-400 text-sm mt-1">Visualização de cardápio via QR do balcão.</p>
            </div>

            {!menuToken && (
                <Card className="bg-black border-red-500/30">
                    <CardContent className="py-6 text-sm text-red-300 flex items-start gap-2">
                        <AlertTriangle className="h-4 w-4 mt-0.5" />
                        QR inválido. Abra esta tela escaneando o QR exibido no PDV.
                    </CardContent>
                </Card>
            )}

            {menuToken && isLoading && (
                <div className="flex justify-center py-10">
                    <Loader2 className="h-7 w-7 animate-spin text-yellow-500" />
                </div>
            )}

            {menuToken && isError && (
                <Card className="bg-black border-red-500/30">
                    <CardContent className="py-6 text-sm text-red-300">
                        {error instanceof Error ? error.message : 'Não foi possível carregar o cardápio.'}
                    </CardContent>
                </Card>
            )}

            {data && (
                <>
                    <Card className="bg-black border-yellow-500/30 mb-4">
                        <CardHeader>
                            <CardTitle className="text-white text-lg">{data.establishment.name}</CardTitle>
                            <CardDescription className="text-gray-400">
                                {data.establishment.companyName}
                                {data.establishment.eventTitle ? ` · ${data.establishment.eventTitle}` : ''}
                            </CardDescription>
                        </CardHeader>
                    </Card>

                    <Card className="bg-black border-yellow-500/30">
                        <CardHeader>
                            <CardTitle className="text-white">Produtos</CardTitle>
                            <CardDescription className="text-gray-400">
                                {data.products.length === 0
                                    ? 'Este balcão ainda não cadastrou itens.'
                                    : `${data.products.length} item(ns) disponível(is).`}
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            {data.products.length === 0 ? (
                                <p className="text-sm text-gray-500">Sem itens no momento.</p>
                            ) : (
                                <ul className="space-y-2">
                                    {data.products.map((item) => (
                                        <li
                                            key={item.id}
                                            className="rounded-lg border border-yellow-500/20 p-3 flex items-start justify-between gap-3"
                                        >
                                            <div>
                                                <p className="text-white font-medium">{item.name}</p>
                                                {item.description ? (
                                                    <p className="text-xs text-gray-500 mt-1">{item.description}</p>
                                                ) : null}
                                            </div>
                                            <div className="text-right">
                                                <p className="text-yellow-500 font-semibold">{formatMoney(item.unitPrice)}</p>
                                                <div className="mt-2 inline-flex items-center gap-2">
                                                    <Button
                                                        type="button"
                                                        size="sm"
                                                        variant="outline"
                                                        className="h-7 w-7 p-0 border-yellow-500/40 text-yellow-500"
                                                        onClick={() => setQty(item.id, (quantities[item.id] ?? 0) - 1)}
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
                                                        className="h-7 w-7 p-0 border-yellow-500/40 text-yellow-500"
                                                        onClick={() => setQty(item.id, (quantities[item.id] ?? 0) + 1)}
                                                    >
                                                        <Plus className="h-3 w-3" />
                                                    </Button>
                                                </div>
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </CardContent>
                    </Card>

                    <Card className="bg-black border-yellow-500/30 mt-4">
                        <CardHeader>
                            <CardTitle className="text-white text-lg">Resumo do pedido</CardTitle>
                            <CardDescription className="text-gray-400">
                                {cartItems.length === 0
                                    ? 'Nenhum item selecionado.'
                                    : `${cartItems.length} item(ns) no carrinho.`}
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            {cartItems.length > 0 ? (
                                <ul className="space-y-1 text-sm">
                                    {cartItems.map((row) => (
                                        <li key={row.product.id} className="flex items-center justify-between text-gray-300">
                                            <span>{row.quantity}x {row.product.name}</span>
                                            <span>{formatMoney(row.quantity * row.product.unitPrice)}</span>
                                        </li>
                                    ))}
                                </ul>
                            ) : null}
                            <div className="flex items-center justify-between text-yellow-500 font-semibold border-t border-yellow-500/20 pt-3">
                                <span>Total</span>
                                <span>{formatMoney(cartTotal)}</span>
                            </div>
                            <Button
                                type="button"
                                className="w-full bg-yellow-500 text-black hover:bg-yellow-600"
                                onClick={handleCheckout}
                                disabled={paying || cartItems.length === 0}
                            >
                                {paying ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                                Pagar com crédito EventFest
                            </Button>
                        </CardContent>
                    </Card>

                    <Button
                        type="button"
                        className="w-full mt-4 bg-yellow-500 text-black hover:bg-yellow-600"
                        onClick={() => navigate('/wallet')}
                    >
                        <Wallet className="h-4 w-4 mr-1" />
                        Ir para carteira
                    </Button>
                </>
            )}
        </div>
    );
};

export default ClientCreditMenu;
