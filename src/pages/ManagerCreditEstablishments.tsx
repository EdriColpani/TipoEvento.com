import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader2, Plus, Store, Pencil, Power, Package } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { usePageAuth } from '@/hooks/use-page-auth';
import { useManagerCompany } from '@/hooks/use-manager-company';
import { useManagerCompanyContext } from '@/hooks/use-manager-company-context';
import {
    useCreditEstablishments,
    saveCreditEstablishment,
    setCreditEstablishmentActive,
    type CreditEstablishment,
} from '@/hooks/use-credit-establishments';
import {
    useCreditEstablishmentProducts,
    saveCreditEstablishmentProduct,
    setCreditEstablishmentProductActive,
    applyCreditProductAppDiscount,
    type CreditEstablishmentProduct,
    type CreditProductPackagingType,
} from '@/hooks/use-credit-establishment-products';
import { isHybridPlan, isConsumptionOrLicensePlan } from '@/utils/company-billing-rules';
import { useCompanyBilling } from '@/hooks/use-company-billing';
import { showError, showSuccess } from '@/utils/toast';
import { resolveEventGeoOnSave } from '@/utils/google-maps';
import ImageUploadPicker from '@/components/ImageUploadPicker';
import {
    formatCurrencyBrInput,
    parseCurrencyBr,
    sanitizeCurrencyBrInput,
} from '@/utils/currency-input';

type EventOption = { id: string; title: string };

const OUTLINE_BTN =
    'bg-black/60 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 hover:text-yellow-400';

function formatProductUnitPriceDisplay(value: number): string {
    return `R$ ${formatCurrencyBrInput(value)}`;
}

function parseProductUnitPriceInput(raw: string): number {
    return parseCurrencyBr(raw.replace(/^R\$\s*/i, '').trim());
}

function sanitizeProductUnitPriceInput(raw: string): string {
    const digits = sanitizeCurrencyBrInput(raw.replace(/^R\$\s*/i, '').trim());
    return digits ? `R$ ${digits}` : '';
}

function parseDiscountPctInput(raw: string): number | null {
    const trimmed = raw.trim();
    if (!trimmed) return 0;
    const n = Number.parseFloat(trimmed.replace(',', '.').replace(/[^\d.]/g, ''));
    if (!Number.isFinite(n) || n < 0 || n > 100) return null;
    return Math.round(n * 100) / 100;
}

