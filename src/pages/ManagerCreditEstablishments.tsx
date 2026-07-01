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
    type CreditEstablishmentProduct,
} from '@/hooks/use-credit-establishment-products';
import { isHybridPlan, isConsumptionOrLicensePlan } from '@/utils/company-billing-rules';
import { useCompanyBilling } from '@/hooks/use-company-billing';
import { showError, showSuccess } from '@/utils/toast';

type EventOption = { id: string; title: string };

const ManagerCreditEstablishments: React.FC = () => {
    const navigate = useNavigate();
    const [userId, setUserId] = useState<string | undefined>();
    const [events, setEvents] = useState<EventOption[]>([]);
    const [editing, setEditing] = useState<CreditEstablishment | null>(null);
    const [name, setName] = useState('');
    const [eventId, setEventId] = useState<string>('none');
    const [acceptanceEnabled, setAcceptanceEnabled] = useState(true);
    const [saving, setSaving] = useState(false);
    const [catalogEstablishmentId, setCatalogEstablishmentId] = useState<string>('none');
    const [editingProduct, setEditingProduct] = useState<CreditEstablishmentProduct | null>(null);
    const [productName, setProductName] = useState('');
    const [productPrice, setProductPrice] = useState('');
    const [productDescription, setProductDescription] = useState('');
    const [savingProduct, setSavingProduct] = useState(false);

    const { company } = useManagerCompany(userId);
    const { context: companyContext } = useManagerCompanyContext(userId);
    const { billing } = useCompanyBilling(company?.id);
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

    useEffect(() => {
        supabase.auth.getUser().then(({ data: { user } }) => setUserId(user?.id));
    }, []);

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
        setEventId('none');
        setAcceptanceEnabled(true);
    };

    const resetProductForm = () => {
        setEditingProduct(null);
        setProductName('');
        setProductPrice('');
        setProductDescription('');
    };

    const startEdit = (item: CreditEstablishment) => {
        setEditing(item);
        setName(item.name);
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
            await saveCreditEstablishment({
                companyId: company.id,
                name: name.trim(),
                eventId: eventId === 'none' ? null : eventId,
                establishmentId: editing?.id,
                creditAcceptanceEnabled: acceptanceEnabled,
                active: true,
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
        const parsedPrice = Number(productPrice.replace(',', '.'));
        if (!productName.trim()) {
            showError('Informe o nome do produto.');
            return;
        }
        if (!Number.isFinite(parsedPrice) || parsedPrice <= 0) {
            showError('Informe um preço unitário válido.');
            return;
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
        setProductPrice(String(item.unit_price));
        setProductDescription(item.description ?? '');
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

    if (!supportsCredit) {
        return (
            <div className="max-w-3xl mx-auto text-center py-16">
                <p className="text-gray-400 mb-4">
                    Seu plano comercial não inclui consumo por crédito EventFest.
                </p>
                <Button variant="outline" onClick={() => navigate('/manager/settings')}>
                    Voltar
                </Button>
            </div>
        );
    }

    return (
        <div className="max-w-4xl mx-auto">
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h1 className="text-2xl font-serif text-yellow-500 flex items-center gap-2">
                        <Store className="h-7 w-7" />
                        Estabelecimentos (crédito)
                    </h1>
                    <p className="text-gray-400 text-sm mt-1">
                        Bares, lojas e pontos de venda que aceitam crédito EventFest.
                    </p>
                </div>
                <Button variant="outline" className="border-yellow-500/40 text-yellow-500" onClick={() => navigate('/manager/credit/pdv')}>
                    Abrir PDV
                </Button>
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
                            <Button variant="outline" onClick={resetForm} className="border-yellow-500/40 text-yellow-500">
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
                                            {' · '}
                                            {item.active ? 'Ativo' : 'Inativo'}
                                        </p>
                                    </div>
                                    <div className="flex gap-2">
                                        {canManageEstablishments && (
                                            <>
                                                <Button size="sm" variant="outline" className="border-yellow-500/40 text-yellow-500" onClick={() => startEdit(item)}>
                                                    <Pencil className="h-4 w-4" />
                                                </Button>
                                                <Button size="sm" variant="outline" className="border-yellow-500/40 text-yellow-500" onClick={() => toggleActive(item)}>
                                                    <Power className="h-4 w-4" />
                                                </Button>
                                            </>
                                        )}
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            className="border-yellow-500/40 text-yellow-500"
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
                        Cadastre itens padrão por estabelecimento para agilizar o PDV.
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
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
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
                                        value={productPrice}
                                        onChange={(e) => setProductPrice(e.target.value)}
                                        placeholder="12,00"
                                        className="bg-black/60 border-yellow-500/30 text-white mt-1"
                                    />
                                </div>
                            </div>
                            <div>
                                <Label className="text-gray-300">Descrição (opcional)</Label>
                                <Input
                                    value={productDescription}
                                    onChange={(e) => setProductDescription(e.target.value)}
                                    placeholder="Observações do item"
                                    className="bg-black/60 border-yellow-500/30 text-white mt-1"
                                />
                            </div>
                            <div className="flex gap-2">
                                <Button
                                    onClick={handleSaveProduct}
                                    disabled={savingProduct}
                                    className="bg-yellow-500 text-black hover:bg-yellow-600"
                                >
                                    {savingProduct ? (
                                        <Loader2 className="h-4 w-4 animate-spin mr-1" />
                                    ) : (
                                        <Plus className="h-4 w-4 mr-1" />
                                    )}
                                    {editingProduct ? 'Salvar produto' : 'Adicionar produto'}
                                </Button>
                                {editingProduct && (
                                    <Button
                                        variant="outline"
                                        onClick={resetProductForm}
                                        className="border-yellow-500/40 text-yellow-500"
                                    >
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
                                                <div>
                                                    <p className="text-white font-medium">{item.name}</p>
                                                    <p className="text-xs text-gray-500">
                                                        {Number(item.unit_price).toLocaleString('pt-BR', {
                                                            style: 'currency',
                                                            currency: 'BRL',
                                                        })}{' '}
                                                        · {item.active ? 'Ativo' : 'Inativo'}
                                                    </p>
                                                </div>
                                                <div className="flex gap-2">
                                                    <Button
                                                        size="sm"
                                                        variant="outline"
                                                        className="border-yellow-500/40 text-yellow-500"
                                                        onClick={() => startEditProduct(item)}
                                                    >
                                                        <Pencil className="h-4 w-4" />
                                                    </Button>
                                                    <Button
                                                        size="sm"
                                                        variant="outline"
                                                        className="border-yellow-500/40 text-yellow-500"
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

            <Button variant="ghost" className="mt-6 text-gray-400" onClick={() => navigate('/manager/settings')}>
                <ArrowLeft className="h-4 w-4 mr-1" /> Voltar
            </Button>
        </div>
    );
};

export default ManagerCreditEstablishments;
