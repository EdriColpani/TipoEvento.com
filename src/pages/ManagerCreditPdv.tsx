import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader2, ScanLine, ShoppingBag, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { useManagerCompany } from '@/hooks/use-manager-company';
import { useCreditEstablishments } from '@/hooks/use-credit-establishments';
import { isHybridPlan, isConsumptionOrLicensePlan } from '@/utils/company-billing-rules';
import { useCompanyBilling } from '@/hooks/use-company-billing';
import { parseEdgeFunctionError } from '@/utils/edge-function-error';
import { showError, showSuccess } from '@/utils/toast';

type CartLine = {
    id: string;
    productName: string;
    quantity: number;
    unitPrice: number;
};

type ResolvedClient = {
    clientUserId: string;
    balance: number;
    clientLabel: string;
};

function formatMoney(value: number): string {
    return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

const ManagerCreditPdv: React.FC = () => {
    const navigate = useNavigate();
    const [userId, setUserId] = useState<string | undefined>();
    const [establishmentId, setEstablishmentId] = useState('');
    const [walletToken, setWalletToken] = useState('');
    const [resolved, setResolved] = useState<ResolvedClient | null>(null);
    const [resolving, setResolving] = useState(false);
    const [cart, setCart] = useState<CartLine[]>([]);
    const [productName, setProductName] = useState('');
    const [quantity, setQuantity] = useState('1');
    const [unitPrice, setUnitPrice] = useState('');
    const [charging, setCharging] = useState(false);

    const { company } = useManagerCompany(userId);
    const { billing } = useCompanyBilling(company?.id);
    const { data, isLoading } = useCreditEstablishments(company?.id);

    const supportsCredit =
        isHybridPlan(billing?.billing_plan) || isConsumptionOrLicensePlan(billing?.billing_plan);

    const activeEstablishments = useMemo(
        () => (data?.items ?? []).filter((e) => e.active && e.credit_acceptance_enabled),
        [data?.items],
    );

    const cartTotal = useMemo(
        () => cart.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0),
        [cart],
    );

    useEffect(() => {
        supabase.auth.getUser().then(({ data: { user } }) => setUserId(user?.id));
    }, []);

    useEffect(() => {
        if (!establishmentId && activeEstablishments.length > 0) {
            setEstablishmentId(activeEstablishments[0].id);
        }
    }, [activeEstablishments, establishmentId]);

    const resolveClient = async () => {
        if (!establishmentId || !walletToken.trim()) {
            showError('Selecione o PDV e cole o QR da carteira do cliente.');
            return;
        }
        setResolving(true);
        try {
            const { data: payload, error } = await supabase.functions.invoke('resolve-wallet-qr', {
                body: { walletToken: walletToken.trim(), establishmentId },
            });
            if (error) throw new Error(await parseEdgeFunctionError(error, payload));
            if (payload?.error) throw new Error(payload.error);
            setResolved({
                clientUserId: payload.clientUserId,
                balance: Number(payload.balance ?? 0),
                clientLabel: payload.clientLabel ?? 'Cliente',
            });
            showSuccess('Cliente identificado.');
        } catch (e: unknown) {
            setResolved(null);
            showError(e instanceof Error ? e.message : 'QR inválido.');
        } finally {
            setResolving(false);
        }
    };

    const addLine = () => {
        const qty = Number(quantity);
        const price = Number(unitPrice.replace(',', '.'));
        if (!productName.trim() || !Number.isFinite(qty) || qty <= 0 || !Number.isFinite(price) || price <= 0) {
            showError('Preencha produto, quantidade e preço válidos.');
            return;
        }
        setCart((prev) => [
            ...prev,
            { id: crypto.randomUUID(), productName: productName.trim(), quantity: qty, unitPrice: price },
        ]);
        setProductName('');
        setQuantity('1');
        setUnitPrice('');
    };

    const removeLine = (id: string) => setCart((prev) => prev.filter((l) => l.id !== id));

    const charge = async () => {
        if (!resolved || !establishmentId || cart.length === 0) {
            showError('Identifique o cliente e adicione produtos.');
            return;
        }
        if (resolved.balance < cartTotal) {
            showError(`Saldo insuficiente (${formatMoney(resolved.balance)}).`);
            return;
        }
        setCharging(true);
        try {
            const idempotencyKey = crypto.randomUUID();
            const { data: payload, error } = await supabase.functions.invoke('credit-spend-pdv', {
                body: {
                    walletToken: walletToken.trim(),
                    establishmentId,
                    items: cart.map((l) => ({
                        productName: l.productName,
                        quantity: l.quantity,
                        unitPrice: l.unitPrice,
                    })),
                    idempotencyKey,
                },
                headers: { 'x-idempotency-key': idempotencyKey },
            });
            if (error) throw new Error(await parseEdgeFunctionError(error, payload));
            if (payload?.error) throw new Error(payload.error);
            showSuccess(
                payload.duplicate
                    ? 'Venda já havia sido registrada.'
                    : `Venda concluída — ${formatMoney(Number(payload.grossAmount ?? cartTotal))}`,
            );
            setCart([]);
            setResolved(null);
            setWalletToken('');
        } catch (e: unknown) {
            showError(e instanceof Error ? e.message : 'Erro ao cobrar.');
        } finally {
            setCharging(false);
        }
    };

    if (!supportsCredit) {
        return (
            <div className="max-w-3xl mx-auto text-center py-16 text-gray-400">
                Plano não habilita PDV de crédito.
                <Button variant="outline" className="mt-4 block mx-auto" onClick={() => navigate('/manager/settings')}>
                    Voltar
                </Button>
            </div>
        );
    }

    return (
        <div className="max-w-3xl mx-auto">
            <h1 className="text-2xl font-serif text-yellow-500 flex items-center gap-2 mb-2">
                <ShoppingBag className="h-7 w-7" />
                PDV — Crédito EventFest
            </h1>
            <p className="text-gray-400 text-sm mb-6">
                Escaneie o QR da carteira do cliente (app) e registre produtos consumidos.
            </p>

            <Card className="bg-black border-yellow-500/30 mb-4">
                <CardHeader>
                    <CardTitle className="text-white text-lg">Ponto de venda</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                    {isLoading ? (
                        <Loader2 className="h-6 w-6 animate-spin text-yellow-500" />
                    ) : activeEstablishments.length === 0 ? (
                        <p className="text-sm text-amber-400">
                            Cadastre um estabelecimento ativo em{' '}
                            <button type="button" className="underline" onClick={() => navigate('/manager/credit/establishments')}>
                                Estabelecimentos
                            </button>
                            .
                        </p>
                    ) : (
                        <Select value={establishmentId} onValueChange={setEstablishmentId}>
                            <SelectTrigger className="bg-black/60 border-yellow-500/30 text-white">
                                <SelectValue placeholder="Selecione o PDV" />
                            </SelectTrigger>
                            <SelectContent className="bg-black border-yellow-500/30 text-white">
                                {activeEstablishments.map((e) => (
                                    <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    )}
                </CardContent>
            </Card>

            <Card className="bg-black border-yellow-500/30 mb-4">
                <CardHeader>
                    <CardTitle className="text-white text-lg flex items-center gap-2">
                        <ScanLine className="h-5 w-5 text-yellow-500" />
                        Cliente
                    </CardTitle>
                    <CardDescription className="text-gray-400">
                        Cole o código EFW lido do app do cliente (Carteira EventFest → Mostrar QR).
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                    <Input
                        value={walletToken}
                        onChange={(e) => setWalletToken(e.target.value)}
                        placeholder="EFW...."
                        className="bg-black/60 border-yellow-500/30 text-white font-mono text-xs"
                    />
                    <Button onClick={resolveClient} disabled={resolving} className="bg-yellow-500 text-black hover:bg-yellow-600">
                        {resolving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                        Identificar cliente
                    </Button>
                    {resolved && (
                        <div className="rounded-lg border border-green-500/30 bg-green-500/10 p-3 text-sm">
                            <p className="text-green-300 font-medium">{resolved.clientLabel}</p>
                            <p className="text-gray-300">Saldo: {formatMoney(resolved.balance)}</p>
                        </div>
                    )}
                </CardContent>
            </Card>

            <Card className="bg-black border-yellow-500/30 mb-4">
                <CardHeader>
                    <CardTitle className="text-white text-lg">Produtos</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <div className="sm:col-span-1">
                            <Label className="text-gray-400 text-xs">Nome</Label>
                            <Input value={productName} onChange={(e) => setProductName(e.target.value)} className="bg-black/60 border-yellow-500/30 text-white" />
                        </div>
                        <div>
                            <Label className="text-gray-400 text-xs">Qtd</Label>
                            <Input value={quantity} onChange={(e) => setQuantity(e.target.value)} className="bg-black/60 border-yellow-500/30 text-white" />
                        </div>
                        <div>
                            <Label className="text-gray-400 text-xs">Preço unit.</Label>
                            <Input value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} placeholder="0,00" className="bg-black/60 border-yellow-500/30 text-white" />
                        </div>
                    </div>
                    <Button variant="outline" className="border-yellow-500/40 text-yellow-500" onClick={addLine}>
                        Adicionar item
                    </Button>
                    {cart.length > 0 && (
                        <ul className="space-y-2 border-t border-yellow-500/20 pt-3">
                            {cart.map((line) => (
                                <li key={line.id} className="flex justify-between items-center text-sm">
                                    <span className="text-gray-200">
                                        {line.quantity}x {line.productName} — {formatMoney(line.quantity * line.unitPrice)}
                                    </span>
                                    <Button size="sm" variant="ghost" onClick={() => removeLine(line.id)}>
                                        <Trash2 className="h-4 w-4 text-red-400" />
                                    </Button>
                                </li>
                            ))}
                            <li className="flex justify-between font-semibold text-yellow-500 pt-2">
                                <span>Total</span>
                                <span>{formatMoney(cartTotal)}</span>
                            </li>
                        </ul>
                    )}
                </CardContent>
            </Card>

            <Button
                className="w-full bg-yellow-500 text-black hover:bg-yellow-600 py-6 text-lg"
                disabled={charging || !resolved || cart.length === 0}
                onClick={charge}
            >
                {charging ? <Loader2 className="h-5 w-5 animate-spin mr-2" /> : null}
                Cobrar com crédito EventFest
            </Button>

            <Button variant="ghost" className="mt-4 text-gray-400" onClick={() => navigate('/manager/credit/establishments')}>
                <ArrowLeft className="h-4 w-4 mr-1" /> Estabelecimentos
            </Button>
        </div>
    );
};

export default ManagerCreditPdv;
