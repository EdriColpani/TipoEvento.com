import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader2, QrCode, ScanLine, ShoppingBag, Trash2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import {
    AlertDialog,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { usePageAuth } from '@/hooks/use-page-auth';
import { useManagerCompany } from '@/hooks/use-manager-company';
import { useCreditEstablishments } from '@/hooks/use-credit-establishments';
import { useCreditEstablishmentProducts } from '@/hooks/use-credit-establishment-products';
import { isHybridPlan, isConsumptionOrLicensePlan } from '@/utils/company-billing-rules';
import { generateRandomUuid } from '@/utils/random-id';
import { useHtml5QrScanner } from '@/hooks/use-html5-qr-scanner';
import { useCompanyBilling } from '@/hooks/use-company-billing';
import { invokeEdgeFunctionRest } from '@/utils/edge-function-rest';
import { showError, showSuccess } from '@/utils/toast';
import { issueCreditMenuToken } from '@/hooks/use-credit-menu';
import QRCode from 'react-qr-code';
import { parseDeliveryQrToken } from '@/utils/credit-delivery-qr';
import {
    confirmManagerCreditConsumptionIntent,
    updateManagerCreditConsumptionIntentStatus,
    completeManagerCreditConsumptionDelivery,
    previewManagerCreditConsumptionDelivery,
    useManagerCreditConsumptionIntents,
    type CreditConsumptionIntentStatus,
} from '@/hooks/use-credit-consumption-intents';

const PDV_WALLET_QR_READER_ID = 'pdv-wallet-qr-reader';
const PDV_DELIVERY_QR_READER_ID = 'pdv-delivery-qr-reader';

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

type DeliveryPreviewState = {
    token: string;
    intent_id: string;
    status: string;
    gross_amount: number;
    paid_at: string | null;
    client_label?: string | null;
    client_public_id?: string | null;
    establishment_name?: string | null;
    event_title?: string | null;
    can_confirm: boolean;
    block_reason?: string | null;
    items: Array<{
        product_id: string;
        product_name: string;
        quantity: number;
        unit_price: number;
        line_total: number;
        description?: string | null;
        image_url?: string | null;
        packaging_type?: string | null;
        units_per_box?: number | null;
    }>;
};

function formatMoney(value: number): string {
    return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

const ManagerCreditPdv: React.FC = () => {
    const navigate = useNavigate();
    const { userId, authPending, sessionReady } = usePageAuth();
    const [establishmentId, setEstablishmentId] = useState('');
    const [walletToken, setWalletToken] = useState('');
    const [resolved, setResolved] = useState<ResolvedClient | null>(null);
    const [resolving, setResolving] = useState(false);
    const [cart, setCart] = useState<CartLine[]>([]);
    const [productName, setProductName] = useState('');
    const [quantity, setQuantity] = useState('1');
    const [unitPrice, setUnitPrice] = useState('');
    const [selectedCatalogProductId, setSelectedCatalogProductId] = useState('none');
    const [charging, setCharging] = useState(false);
    const [menuQrOpen, setMenuQrOpen] = useState(false);
    const [menuQrUrl, setMenuQrUrl] = useState('');
    const [menuQrLoading, setMenuQrLoading] = useState(false);
    const [intentsStatusFilter, setIntentsStatusFilter] = useState<'all' | CreditConsumptionIntentStatus>('all');
    const [updatingIntentId, setUpdatingIntentId] = useState<string | null>(null);
    const [expandedHistoryByIntent, setExpandedHistoryByIntent] = useState<Record<string, boolean>>({});
    const [historyPeriodFilter, setHistoryPeriodFilter] = useState<'all' | 'today' | '7d' | '30d'>('7d');
    const [historyOperatorFilter, setHistoryOperatorFilter] = useState<string>('all');
    const [deliveryTokenInput, setDeliveryTokenInput] = useState('');
    const [deliveringToken, setDeliveringToken] = useState(false);
    const [loadingDeliveryPreview, setLoadingDeliveryPreview] = useState(false);
    const [deliveryPreview, setDeliveryPreview] = useState<DeliveryPreviewState | null>(null);
    const [cancelDialogIntent, setCancelDialogIntent] = useState<{
        id: string;
        paid: boolean;
        label: string;
    } | null>(null);
    const [cancelReason, setCancelReason] = useState('');
    const [cancellingIntent, setCancellingIntent] = useState(false);
    const deliveryQrSectionRef = useRef<HTMLDivElement | null>(null);

    const { company, isLoading: loadingCompany } = useManagerCompany(userId);
    const { billing, isLoading: loadingBilling } = useCompanyBilling(company?.id);
    const { data, isLoading, isFetching } = useCreditEstablishments(company?.id);
    const { data: productsData, isLoading: loadingProducts } = useCreditEstablishmentProducts(
        company?.id,
        establishmentId || undefined,
    );
    const { data: intentsData, isLoading: loadingIntents, invalidate: invalidateIntents } =
        useManagerCreditConsumptionIntents(company?.id, intentsStatusFilter);

    const { isScanning, startScanning, stopScanning } = useHtml5QrScanner(PDV_WALLET_QR_READER_ID);
    const {
        isScanning: isDeliveryScanning,
        startScanning: startDeliveryScanning,
        stopScanning: stopDeliveryScanning,
    } = useHtml5QrScanner(PDV_DELIVERY_QR_READER_ID);

    const supportsCredit =
        isHybridPlan(billing?.billing_plan) || isConsumptionOrLicensePlan(billing?.billing_plan);

    const planStillLoading =
        authPending ||
        !sessionReady ||
        loadingCompany ||
        (Boolean(company?.id) && loadingBilling && billing === undefined);

    const activeEstablishments = useMemo(
        () => (data?.items ?? []).filter((e) => e.active && e.credit_acceptance_enabled),
        [data?.items],
    );

    const cartTotal = useMemo(
        () => cart.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0),
        [cart],
    );
    const activeProducts = useMemo(
        () => (productsData?.items ?? []).filter((p) => p.active),
        [productsData?.items],
    );

    useEffect(() => {
        if (!establishmentId && activeEstablishments.length > 0) {
            setEstablishmentId(activeEstablishments[0].id);
        }
    }, [activeEstablishments, establishmentId]);

    useEffect(() => {
        setSelectedCatalogProductId('none');
    }, [establishmentId]);

    const resolveClientWithToken = async (tokenRaw: string) => {
        const token = tokenRaw.trim().toUpperCase();
        if (!establishmentId) {
            showError('Selecione o ponto de venda antes de identificar o cliente.');
            return;
        }
        if (!token) {
            showError('Leia o QR da carteira do cliente.');
            return;
        }
        setWalletToken(token);
        setResolving(true);
        try {
            const payload = await invokeEdgeFunctionRest<{
                error?: string;
                clientUserId: string;
                walletToken?: string;
                balance?: number;
                clientLabel?: string;
            }>('resolve-wallet-qr', { walletToken: token, establishmentId }, { timeoutMs: 12_000 });
            if (payload?.error) throw new Error(payload.error);
            const normalizedWalletToken = (payload.walletToken ?? token).trim();
            setWalletToken(normalizedWalletToken);
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

    const resolveClient = () => resolveClientWithToken(walletToken);

    const handleStartWalletScan = () => {
        if (!establishmentId) {
            showError('Selecione o ponto de venda antes de escanear.');
            return;
        }
        void startScanning((text) => resolveClientWithToken(text));
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
            { id: generateRandomUuid(), productName: productName.trim(), quantity: qty, unitPrice: price },
        ]);
        setProductName('');
        setQuantity('1');
        setUnitPrice('');
    };

    const addCatalogLine = () => {
        if (selectedCatalogProductId === 'none') {
            showError('Selecione um produto do catálogo.');
            return;
        }
        const product = activeProducts.find((p) => p.id === selectedCatalogProductId);
        if (!product) {
            showError('Produto não encontrado.');
            return;
        }
        const qty = Number(quantity);
        if (!Number.isFinite(qty) || qty <= 0) {
            showError('Quantidade inválida.');
            return;
        }
        setCart((prev) => [
            ...prev,
            { id: generateRandomUuid(), productName: product.name, quantity: qty, unitPrice: Number(product.unit_price) },
        ]);
        setQuantity('1');
        setSelectedCatalogProductId('none');
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
            const idempotencyKey = generateRandomUuid();
            const payload = await invokeEdgeFunctionRest<{
                error?: string;
                duplicate?: boolean;
                grossAmount?: number;
                mpDisbursementPending?: boolean;
            }>(
                'credit-spend-pdv',
                {
                    walletToken: walletToken.trim(),
                    establishmentId,
                    items: cart.map((l) => ({
                        productName: l.productName,
                        quantity: l.quantity,
                        unitPrice: l.unitPrice,
                    })),
                    idempotencyKey,
                },
                { idempotencyKey, timeoutMs: 25_000 },
            );
            if (payload?.error) throw new Error(payload.error);
            if (payload.settlementQueued) {
                showSuccess(
                    `Venda concluída — ${formatMoney(Number(payload.grossAmount ?? cartTotal))}. Repasse ao gestor em liquidação manual D+1.`,
                );
            } else {
                showSuccess(
                    payload.duplicate
                        ? 'Venda já havia sido registrada.'
                        : `Venda concluída — ${formatMoney(Number(payload.grossAmount ?? cartTotal))}`,
                );
            }
            setCart([]);
            setResolved(null);
            setWalletToken('');
        } catch (e: unknown) {
            showError(e instanceof Error ? e.message : 'Erro ao cobrar.');
        } finally {
            setCharging(false);
        }
    };

    const openMenuQr = async () => {
        if (!establishmentId) {
            showError('Selecione o PDV para gerar o QR de balcão.');
            return;
        }
        setMenuQrLoading(true);
        try {
            const issued = await issueCreditMenuToken(establishmentId);
            const origin = window.location.origin;
            const url = `${origin}/wallet/consumo?m=${encodeURIComponent(issued.token)}`;
            setMenuQrUrl(url);
            setMenuQrOpen(true);
        } catch (e: unknown) {
            showError(e instanceof Error ? e.message : 'Erro ao gerar QR do balcão.');
        } finally {
            setMenuQrLoading(false);
        }
    };

    const formatIntentStatus = (status: CreditConsumptionIntentStatus | string) => {
        if (status === 'new') return 'Novo';
        if (status === 'in_preparation') return 'Em preparo';
        if (status === 'ready_for_pickup') return 'Pronto p/ retirada';
        if (status === 'completed') return 'Entregue';
        if (status === 'cancelled') return 'Cancelado';
        return 'Expirado';
    };

    const intentStatusBadgeClass = (status: CreditConsumptionIntentStatus | string) => {
        switch (status) {
            case 'ready_for_pickup':
                return 'bg-sky-500/15 border-sky-400/50 text-sky-300';
            case 'in_preparation':
                return 'bg-amber-500/15 border-amber-400/50 text-amber-300';
            case 'completed':
                return 'bg-emerald-500/20 border-emerald-400/60 text-emerald-300';
            case 'cancelled':
                return 'bg-red-500/15 border-red-400/50 text-red-300';
            case 'new':
                return 'bg-yellow-500/10 border-yellow-500/40 text-yellow-400';
            default:
                return 'bg-gray-500/15 border-gray-500/40 text-gray-400';
        }
    };

    const intentCardBorderClass = (status: CreditConsumptionIntentStatus | string) => {
        if (status === 'completed') return 'border-emerald-500/40 bg-emerald-950/20';
        if (status === 'ready_for_pickup') return 'border-sky-500/35 bg-sky-950/15';
        if (status === 'cancelled') return 'border-red-500/30 bg-red-950/10';
        if (status === 'in_preparation') return 'border-amber-500/30 bg-amber-950/10';
        return 'border-yellow-500/20';
    };

    const formatHistorySource = (source: string) => {
        if (source === 'manager_panel') return 'Painel gestor';
        if (source === 'customer_app') return 'App cliente';
        if (source === 'customer_web') return 'Web cliente';
        if (source === 'system') return 'Sistema';
        return source;
    };

    const toggleIntentHistory = (intentId: string) => {
        setExpandedHistoryByIntent((prev) => ({ ...prev, [intentId]: !prev[intentId] }));
    };

    const availableHistoryOperators = useMemo(() => {
        const labels = new Set<string>();
        for (const intent of intentsData?.items ?? []) {
            for (const step of intent.status_history ?? []) {
                if (step.changed_by_label) labels.add(step.changed_by_label);
            }
        }
        return Array.from(labels).sort((a, b) => a.localeCompare(b, 'pt-BR'));
    }, [intentsData?.items]);

    const filterHistorySteps = (
        steps: Array<{
            id: string;
            from_status: string | null;
            to_status: string;
            source: string;
            notes: string | null;
            created_at: string;
            changed_by_user_id: string | null;
            changed_by_label: string;
        }>,
    ) => {
        const now = Date.now();
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        return steps.filter((step) => {
            const createdAt = new Date(step.created_at).getTime();
            if (Number.isNaN(createdAt)) return false;

            if (historyPeriodFilter === 'today' && createdAt < today.getTime()) return false;
            if (historyPeriodFilter === '7d' && now - createdAt > 7 * 24 * 60 * 60 * 1000) return false;
            if (historyPeriodFilter === '30d' && now - createdAt > 30 * 24 * 60 * 60 * 1000) return false;

            if (historyOperatorFilter !== 'all' && step.changed_by_label !== historyOperatorFilter) return false;

            return true;
        });
    };

    const setIntentStatus = async (
        intentId: string,
        status: 'in_preparation' | 'ready_for_pickup' | 'cancelled',
        notes?: string,
    ) => {
        if (!company?.id) return;
        setUpdatingIntentId(intentId);
        try {
            const result = await updateManagerCreditConsumptionIntentStatus({
                companyId: company.id,
                intentId,
                status,
                notes: notes ?? null,
            });
            if (status === 'cancelled' && result.refunded) {
                showSuccess('Pedido cancelado e crédito estornado ao cliente.');
            } else if (status === 'cancelled') {
                showSuccess('Pedido cancelado.');
            } else {
                showSuccess('Status do pedido atualizado.');
            }
            invalidateIntents();
        } catch (e: unknown) {
            showError(e instanceof Error ? e.message : 'Erro ao atualizar pedido.');
        } finally {
            setUpdatingIntentId(null);
        }
    };

    const confirmCancelIntent = async () => {
        if (!cancelDialogIntent) return;
        const reason = cancelReason.trim();
        if (!reason) {
            showError('Informe o motivo do cancelamento.');
            return;
        }
        setCancellingIntent(true);
        try {
            await setIntentStatus(cancelDialogIntent.id, 'cancelled', reason);
            setCancelDialogIntent(null);
            setCancelReason('');
        } finally {
            setCancellingIntent(false);
        }
    };

    const confirmIntentPayment = async (intentId: string) => {
        setUpdatingIntentId(intentId);
        try {
            await confirmManagerCreditConsumptionIntent({ intentId });
            showSuccess('Pedido cobrado com crédito EventFest.');
            invalidateIntents();
        } catch (e: unknown) {
            showError(e instanceof Error ? e.message : 'Erro ao cobrar pedido.');
        } finally {
            setUpdatingIntentId(null);
        }
    };

    const loadDeliveryPreview = async (rawToken?: string) => {
        if (!company?.id) return;
        const token = (rawToken ?? deliveryTokenInput).trim();
        if (!token) {
            showError('Informe ou escaneie o QR do pedido.');
            return;
        }
        const normalized = parseDeliveryQrToken(token);
        if (!normalized) {
            showError('QR de pedido inválido. Use o código EFDEL do cliente.');
            return;
        }
        setLoadingDeliveryPreview(true);
        try {
            const preview = await previewManagerCreditConsumptionDelivery({
                companyId: company.id,
                deliveryToken: normalized,
            });
            setDeliveryPreview({
                token: normalized,
                intent_id: preview.intent_id,
                status: preview.status,
                gross_amount: Number(preview.gross_amount ?? 0),
                paid_at: preview.paid_at,
                client_label: preview.client_label,
                client_public_id: preview.client_public_id,
                establishment_name: preview.establishment_name,
                event_title: preview.event_title,
                can_confirm: preview.can_confirm === true,
                block_reason: preview.block_reason,
                items: preview.items ?? [],
            });
            setDeliveryTokenInput(normalized);
            if (!preview.can_confirm && preview.block_reason) {
                showError(preview.block_reason);
            }
        } catch (e: unknown) {
            showError(e instanceof Error ? e.message : 'Erro ao ler QR do pedido.');
            setDeliveryPreview(null);
        } finally {
            setLoadingDeliveryPreview(false);
        }
    };

    const confirmDeliveryFromPreview = async () => {
        if (!company?.id || !deliveryPreview) return;
        if (!deliveryPreview.can_confirm) {
            showError(deliveryPreview.block_reason ?? 'Este pedido não pode ser entregue.');
            return;
        }
        setDeliveringToken(true);
        try {
            const result = await completeManagerCreditConsumptionDelivery({
                companyId: company.id,
                deliveryToken: deliveryPreview.token,
                intentId: deliveryPreview.intent_id,
            });
            showSuccess(
                result.client_label
                    ? `Entrega confirmada para ${result.client_label}. QR invalidado.`
                    : 'Entrega confirmada. QR invalidado.',
            );
            setDeliveryPreview(null);
            setDeliveryTokenInput('');
            invalidateIntents();
        } catch (e: unknown) {
            showError(e instanceof Error ? e.message : 'Erro ao confirmar entrega.');
        } finally {
            setDeliveringToken(false);
        }
    };

    const handleStartDeliveryScan = async () => {
        if (isScanning) await stopScanning();
        await startDeliveryScanning(async (text) => {
            setDeliveryTokenInput(text);
            await loadDeliveryPreview(text);
        });
    };

    const focusDeliveryQrCapture = async () => {
        deliveryQrSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        showSuccess('Leia o QR EFDEL do cliente para ver o pedido antes de confirmar.');
        if (!isDeliveryScanning) {
            await handleStartDeliveryScan();
        }
    };

    if (planStillLoading) {
        return (
            <div className="max-w-3xl mx-auto text-center py-16">
                <Loader2 className="h-10 w-10 animate-spin text-yellow-500 mx-auto mb-4" />
                <p className="text-gray-400">Carregando plano da empresa...</p>
            </div>
        );
    }

    if (!supportsCredit) {
        return (
            <div className="max-w-3xl mx-auto text-center py-16 text-gray-400">
                Plano não habilita PDV de crédito. Confirme o plano{' '}
                <strong className="text-white">Consumo / licença</strong> em Configurações → Perfil da
                Empresa → Plano.
                <Button
                    variant="outline"
                    className="mt-4 block mx-auto bg-black/60 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10"
                    onClick={() => navigate('/manager/settings/company-profile?tab=billing')}
                >
                    Ir para Plano e cobrança
                </Button>
            </div>
        );
    }

    return (
        <div className="max-w-3xl mx-auto">
            <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
                <div>
                    <h1 className="text-2xl font-serif text-yellow-500 flex items-center gap-2">
                        <ShoppingBag className="h-7 w-7" />
                        PDV — Crédito EventFest
                    </h1>
                    <p className="text-gray-400 text-sm mt-1">
                        Escaneie o QR da carteira do cliente com a câmera ou leitor USB — a identificação é automática.
                    </p>
                </div>
                <Button
                    type="button"
                    variant="outline"
                    className="bg-black/60 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 hover:text-yellow-400"
                    onClick={() => navigate('/manager/settings')}
                >
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Voltar
                </Button>
            </div>

            <Card className="bg-black border-yellow-500/30 mb-4">
                <CardHeader>
                    <CardTitle className="text-white text-lg">Ponto de venda</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                    {isLoading && isFetching && !(data?.items?.length) ? (
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
                        <>
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
                            <Button
                                type="button"
                                variant="outline"
                                className="bg-black/60 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 hover:text-yellow-400 disabled:opacity-50"
                                onClick={openMenuQr}
                                disabled={menuQrLoading}
                            >
                                {menuQrLoading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                                Exibir QR do balcão (cardápio)
                            </Button>
                        </>
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
                        Cliente: Carteira EventFest → Mostrar QR no PDV. Use a câmera, leitor USB ou digite o código
                        do cliente.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                    <div className="flex flex-col sm:flex-row gap-2">
                        {!isScanning ? (
                            <Button
                                type="button"
                                className="flex-1 min-h-12 bg-yellow-500 text-black hover:bg-yellow-600 disabled:opacity-50"
                                onClick={handleStartWalletScan}
                                disabled={resolving || !establishmentId}
                            >
                                {resolving ? (
                                    <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                                ) : (
                                    <QrCode className="h-5 w-5 mr-2" />
                                )}
                                Escanear QR da carteira
                            </Button>
                        ) : (
                            <Button
                                type="button"
                                variant="outline"
                                className="flex-1 min-h-12 bg-black/60 border border-red-500/40 text-red-400 hover:bg-red-500/10"
                                onClick={() => void stopScanning()}
                            >
                                <XCircle className="h-5 w-5 mr-2" />
                                Parar câmera
                            </Button>
                        )}
                    </div>

                    <div className={isScanning ? '' : 'sr-only'} aria-hidden={!isScanning}>
                        <div
                            id={PDV_WALLET_QR_READER_ID}
                            className="relative min-h-[260px] w-full bg-black rounded-lg overflow-hidden border border-yellow-500/30"
                        />
                        {isScanning && (
                            <p className="text-center text-gray-400 text-sm mt-2">
                                Aponte para o QR no celular do cliente
                            </p>
                        )}
                    </div>

                    <div className="border-t border-yellow-500/20 pt-3 space-y-2">
                        <p className="text-gray-500 text-xs">Leitor USB, QR da carteira ou código do cliente (Enter confirma)</p>
                        <Input
                            value={walletToken}
                            onChange={(e) => setWalletToken(e.target.value.toUpperCase())}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    e.preventDefault();
                                    void resolveClient();
                                }
                            }}
                            placeholder="EFW.... ou código do cliente"
                            className="bg-black/60 border-yellow-500/30 text-white font-mono text-xs uppercase tracking-wider"
                            disabled={resolving || isScanning}
                            autoComplete="off"
                            autoCapitalize="characters"
                            spellCheck={false}
                        />
                        <Button
                            type="button"
                            variant="outline"
                            onClick={resolveClient}
                            disabled={resolving || isScanning || !walletToken.trim()}
                            className="bg-black/60 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 hover:text-yellow-400 disabled:opacity-50"
                        >
                            {resolving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                            Identificar cliente
                        </Button>
                    </div>
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
                    <div className="rounded-lg border border-yellow-500/20 p-3 space-y-3">
                        <p className="text-gray-400 text-xs font-medium">Adicionar do catálogo</p>
                        {loadingProducts ? (
                            <Loader2 className="h-4 w-4 animate-spin text-yellow-500" />
                        ) : activeProducts.length === 0 ? (
                            <p className="text-xs text-amber-400">
                                Sem produtos no catálogo deste PDV. Você ainda pode digitar manualmente abaixo.
                            </p>
                        ) : (
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 items-end">
                                <div className="sm:col-span-2 space-y-1">
                                    <Label className="text-gray-400 text-xs">Produto</Label>
                                    <Select value={selectedCatalogProductId} onValueChange={setSelectedCatalogProductId}>
                                        <SelectTrigger className="h-10 w-full bg-black/60 border-yellow-500/30 text-white">
                                            <SelectValue placeholder="Selecione um produto" />
                                        </SelectTrigger>
                                        <SelectContent className="bg-black border-yellow-500/30 text-white">
                                            <SelectItem value="none">Selecione...</SelectItem>
                                            {activeProducts.map((p) => (
                                                <SelectItem key={p.id} value={p.id}>
                                                    {p.name} — {formatMoney(Number(p.unit_price))}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-1">
                                    <Label className="text-gray-400 text-xs">Qtd</Label>
                                    <Input
                                        value={quantity}
                                        onChange={(e) => setQuantity(e.target.value)}
                                        className="h-10 bg-black/60 border-yellow-500/30 text-white"
                                    />
                                </div>
                            </div>
                        )}
                        <Button
                            variant="outline"
                            className="bg-black/60 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 hover:text-yellow-400"
                            onClick={addCatalogLine}
                            disabled={activeProducts.length === 0}
                        >
                            Adicionar do catálogo
                        </Button>
                    </div>

                    <div className="border-t border-yellow-500/20 pt-3 space-y-3">
                        <p className="text-gray-400 text-xs font-medium">Adicionar item manual</p>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 items-end">
                            <div className="space-y-1">
                                <Label className="text-gray-400 text-xs">Nome</Label>
                                <Input
                                    value={productName}
                                    onChange={(e) => setProductName(e.target.value)}
                                    className="h-10 bg-black/60 border-yellow-500/30 text-white"
                                />
                            </div>
                            <div className="space-y-1">
                                <Label className="text-gray-400 text-xs">Qtd</Label>
                                <Input
                                    value={quantity}
                                    onChange={(e) => setQuantity(e.target.value)}
                                    className="h-10 bg-black/60 border-yellow-500/30 text-white"
                                />
                            </div>
                            <div className="space-y-1">
                                <Label className="text-gray-400 text-xs">Preço unit.</Label>
                                <Input
                                    value={unitPrice}
                                    onChange={(e) => setUnitPrice(e.target.value)}
                                    placeholder="0,00"
                                    className="h-10 bg-black/60 border-yellow-500/30 text-white"
                                />
                            </div>
                        </div>
                        <Button
                            variant="outline"
                            className="bg-black/60 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 hover:text-yellow-400"
                            onClick={addLine}
                        >
                            Adicionar item
                        </Button>
                    </div>
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

            <Button
                type="button"
                variant="outline"
                className="mt-4 bg-black/60 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 hover:text-yellow-400"
                onClick={() => navigate('/manager/credit/establishments')}
            >
                <ArrowLeft className="h-4 w-4 mr-1" /> Estabelecimentos
            </Button>

            <Card className="bg-black border-yellow-500/30 mt-6">
                <CardHeader>
                    <CardTitle className="text-white text-lg">Painel de atendimento</CardTitle>
                    <CardDescription className="text-gray-400">
                        Pedidos do cardápio. Toda entrega exige leitura do QR EFDEL do cliente.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                    <div
                        ref={deliveryQrSectionRef}
                        className="rounded-lg border border-yellow-500/20 p-3 space-y-2"
                    >
                        <Label className="text-gray-300">QR do pedido (obrigatório para entrega)</Label>
                        <div className="flex flex-col sm:flex-row gap-2">
                            <Input
                                value={deliveryTokenInput}
                                onChange={(e) => setDeliveryTokenInput(e.target.value)}
                                placeholder="EFDEL...."
                                className="bg-black/60 border-yellow-500/30 text-white font-mono text-sm"
                            />
                            <Button
                                type="button"
                                variant="outline"
                                className="bg-black/60 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 hover:text-yellow-400 disabled:opacity-50 shrink-0"
                                onClick={() => void loadDeliveryPreview()}
                                disabled={loadingDeliveryPreview || !deliveryTokenInput.trim()}
                            >
                                {loadingDeliveryPreview ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                                Ver pedido
                            </Button>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            {!isDeliveryScanning ? (
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="bg-black/60 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10"
                                    onClick={() => void handleStartDeliveryScan()}
                                    disabled={deliveringToken || loadingDeliveryPreview}
                                >
                                    <ScanLine className="h-4 w-4 mr-1" />
                                    Escanear QR do pedido
                                </Button>
                            ) : (
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="bg-black/60 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10"
                                    onClick={() => void stopDeliveryScanning()}
                                >
                                    <XCircle className="h-4 w-4 mr-1" />
                                    Parar câmera
                                </Button>
                            )}
                        </div>
                        <div className={isDeliveryScanning ? '' : 'sr-only'} aria-hidden={!isDeliveryScanning}>
                            <div
                                id={PDV_DELIVERY_QR_READER_ID}
                                className="overflow-hidden rounded-lg border border-yellow-500/30 min-h-[200px]"
                            />
                            {isDeliveryScanning ? (
                                <p className="text-xs text-gray-500 mt-2">Aponte a câmera para o QR EFDEL do cliente.</p>
                            ) : null}
                        </div>
                    </div>
                    <div className="max-w-xs">
                        <Select value={intentsStatusFilter} onValueChange={(v) => setIntentsStatusFilter(v as 'all' | CreditConsumptionIntentStatus)}>
                            <SelectTrigger className="bg-black/60 border-yellow-500/30 text-white">
                                <SelectValue placeholder="Filtrar status" />
                            </SelectTrigger>
                            <SelectContent className="bg-black border-yellow-500/30 text-white">
                                <SelectItem value="all">Todos</SelectItem>
                                <SelectItem value="new">Novo</SelectItem>
                                <SelectItem value="in_preparation">Em preparo</SelectItem>
                                <SelectItem value="ready_for_pickup">Pronto p/ retirada</SelectItem>
                                <SelectItem value="completed">Entregue</SelectItem>
                                <SelectItem value="cancelled">Cancelado</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-w-xl">
                        <Select value={historyPeriodFilter} onValueChange={(v) => setHistoryPeriodFilter(v as 'all' | 'today' | '7d' | '30d')}>
                            <SelectTrigger className="bg-black/60 border-yellow-500/30 text-white">
                                <SelectValue placeholder="Período do histórico" />
                            </SelectTrigger>
                            <SelectContent className="bg-black border-yellow-500/30 text-white">
                                <SelectItem value="all">Histórico: todo período</SelectItem>
                                <SelectItem value="today">Histórico: hoje</SelectItem>
                                <SelectItem value="7d">Histórico: últimos 7 dias</SelectItem>
                                <SelectItem value="30d">Histórico: últimos 30 dias</SelectItem>
                            </SelectContent>
                        </Select>
                        <Select value={historyOperatorFilter} onValueChange={setHistoryOperatorFilter}>
                            <SelectTrigger className="bg-black/60 border-yellow-500/30 text-white">
                                <SelectValue placeholder="Operador" />
                            </SelectTrigger>
                            <SelectContent className="bg-black border-yellow-500/30 text-white">
                                <SelectItem value="all">Operador: todos</SelectItem>
                                {availableHistoryOperators.map((label) => (
                                    <SelectItem key={label} value={label}>
                                        {label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    {loadingIntents ? (
                        <Loader2 className="h-5 w-5 animate-spin text-yellow-500" />
                    ) : (intentsData?.items?.length ?? 0) === 0 ? (
                        <p className="text-sm text-gray-500">Nenhum pedido no filtro selecionado.</p>
                    ) : (
                        <ul className="space-y-3">
                            {intentsData!.items.map((intent) => (
                                <li
                                    key={intent.id}
                                    className={`rounded-xl p-3 space-y-2 border ${intentCardBorderClass(intent.status)}`}
                                >
                                    <div className="flex items-center justify-between gap-2">
                                        <p className="text-white text-sm">
                                            {intent.establishment_name} · {formatMoney(Number(intent.gross_amount))}
                                        </p>
                                        <span
                                            className={`shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold tracking-wide ${intentStatusBadgeClass(intent.status)}`}
                                        >
                                            {formatIntentStatus(intent.status)}
                                        </span>
                                    </div>
                                    <p className="text-xs text-gray-400">
                                        Cliente:{' '}
                                        {intent.client_label || '—'}
                                        {intent.client_public_id ? ` · #${intent.client_public_id}` : ''}
                                        {intent.event_title ? ` · ${intent.event_title}` : ''}
                                    </p>
                                    <p className="text-xs text-gray-500">
                                        {new Date(intent.created_at).toLocaleString('pt-BR')}
                                        {intent.paid_at
                                            ? ` · pago ${new Date(intent.paid_at).toLocaleString('pt-BR')}`
                                            : ''}
                                        {intent.delivered_at ? (
                                            <span className="text-emerald-400 font-medium">
                                                {` · entregue ${new Date(intent.delivered_at).toLocaleString('pt-BR')}`}
                                            </span>
                                        ) : null}
                                        {' · biometria '}
                                        {intent.biometric_required
                                            ? intent.biometric_confirmed ? 'confirmada' : 'pendente'
                                            : 'não exigida'}
                                    </p>
                                    {intent.status_history?.[0] ? (
                                        <p className="text-xs text-gray-500">
                                            Última transição: {formatIntentStatus(intent.status_history[0].to_status as CreditConsumptionIntentStatus)} ·{' '}
                                            {intent.status_history[0].changed_by_label} ·{' '}
                                            {new Date(intent.status_history[0].created_at).toLocaleString('pt-BR')}
                                        </p>
                                    ) : null}
                                    {(intent.status_history?.length ?? 0) > 0 && (
                                        <div className="rounded-lg border border-yellow-500/20 bg-black/40">
                                            <button
                                                type="button"
                                                className="w-full text-left px-3 py-2 text-xs text-yellow-500 hover:bg-yellow-500/10 transition-colors"
                                                onClick={() => toggleIntentHistory(intent.id)}
                                            >
                                                {expandedHistoryByIntent[intent.id] ? 'Ocultar' : 'Mostrar'} histórico completo
                                                {' '}({intent.status_history.length})
                                            </button>
                                            {expandedHistoryByIntent[intent.id] && (
                                                <ul className="px-3 pb-3 space-y-2">
                                                    {filterHistorySteps(intent.status_history ?? []).length === 0 ? (
                                                        <li className="text-xs text-gray-500 py-1">
                                                            Nenhuma transição para os filtros selecionados.
                                                        </li>
                                                    ) : filterHistorySteps(intent.status_history ?? []).map((step) => (
                                                        <li
                                                            key={step.id}
                                                            className="border-l-2 border-yellow-500/30 pl-3 py-1 text-xs"
                                                        >
                                                            <p className="text-gray-200">
                                                                <span
                                                                    className={
                                                                        step.to_status === 'completed'
                                                                            ? 'text-emerald-400 font-medium'
                                                                            : step.to_status === 'ready_for_pickup'
                                                                              ? 'text-sky-300 font-medium'
                                                                              : step.to_status === 'cancelled'
                                                                                ? 'text-red-300 font-medium'
                                                                                : 'text-yellow-500'
                                                                    }
                                                                >
                                                                    {step.from_status
                                                                        ? `${formatIntentStatus(step.from_status as CreditConsumptionIntentStatus)} -> `
                                                                        : ''}
                                                                    {formatIntentStatus(step.to_status as CreditConsumptionIntentStatus)}
                                                                </span>
                                                            </p>
                                                            <p className="text-gray-500">
                                                                {new Date(step.created_at).toLocaleString('pt-BR')} ·{' '}
                                                                {step.changed_by_label} · {formatHistorySource(step.source)}
                                                            </p>
                                                            {step.notes ? (
                                                                <p className="text-gray-500 mt-0.5">{step.notes}</p>
                                                            ) : null}
                                                        </li>
                                                    ))}
                                                </ul>
                                            )}
                                        </div>
                                    )}
                                    <ul className="text-xs text-gray-300 space-y-1">
                                        {(intent.items ?? []).map((item) => (
                                            <li key={`${intent.id}-${item.product_id}`}>
                                                {item.quantity}x {item.product_name}
                                            </li>
                                        ))}
                                    </ul>
                                    {intent.status !== 'completed' && intent.status !== 'cancelled' && (
                                        <div className="flex flex-wrap gap-2">
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                className="bg-black/60 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 hover:text-yellow-400 disabled:opacity-50"
                                                onClick={() => setIntentStatus(intent.id, 'in_preparation')}
                                                disabled={updatingIntentId === intent.id}
                                            >
                                                Em preparo
                                            </Button>
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                className="bg-black/60 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 hover:text-yellow-400 disabled:opacity-50"
                                                onClick={() => setIntentStatus(intent.id, 'ready_for_pickup')}
                                                disabled={updatingIntentId === intent.id}
                                            >
                                                Pronto
                                            </Button>
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                className="bg-black/60 border border-red-500/40 text-red-400 hover:bg-red-500/10 hover:text-red-300 disabled:opacity-50"
                                                onClick={() => {
                                                    setCancelReason('');
                                                    setCancelDialogIntent({
                                                        id: intent.id,
                                                        paid: Boolean(intent.spend_order_id || intent.paid_at),
                                                        label: `${intent.establishment_name ?? 'Pedido'} · ${formatMoney(Number(intent.gross_amount ?? 0))}`,
                                                    });
                                                }}
                                                disabled={updatingIntentId === intent.id}
                                            >
                                                Cancelar
                                            </Button>
                                            {intent.spend_order_id ? (
                                                <Button
                                                    size="sm"
                                                    className="bg-yellow-500 text-black hover:bg-yellow-600 disabled:opacity-50"
                                                    onClick={() => void focusDeliveryQrCapture()}
                                                    disabled={updatingIntentId === intent.id || deliveringToken}
                                                >
                                                    <ScanLine className="h-4 w-4 mr-1" />
                                                    Ler QR para entregar
                                                </Button>
                                            ) : (
                                                <Button
                                                    size="sm"
                                                    className="bg-yellow-500 text-black hover:bg-yellow-600 disabled:opacity-50"
                                                    onClick={() => void confirmIntentPayment(intent.id)}
                                                    disabled={
                                                        updatingIntentId === intent.id
                                                        || (intent.biometric_required && !intent.biometric_confirmed)
                                                    }
                                                >
                                                    Cobrar agora
                                                </Button>
                                            )}
                                        </div>
                                    )}
                                </li>
                            ))}
                        </ul>
                    )}
                </CardContent>
            </Card>

            <AlertDialog
                open={Boolean(deliveryPreview)}
                onOpenChange={(open) => {
                    if (!open && !deliveringToken) {
                        setDeliveryPreview(null);
                    }
                }}
            >
                <AlertDialogContent className="bg-black border border-yellow-500/40 text-white max-w-lg">
                    <AlertDialogHeader>
                        <AlertDialogTitle className="text-yellow-500">Conferir entrega</AlertDialogTitle>
                        <AlertDialogDescription className="text-gray-400">
                            Confira o cliente e os produtos antes de confirmar a entrega.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    {deliveryPreview ? (
                        <div className="space-y-4 text-sm">
                            <div className="rounded-lg border border-yellow-500/20 bg-black/40 p-3 space-y-1">
                                <p className="text-white font-medium">
                                    {deliveryPreview.client_label ?? 'Cliente'}
                                    {deliveryPreview.client_public_id
                                        ? ` · #${deliveryPreview.client_public_id}`
                                        : ''}
                                </p>
                                <p className="text-gray-400">
                                    {deliveryPreview.establishment_name ?? 'Estabelecimento'}
                                    {deliveryPreview.event_title ? ` · ${deliveryPreview.event_title}` : ''}
                                </p>
                                <p className="text-gray-500">
                                    Status: {formatIntentStatus(deliveryPreview.status as CreditConsumptionIntentStatus)}
                                    {deliveryPreview.paid_at
                                        ? ` · pago ${new Date(deliveryPreview.paid_at).toLocaleString('pt-BR')}`
                                        : ''}
                                </p>
                                <p className="text-yellow-500 font-semibold">
                                    Total: {formatMoney(deliveryPreview.gross_amount)}
                                </p>
                            </div>
                            <div>
                                <p className="text-gray-300 font-medium mb-2">Produtos</p>
                                <ul className="space-y-2">
                                    {deliveryPreview.items.map((item) => (
                                        <li
                                            key={`${deliveryPreview.intent_id}-${item.product_id}`}
                                            className="flex gap-3 rounded-lg border border-yellow-500/20 p-2"
                                        >
                                            {item.image_url ? (
                                                <img
                                                    src={item.image_url}
                                                    alt={item.product_name}
                                                    className="h-14 w-14 rounded object-cover shrink-0"
                                                />
                                            ) : (
                                                <div className="h-14 w-14 rounded bg-yellow-500/10 border border-yellow-500/20 shrink-0 flex items-center justify-center text-yellow-500 text-xs">
                                                    Sem foto
                                                </div>
                                            )}
                                            <div className="min-w-0 flex-1">
                                                <p className="text-white font-medium">{item.product_name}</p>
                                                <p className="text-gray-500 text-xs mt-0.5">
                                                    {item.quantity}x · {formatMoney(Number(item.unit_price))} cada
                                                    {item.packaging_type === 'box' && item.units_per_box
                                                        ? ` · caixa (${item.units_per_box} un.)`
                                                        : ''}
                                                </p>
                                                {item.description ? (
                                                    <p className="text-gray-500 text-xs mt-1 line-clamp-2">
                                                        {item.description}
                                                    </p>
                                                ) : null}
                                                <p className="text-yellow-500 text-xs mt-1">
                                                    Linha: {formatMoney(Number(item.line_total))}
                                                </p>
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                            <p className="text-xs text-gray-500">
                                Crédito e estoque já foram baixados na compra do cliente. Ao confirmar, o sistema
                                registra a entrega e invalida o QR.
                            </p>
                            {deliveryPreview.block_reason && !deliveryPreview.can_confirm ? (
                                <p className="text-sm text-red-300">{deliveryPreview.block_reason}</p>
                            ) : null}
                        </div>
                    ) : null}
                    <AlertDialogFooter>
                        <AlertDialogCancel
                            disabled={deliveringToken}
                            className="bg-black/60 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 hover:text-yellow-400"
                        >
                            Voltar
                        </AlertDialogCancel>
                        <Button
                            type="button"
                            className="bg-yellow-500 text-black hover:bg-yellow-600 disabled:opacity-50"
                            disabled={
                                deliveringToken
                                || !deliveryPreview?.can_confirm
                                || (deliveryPreview?.items?.length ?? 0) === 0
                            }
                            onClick={() => void confirmDeliveryFromPreview()}
                        >
                            {deliveringToken ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                            Confirmar entrega
                        </Button>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            <AlertDialog
                open={Boolean(cancelDialogIntent)}
                onOpenChange={(open) => {
                    if (!open && !cancellingIntent) {
                        setCancelDialogIntent(null);
                        setCancelReason('');
                    }
                }}
            >
                <AlertDialogContent className="bg-black border border-yellow-500/40 text-white max-w-md">
                    <AlertDialogHeader>
                        <AlertDialogTitle className="text-yellow-500">Cancelar pedido</AlertDialogTitle>
                        <AlertDialogDescription className="text-gray-400">
                            {cancelDialogIntent?.paid
                                ? 'Pedido já pago: o crédito será estornado ao cliente e o estoque devolvido. Informe o motivo (obrigatório — fica na auditoria).'
                                : 'Informe o motivo do cancelamento (obrigatório — fica na auditoria).'}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    {cancelDialogIntent ? (
                        <p className="text-sm text-gray-300">{cancelDialogIntent.label}</p>
                    ) : null}
                    <div className="space-y-2">
                        <Label htmlFor="cancel-reason" className="text-gray-300">
                            Motivo
                        </Label>
                        <Textarea
                            id="cancel-reason"
                            value={cancelReason}
                            onChange={(e) => setCancelReason(e.target.value)}
                            placeholder="Ex.: cliente desistiu / produto indisponível / erro de digitação"
                            className="bg-black/60 border-yellow-500/30 text-white min-h-[90px]"
                            disabled={cancellingIntent}
                        />
                    </div>
                    <AlertDialogFooter>
                        <AlertDialogCancel
                            disabled={cancellingIntent}
                            className="bg-black/60 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 hover:text-yellow-400"
                        >
                            Voltar
                        </AlertDialogCancel>
                        <Button
                            type="button"
                            className="bg-yellow-500 text-black hover:bg-yellow-600 disabled:opacity-50"
                            disabled={cancellingIntent || !cancelReason.trim()}
                            onClick={() => void confirmCancelIntent()}
                        >
                            {cancellingIntent ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                            Confirmar cancelamento
                        </Button>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            <AlertDialog open={menuQrOpen} onOpenChange={setMenuQrOpen}>
                <AlertDialogContent className="bg-black border border-yellow-500/40 text-white max-w-sm">
                    <AlertDialogHeader>
                        <AlertDialogTitle className="text-yellow-500">QR do balcão</AlertDialogTitle>
                        <AlertDialogDescription className="text-gray-400">
                            Cliente escaneia e abre o cardápio no celular.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <div className="flex flex-col items-center gap-3 py-1">
                        {menuQrUrl ? (
                            <>
                                <div className="bg-white p-3 rounded-lg">
                                    <QRCode value={menuQrUrl} size={220} />
                                </div>
                                <p className="text-xs text-gray-500 text-center break-all">
                                    {menuQrUrl}
                                </p>
                            </>
                        ) : (
                            <Loader2 className="h-6 w-6 animate-spin text-yellow-500" />
                        )}
                    </div>
                    <AlertDialogFooter>
                        <AlertDialogCancel className="bg-transparent border-yellow-500/40 text-yellow-500 hover:bg-yellow-500/10">
                            Fechar
                        </AlertDialogCancel>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
};

export default ManagerCreditPdv;