const ManagerCreditEstablishments: React.FC = () => {
    const navigate = useNavigate();
    const { userId, authPending, sessionReady } = usePageAuth();
    const [events, setEvents] = useState<EventOption[]>([]);
    const [editing, setEditing] = useState<CreditEstablishment | null>(null);
    const [name, setName] = useState('');
    const [address, setAddress] = useState('');
    const [eventId, setEventId] = useState<string>('none');
    const [acceptanceEnabled, setAcceptanceEnabled] = useState(true);
    const [saving, setSaving] = useState(false);
    const [catalogEstablishmentId, setCatalogEstablishmentId] = useState<string>('none');
    const [editingProduct, setEditingProduct] = useState<CreditEstablishmentProduct | null>(null);
    const [productName, setProductName] = useState('');
    const [productPrice, setProductPrice] = useState('');
    const [productDescription, setProductDescription] = useState('');
    const [productImageUrl, setProductImageUrl] = useState<string | null>(null);
    const [productPackagingType, setProductPackagingType] =
        useState<CreditProductPackagingType>('unit');
    const [productUnitsPerBox, setProductUnitsPerBox] = useState('');
    const [productQuantity, setProductQuantity] = useState('');
    const [productDiscountPct, setProductDiscountPct] = useState('');
    const [bulkDiscountPct, setBulkDiscountPct] = useState('');
    const [savingProduct, setSavingProduct] = useState(false);
    const [applyingBulkDiscount, setApplyingBulkDiscount] = useState(false);

    const { company } = useManagerCompany(userId);
    const { context: companyContext } = useManagerCompanyContext(userId);
    const { billing, isLoading: loadingBilling } = useCompanyBilling(company?.id);
    const { data, isLoading, invalidate } = useCreditEstablishments(company?.id);
    const {
        data: productsData,
        isLoading: loadingProducts,
        invalidate: invalidateProducts,
    } = useCreditEstablishmentProducts(
        company?.id,
        catalogEstablishmentId !== 'none' ? catalogEstablishmentId : undefined,
    );

    const supportsCredit =
        isHybridPlan(billing?.billing_plan) || isConsumptionOrLicensePlan(billing?.billing_plan);
    const canManageEstablishments = !companyContext?.isPdvOperator && (companyContext?.isCompanyOwner ?? true);

    const planStillLoading =
        authPending ||
        !sessionReady ||
        (Boolean(company?.id) && loadingBilling && billing === undefined);

    useEffect(() => {
        if (!company?.id) return;
        supabase
            .from('events')
            .select('id, title')
            .eq('company_id', company.id)
            .order('date', { ascending: false })
            .then(({ data: rows }) => setEvents((rows ?? []) as EventOption[]));
    }, [company?.id]);

    const resetForm = () => {
        setEditing(null);
        setName('');
        setAddress('');
        setEventId('none');
        setAcceptanceEnabled(true);
    };

    const resetProductForm = () => {
        setEditingProduct(null);
        setProductName('');
        setProductPrice('');
        setProductDescription('');
        setProductImageUrl(null);
        setProductPackagingType('unit');
        setProductUnitsPerBox('');
        setProductQuantity('');
        setProductDiscountPct('');
    };

    const productTotalUnits = (() => {
        const qty = Number(productQuantity);
        if (!Number.isFinite(qty) || qty < 0) return 0;
        if (productPackagingType === 'box') {
            const perBox = Number(productUnitsPerBox);
            if (!Number.isFinite(perBox) || perBox <= 0) return 0;
            return perBox * qty;
        }
        return qty;
    })();

    const startEdit = (item: CreditEstablishment) => {
        setEditing(item);
        setName(item.name);
        setAddress(item.address ?? '');
        setEventId(item.event_id ?? 'none');
        setAcceptanceEnabled(item.credit_acceptance_enabled);
    };

    const handleSave = async () => {
        if (!company?.id) return;
        if (!name.trim()) {
            showError('Informe o nome do estabelecimento.');
            return;
        }
        setSaving(true);
        try {
            let addressLat = editing?.address_lat ?? null;
            let addressLng = editing?.address_lng ?? null;
            let addressToSave = address.trim() || null;

            if (addressToSave) {
                try {
                    const geo = await resolveEventGeoOnSave({
                        address: addressToSave,
                        location: name.trim(),
                        address_lat: addressLat,
                        address_lng: addressLng,
                    });
                    addressToSave = geo.address || addressToSave;
                    addressLat = geo.address_lat ?? addressLat;
                    addressLng = geo.address_lng ?? addressLng;
                } catch {
                    /* geocode opcional — não bloqueia o save */
                }
            }

            await saveCreditEstablishment({
                companyId: company.id,
                name: name.trim(),
                eventId: eventId === 'none' ? null : eventId,
                establishmentId: editing?.id,
                creditAcceptanceEnabled: acceptanceEnabled,
                active: true,
                address: addressToSave,
                addressLat,
                addressLng,
            });
            showSuccess(editing ? 'Estabelecimento atualizado.' : 'Estabelecimento criado.');
            resetForm();
            invalidate();
        } catch (e: unknown) {
            showError(e instanceof Error ? e.message : 'Erro ao salvar.');
        } finally {
            setSaving(false);
        }
    };

    const toggleActive = async (item: CreditEstablishment) => {
        if (!company?.id) return;
        try {
            await setCreditEstablishmentActive(item.id, company.id, !item.active);
            showSuccess(item.active ? 'Estabelecimento desativado.' : 'Estabelecimento reativado.');
            invalidate();
        } catch (e: unknown) {
            showError(e instanceof Error ? e.message : 'Erro ao alterar status.');
        }
    };

    const handleSaveProduct = async () => {
        if (!company?.id || catalogEstablishmentId === 'none') {
            showError('Selecione um estabelecimento para o catálogo.');
            return;
        }
        const parsedPrice = parseProductUnitPriceInput(productPrice);
        const parsedQty = Number(productQuantity);
        const parsedUnitsPerBox = Number(productUnitsPerBox);
        const parsedDiscount = parseDiscountPctInput(productDiscountPct);
        if (!productName.trim()) {
            showError('Informe o nome do produto.');
            return;
        }
        if (!Number.isFinite(parsedPrice) || parsedPrice <= 0) {
            showError('Informe um preço unitário válido.');
            return;
        }
        if (parsedDiscount === null) {
            showError('Informe um desconto entre 0 e 100%.');
            return;
        }
        if (!Number.isFinite(parsedQty) || parsedQty < 0 || !Number.isInteger(parsedQty)) {
            showError(
                productPackagingType === 'box'
                    ? 'Informe a quantidade de caixas (número inteiro).'
                    : 'Informe a quantidade em unidades (número inteiro).',
            );
            return;
        }
        if (productPackagingType === 'box') {
            if (!Number.isFinite(parsedUnitsPerBox) || parsedUnitsPerBox <= 0 || !Number.isInteger(parsedUnitsPerBox)) {
                showError('Informe quantas unidades vão em cada caixa.');
                return;
            }
        }
        setSavingProduct(true);
        try {
            await saveCreditEstablishmentProduct({
                companyId: company.id,
                establishmentId: catalogEstablishmentId,
                name: productName.trim(),
                unitPrice: parsedPrice,
                description: productDescription.trim() || null,
                productId: editingProduct?.id,
                active: true,
                imageUrl: productImageUrl,
                packagingType: productPackagingType,
                unitsPerBox: productPackagingType === 'box' ? parsedUnitsPerBox : null,
                quantity: parsedQty,
                appDiscountPct: parsedDiscount,
            });
            showSuccess(editingProduct ? 'Produto atualizado.' : 'Produto criado.');
            resetProductForm();
            invalidateProducts();
        } catch (e: unknown) {
            showError(e instanceof Error ? e.message : 'Erro ao salvar produto.');
        } finally {
            setSavingProduct(false);
        }
    };

    const startEditProduct = (item: CreditEstablishmentProduct) => {
        setEditingProduct(item);
        setProductName(item.name);
        setProductPrice(formatProductUnitPriceDisplay(Number(item.unit_price)));
        setProductDescription(item.description ?? '');
        setProductImageUrl(item.image_url ?? null);
        setProductPackagingType(item.packaging_type === 'box' ? 'box' : 'unit');
        setProductUnitsPerBox(item.units_per_box != null ? String(item.units_per_box) : '');
        setProductQuantity(String(item.quantity ?? 0));
        setProductDiscountPct(
            Number(item.app_discount_pct ?? 0) > 0
                ? String(item.app_discount_pct).replace('.', ',')
                : '',
        );
    };

    const selectedCatalogEstablishment = (data?.items ?? []).find(
        (item) => item.id === catalogEstablishmentId,
    );

    const handleBulkDiscount = async (scope: 'establishment' | 'event') => {
        if (!company?.id || catalogEstablishmentId === 'none') {
            showError('Selecione um estabelecimento.');
            return;
        }
        const parsedDiscount = parseDiscountPctInput(bulkDiscountPct);
        if (parsedDiscount === null) {
            showError('Informe um desconto entre 0 e 100%.');
            return;
        }
        if (scope === 'event' && !selectedCatalogEstablishment?.event_id) {
            showError('Vincule o estabelecimento a um evento para aplicar em todos os produtos do evento.');
            return;
        }
        setApplyingBulkDiscount(true);
        try {
            const result = await applyCreditProductAppDiscount({
                companyId: company.id,
                establishmentId: catalogEstablishmentId,
                appDiscountPct: parsedDiscount,
                scope,
            });
            showSuccess(
                scope === 'event'
                    ? `Desconto de ${parsedDiscount.toLocaleString('pt-BR')}% aplicado em ${result.updated_count} produto(s) do evento.`
                    : `Desconto de ${parsedDiscount.toLocaleString('pt-BR')}% aplicado em ${result.updated_count} produto(s) deste estabelecimento.`,
            );
            invalidateProducts();
        } catch (e: unknown) {
            showError(e instanceof Error ? e.message : 'Erro ao aplicar desconto.');
        } finally {
            setApplyingBulkDiscount(false);
        }
    };

    const toggleProductActive = async (item: CreditEstablishmentProduct) => {
        if (!company?.id || catalogEstablishmentId === 'none') return;
        try {
            await setCreditEstablishmentProductActive({
                companyId: company.id,
                establishmentId: catalogEstablishmentId,
                productId: item.id,
                active: !item.active,
            });
            showSuccess(item.active ? 'Produto desativado.' : 'Produto reativado.');
            invalidateProducts();
        } catch (e: unknown) {
            showError(e instanceof Error ? e.message : 'Erro ao alterar status do produto.');
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
            <div className="max-w-3xl mx-auto text-center py-16">
                <p className="text-gray-400 mb-4">
                    Seu plano comercial não inclui consumo por crédito EventFest.
                </p>
                <Button
                    variant="outline"
                    className="bg-black/60 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 hover:text-yellow-400"
                    onClick={() => navigate('/manager/settings')}
                >
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Voltar
                </Button>
            </div>
        );
    }

    return (
        <div className="max-w-4xl mx-auto">
            <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
                <div>
                    <h1 className="text-2xl font-serif text-yellow-500 flex items-center gap-2">
                        <Store className="h-7 w-7" />
                        Estabelecimentos (crédito)
                    </h1>
                    <p className="text-gray-400 text-sm mt-1">
                        Bares, lojas e pontos de venda que aceitam crédito EventFest.
                    </p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                    <Button
                        variant="outline"
                        className="bg-black/60 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 hover:text-yellow-400"
                        onClick={() => navigate('/manager/credit/pdv')}
                    >
                        Abrir PDV
                    </Button>
                    <Button
                        variant="outline"
                        className="bg-black/60 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 hover:text-yellow-400"
                        onClick={() => navigate('/manager/reports/credit-product-inventory')}
                    >
                        Estoque e vendas
                    </Button>
                    <Button
                        variant="outline"
                        className="bg-black/60 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 hover:text-yellow-400"
                        onClick={() => navigate('/manager/settings')}
                    >
                        <ArrowLeft className="mr-2 h-4 w-4" />
                        Voltar
                    </Button>
                </div>
            </div>

            <Card className="bg-black border-yellow-500/30 mb-6">
                <CardHeader>
                    <CardTitle className="text-white text-lg">
                        {canManageEstablishments
                            ? editing
                                ? 'Editar estabelecimento'
                                : 'Novo estabelecimento'
                            : 'Estabelecimentos disponíveis'}
                    </CardTitle>
                    {!canManageEstablishments && (
                        <CardDescription className="text-gray-400">
                            Como operador PDV, você gerencia produtos nos estabelecimentos já cadastrados pelo proprietário.
                        </CardDescription>
                    )}
                </CardHeader>
                {canManageEstablishments ? (
                <CardContent className="space-y-4">
                    <div>
                        <Label className="text-gray-300">Nome</Label>
                        <Input
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="Ex.: Bar principal"
                            className="bg-black/60 border-yellow-500/30 text-white mt-1"
                        />
                    </div>
                    <div>
                        <Label className="text-gray-300">Endereço (para rota no mapa)</Label>
                        <Input
                            value={address}
                            onChange={(e) => setAddress(e.target.value)}
                            placeholder="Ex.: Rua Exemplo, 100 — Centro, Cidade/UF"
                            className="bg-black/60 border-yellow-500/30 text-white mt-1"
                        />
                    </div>
                    <div>
                        <Label className="text-gray-300">Evento (opcional)</Label>
                        <Select value={eventId} onValueChange={setEventId}>
                            <SelectTrigger className="bg-black/60 border-yellow-500/30 text-white mt-1">
                                <SelectValue placeholder="Sem vínculo de evento" />
                            </SelectTrigger>
                            <SelectContent className="bg-black border-yellow-500/30 text-white">
                                <SelectItem value="none">Sem evento específico</SelectItem>
                                {events.map((ev) => (
                                    <SelectItem key={ev.id} value={ev.id}>{ev.title}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="flex items-center gap-2">
                        <Checkbox
                            checked={acceptanceEnabled}
                            onCheckedChange={(v) => setAcceptanceEnabled(v === true)}
                            className="border-yellow-500 data-[state=checked]:bg-yellow-500"
                        />
                        <Label className="text-gray-300">Aceita pagamento com crédito EventFest</Label>
                    </div>
                    <div className="flex gap-2">
                        <Button onClick={handleSave} disabled={saving} className="bg-yellow-500 text-black hover:bg-yellow-600">
                            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Plus className="h-4 w-4 mr-1" />}
                            {editing ? 'Salvar alterações' : 'Cadastrar'}
                        </Button>
                        {editing && (
                            <Button variant="outline" onClick={resetForm} className={OUTLINE_BTN}>
                                Cancelar
                            </Button>
                        )}
                    </div>
                </CardContent>
                ) : null}
            </Card>

            <Card className="bg-black border-yellow-500/30">
                <CardHeader>
                    <CardTitle className="text-white">Cadastrados</CardTitle>
                    <CardDescription className="text-gray-400">
                        {data?.module_enabled === false
                            ? 'Módulo de créditos desligado globalmente.'
                            : `${data?.items?.length ?? 0} ponto(s)`}
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    {isLoading ? (
                        <Loader2 className="h-8 w-8 animate-spin text-yellow-500 mx-auto" />
                    ) : (data?.items?.length ?? 0) === 0 ? (
                        <p className="text-gray-500 text-sm text-center py-6">Nenhum estabelecimento cadastrado.</p>
                    ) : (
                        <ul className="space-y-3">
                            {data!.items.map((item) => (
                                <li
                                    key={item.id}
                                    className="flex flex-wrap items-center justify-between gap-3 border border-yellow-500/20 rounded-xl p-4"
                                >
                                    <div>
                                        <p className="text-white font-medium">{item.name}</p>
                                        <p className="text-xs text-gray-500">
                                            {item.event_title ? `Evento: ${item.event_title}` : 'Sem evento'}
                                            {item.address ? ` · ${item.address}` : ''}
                                            {' · '}
                                            {item.active ? 'Ativo' : 'Inativo'}
                                        </p>
                                    </div>
                                    <div className="flex gap-2">
                                        {canManageEstablishments && (
                                            <>
                                                <Button
                                                    size="sm"
                                                    variant="outline"
                                                    className={OUTLINE_BTN}
                                                    onClick={() => startEdit(item)}
                                                >
                                                    <Pencil className="h-4 w-4" />
                                                </Button>
                                                <Button
                                                    size="sm"
                                                    variant="outline"
                                                    className={OUTLINE_BTN}
                                                    onClick={() => toggleActive(item)}
                                                >
                                                    <Power className="h-4 w-4" />
                                                </Button>
                                            </>
                                        )}
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            className={OUTLINE_BTN}
                                            onClick={() => setCatalogEstablishmentId(item.id)}
                                        >
                                            Produtos
                                        </Button>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    )}
                </CardContent>
            </Card>

            <Card className="bg-black border-yellow-500/30 mt-6">
                <CardHeader>
                    <CardTitle className="text-white flex items-center gap-2">
                        <Package className="h-5 w-5 text-yellow-500" />
                        Catálogo de produtos
                    </CardTitle>
                    <CardDescription className="text-gray-400">
                        Cadastre itens padrão por estabelecimento. Desconto % vale no app/cardápio; o PDV cobra o preço cheio.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div>
                        <Label className="text-gray-300">Estabelecimento</Label>
                        <Select value={catalogEstablishmentId} onValueChange={setCatalogEstablishmentId}>
                            <SelectTrigger className="bg-black/60 border-yellow-500/30 text-white mt-1">
                                <SelectValue placeholder="Selecione um estabelecimento" />
                            </SelectTrigger>
                            <SelectContent className="bg-black border-yellow-500/30 text-white">
                                <SelectItem value="none">Selecione...</SelectItem>
                                {(data?.items ?? []).map((item) => (
                                    <SelectItem key={item.id} value={item.id}>
                                        {item.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    {catalogEstablishmentId !== 'none' && (
                        <>
                            <div className="rounded-xl border border-yellow-500/20 p-3 space-y-2">
                                <Label className="text-gray-300">Desconto no app (lote)</Label>
                                <p className="text-xs text-gray-500">
                                    Vale só no cardápio/app do cliente. O PDV continua no preço cheio.
                                </p>
                                <div className="grid grid-cols-1 sm:grid-cols-[140px_1fr] gap-2 items-end">
                                    <div>
                                        <Label className="text-gray-400 text-xs">% desconto</Label>
                                        <Input
                                            type="text"
                                            inputMode="decimal"
                                            value={bulkDiscountPct}
                                            onChange={(e) =>
                                                setBulkDiscountPct(e.target.value.replace(/[^\d,.]/g, ''))
                                            }
                                            placeholder="Ex.: 10"
                                            className="bg-black/60 border-yellow-500/30 text-white mt-1"
                                        />
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                        <Button
                                            type="button"
                                            variant="outline"
                                            className={OUTLINE_BTN}
                                            disabled={applyingBulkDiscount}
                                            onClick={() => void handleBulkDiscount('establishment')}
                                        >
                                            {applyingBulkDiscount ? (
                                                <Loader2 className="h-4 w-4 animate-spin mr-1" />
                                            ) : null}
                                            Aplicar neste estabelecimento
                                        </Button>
                                        <Button
                                            type="button"
                                            variant="outline"
                                            className={OUTLINE_BTN}
                                            disabled={
                                                applyingBulkDiscount || !selectedCatalogEstablishment?.event_id
                                            }
                                            onClick={() => void handleBulkDiscount('event')}
                                        >
                                            Aplicar em todos do evento
                                        </Button>
                                    </div>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                                <div className="sm:col-span-2">
                                    <Label className="text-gray-300">Nome do produto</Label>
                                    <Input
                                        value={productName}
                                        onChange={(e) => setProductName(e.target.value)}
                                        placeholder="Ex.: Cerveja lata"
                                        className="bg-black/60 border-yellow-500/30 text-white mt-1"
                                    />
                                </div>
                                <div>
                                    <Label className="text-gray-300">Preço unitário</Label>
                                    <Input
                                        type="text"
                                        inputMode="decimal"
                                        value={productPrice}
                                        onChange={(e) => setProductPrice(sanitizeProductUnitPriceInput(e.target.value))}
                                        onBlur={() => {
                                            const parsed = parseProductUnitPriceInput(productPrice);
                                            if (!Number.isNaN(parsed) && parsed > 0) {
                                                setProductPrice(formatProductUnitPriceDisplay(parsed));
                                            }
                                        }}
                                        placeholder="R$ 0,00"
                                        className="bg-black/60 border-yellow-500/30 text-white mt-1"
                                    />
                                </div>
                                <div>
                                    <Label className="text-gray-300">% desconto no app</Label>
                                    <Input
                                        type="text"
                                        inputMode="decimal"
                                        value={productDiscountPct}
                                        onChange={(e) =>
                                            setProductDiscountPct(e.target.value.replace(/[^\d,.]/g, ''))
                                        }
                                        placeholder="0"
                                        className="bg-black/60 border-yellow-500/30 text-white mt-1"
                                    />
                                    <p className="text-xs text-gray-500 mt-1">0 = sem desconto. Só no app.</p>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-[160px_1fr] gap-4 items-start">
                                <div>
                                    <Label className="text-gray-300">Foto (opcional)</Label>
                                    {userId ? (
                                        <div className="mt-2">
                                            <ImageUploadPicker
                                                userId={userId}
                                                currentImageUrl={productImageUrl}
                                                onImageUpload={(url) => setProductImageUrl(url)}
                                                width={160}
                                                height={160}
                                                placeholderText="Foto"
                                                bucketName="credit-product-images"
                                                folderPath={company?.id ? `${company.id}/products` : 'products'}
                                                maxFileSizeMB={5}
                                                uploadButtonLabel="Enviar foto"
                                                disabled={savingProduct}
                                                compact
                                                objectFit="contain"
                                            />
                                        </div>
                                    ) : (
                                        <p className="text-xs text-gray-500 mt-1">Faça login para enviar foto.</p>
                                    )}
                                </div>

                                <div className="space-y-3 min-w-0">
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                        <div>
                                            <Label className="text-gray-300">Embalagem</Label>
                                            <Select
                                                value={productPackagingType}
                                                onValueChange={(v) => {
                                                    const next = v === 'box' ? 'box' : 'unit';
                                                    setProductPackagingType(next);
                                                    if (next === 'unit') setProductUnitsPerBox('');
                                                }}
                                            >
                                                <SelectTrigger className="bg-black/60 border-yellow-500/30 text-white mt-1">
                                                    <SelectValue placeholder="Selecione" />
                                                </SelectTrigger>
                                                <SelectContent className="bg-black border-yellow-500/30 text-white">
                                                    <SelectItem value="unit">Unidade</SelectItem>
                                                    <SelectItem value="box">Caixa</SelectItem>
                                                </SelectContent>
                                            </Select>
                                        </div>
                                        {productPackagingType === 'box' ? (
                                            <div>
                                                <Label className="text-gray-300">Unidades por caixa</Label>
                                                <Input
                                                    type="number"
                                                    min={1}
                                                    step={1}
                                                    value={productUnitsPerBox}
                                                    onChange={(e) => setProductUnitsPerBox(e.target.value)}
                                                    placeholder="Ex.: 12"
                                                    className="bg-black/60 border-yellow-500/30 text-white mt-1"
                                                />
                                            </div>
                                        ) : (
                                            <div>
                                                <Label className="text-gray-300">Quantidade (unidades)</Label>
                                                <Input
                                                    type="number"
                                                    min={0}
                                                    step={1}
                                                    value={productQuantity}
                                                    onChange={(e) => setProductQuantity(e.target.value)}
                                                    placeholder="Ex.: 50"
                                                    className="bg-black/60 border-yellow-500/30 text-white mt-1"
                                                />
                                            </div>
                                        )}
                                    </div>

                                    {productPackagingType === 'box' && (
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                            <div>
                                                <Label className="text-gray-300">Quantidade de caixas</Label>
                                                <Input
                                                    type="number"
                                                    min={0}
                                                    step={1}
                                                    value={productQuantity}
                                                    onChange={(e) => setProductQuantity(e.target.value)}
                                                    placeholder="Ex.: 10"
                                                    className="bg-black/60 border-yellow-500/30 text-white mt-1"
                                                />
                                            </div>
                                            <div>
                                                <Label className="text-gray-300">Total (unidades)</Label>
                                                <Input
                                                    value={String(productTotalUnits)}
                                                    readOnly
                                                    className="bg-black/40 border-yellow-500/20 text-yellow-500 mt-1"
                                                />
                                                <p className="text-xs text-gray-500 mt-1">
                                                    Unidades por caixa × caixas.
                                                </p>
                                            </div>
                                        </div>
                                    )}

                                    <div>
                                        <Label className="text-gray-300">Descrição (opcional)</Label>
                                        <Input
                                            value={productDescription}
                                            onChange={(e) => setProductDescription(e.target.value)}
                                            placeholder="Observações do item"
                                            className="bg-black/60 border-yellow-500/30 text-white mt-1"
                                        />
                                    </div>
                                </div>
                            </div>

                            <div className="flex gap-2">
                                <Button
                                    onClick={handleSaveProduct}
                                    disabled={savingProduct}
                                    className="bg-yellow-500 text-black hover:bg-yellow-600 disabled:opacity-50"
                                >
                                    {savingProduct ? (
                                        <Loader2 className="h-4 w-4 animate-spin mr-1" />
                                    ) : (
                                        <Plus className="h-4 w-4 mr-1" />
                                    )}
                                    {editingProduct ? 'Salvar produto' : 'Adicionar produto'}
                                </Button>
                                {editingProduct && (
                                    <Button variant="outline" onClick={resetProductForm} className={OUTLINE_BTN}>
                                        Cancelar
                                    </Button>
                                )}
                            </div>

                            <div className="border-t border-yellow-500/20 pt-3">
                                {loadingProducts ? (
                                    <Loader2 className="h-5 w-5 animate-spin text-yellow-500" />
                                ) : (productsData?.items?.length ?? 0) === 0 ? (
                                    <p className="text-sm text-gray-500">Nenhum produto cadastrado para este estabelecimento.</p>
                                ) : (
                                    <ul className="space-y-2">
                                        {productsData!.items.map((item) => (
                                            <li
                                                key={item.id}
                                                className="flex flex-wrap items-center justify-between gap-3 border border-yellow-500/20 rounded-xl p-3"
                                            >
                                                <div className="flex items-center gap-3 min-w-0">
                                                    {item.image_url ? (
                                                        <img
                                                            src={item.image_url}
                                                            alt={item.name}
                                                            className="h-12 w-12 rounded-lg object-cover border border-yellow-500/20 shrink-0"
                                                        />
                                                    ) : (
                                                        <div className="h-12 w-12 rounded-lg bg-black/60 border border-yellow-500/20 flex items-center justify-center shrink-0">
                                                            <Package className="h-5 w-5 text-gray-600" />
                                                        </div>
                                                    )}
                                                    <div className="min-w-0">
                                                        <p className="text-white font-medium truncate">{item.name}</p>
                                                        <p className="text-xs text-gray-500">
                                                            {Number(item.unit_price).toLocaleString('pt-BR', {
                                                                style: 'currency',
                                                                currency: 'BRL',
                                                            })}
                                                            {Number(item.app_discount_pct ?? 0) > 0
                                                                ? ` · app ${Number(item.app_discount_pct).toLocaleString('pt-BR')}% off (${Number(item.app_unit_price ?? item.unit_price).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })})`
                                                                : ''}{' '}
                                                            ·{' '}
                                                            {item.packaging_type === 'box'
                                                                ? `Caixa (${item.units_per_box} und) · ${item.quantity} cx · total ${item.total_units ?? item.quantity * (item.units_per_box ?? 0)} und`
                                                                : `Unidade · ${item.quantity} und`}{' '}
                                                            · {item.active ? 'Ativo' : 'Inativo'}
                                                        </p>
                                                    </div>
                                                </div>
                                                <div className="flex gap-2">
                                                    <Button
                                                        size="sm"
                                                        variant="outline"
                                                        className={OUTLINE_BTN}
                                                        onClick={() => startEditProduct(item)}
                                                    >
                                                        <Pencil className="h-4 w-4" />
                                                    </Button>
                                                    <Button
                                                        size="sm"
                                                        variant="outline"
                                                        className={OUTLINE_BTN}
                                                        onClick={() => toggleProductActive(item)}
                                                    >
                                                        <Power className="h-4 w-4" />
                                                    </Button>
                                                </div>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                        </>
                    )}
                </CardContent>
            </Card>

            <Button
                type="button"
                variant="outline"
                className="mt-6 bg-black/60 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 hover:text-yellow-400"
                onClick={() => navigate('/manager/settings')}
            >
                <ArrowLeft className="h-4 w-4 mr-1" /> Voltar
            </Button>
        </div>
    );
};

export default ManagerCreditEstablishments;
