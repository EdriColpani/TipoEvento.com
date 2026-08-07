import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Boxes, Loader2, Package } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { usePageAuth } from '@/hooks/use-page-auth';
import { useCreditReportsAccess } from '@/hooks/use-credit-reports-access';
import { useCreditEstablishments } from '@/hooks/use-credit-establishments';
import { useManagerCreditProductInventoryReport } from '@/hooks/use-manager-credit-product-inventory';

function money(v: number | null | undefined): string {
    return Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function qty(v: number | null | undefined): string {
    return Number(v ?? 0).toLocaleString('pt-BR');
}

const ManagerCreditProductInventoryReport: React.FC = () => {
    const navigate = useNavigate();
    const { userId } = usePageAuth();
    const access = useCreditReportsAccess(userId);
    const companyId = access.company?.id;
    const { data: establishmentsData } = useCreditEstablishments(companyId);
    const [establishmentFilter, setEstablishmentFilter] = useState<string>('all');

    const establishmentId = establishmentFilter === 'all' ? null : establishmentFilter;
    const { data, isLoading, isError, refetch, isFetching } = useManagerCreditProductInventoryReport(
        companyId,
        establishmentId,
    );

    const establishments = useMemo(
        () => (establishmentsData?.items ?? []).filter((e) => e.active !== false),
        [establishmentsData?.items],
    );

    const items = data?.items ?? [];
    const totals = data?.totals;

    if (access.isLoading) {
        return (
            <div className="max-w-5xl mx-auto text-center py-16 text-gray-400">
                <Loader2 className="h-8 w-8 animate-spin text-yellow-500 mx-auto mb-3" />
                Carregando...
            </div>
        );
    }

    if (!access.canAccessManagerCreditReports) {
        return (
            <div className="max-w-4xl mx-auto text-center py-16 text-gray-400">
                Relatório disponível para empresas com módulo de crédito/consumo.
                <Button
                    type="button"
                    variant="outline"
                    className="mt-4 block mx-auto bg-black/60 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10"
                    onClick={() => navigate('/manager/reports')}
                >
                    Voltar
                </Button>
            </div>
        );
    }

    return (
        <div className="max-w-5xl mx-auto">
            <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
                <div className="flex items-center gap-4">
                    <Button
                        type="button"
                        variant="outline"
                        className="bg-black/60 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 hover:text-yellow-400"
                        onClick={() => navigate('/manager/reports')}
                    >
                        <ArrowLeft className="h-4 w-4 mr-1" /> Relatórios
                    </Button>
                    <h1 className="text-2xl font-serif text-yellow-500 flex items-center gap-2">
                        <Boxes className="h-6 w-6" />
                        Estoque e vendas de produtos
                    </h1>
                </div>
                <Button
                    type="button"
                    variant="outline"
                    className="bg-black/60 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 disabled:opacity-50"
                    onClick={() => void refetch()}
                    disabled={isFetching}
                >
                    {isFetching ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                    Atualizar
                </Button>
            </div>

            <p className="text-gray-400 text-sm mb-6 max-w-3xl">
                Compara o estoque atual do catálogo com a quantidade já vendida via crédito EventFest
                (PDV e cardápio do cliente).
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
                <StatCard label="Produtos" value={qty(totals?.products)} />
                <StatCard label="Em estoque (unid.)" value={qty(totals?.stock_quantity)} />
                <StatCard label="Vendidos (unid.)" value={qty(totals?.sold_quantity)} />
            </div>

            <Card className="bg-black border-yellow-500/30 mb-4">
                <CardHeader className="pb-3">
                    <CardTitle className="text-white text-lg">Filtro</CardTitle>
                    <CardDescription className="text-gray-400">
                        Opcional: ver um estabelecimento específico.
                    </CardDescription>
                </CardHeader>
                <CardContent className="max-w-sm">
                    <Select value={establishmentFilter} onValueChange={setEstablishmentFilter}>
                        <SelectTrigger className="bg-black/60 border-yellow-500/30 text-white">
                            <SelectValue placeholder="Estabelecimento" />
                        </SelectTrigger>
                        <SelectContent className="bg-black border-yellow-500/30 text-white">
                            <SelectItem value="all">Todos os estabelecimentos</SelectItem>
                            {establishments.map((est) => (
                                <SelectItem key={est.id} value={est.id}>
                                    {est.name}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </CardContent>
            </Card>

            <Card className="bg-black border-yellow-500/30">
                <CardHeader>
                    <CardTitle className="text-white text-lg flex items-center gap-2">
                        <Package className="h-5 w-5 text-yellow-500" />
                        Produtos
                    </CardTitle>
                    <CardDescription className="text-gray-400">
                        Colunas separadas: estoque atual × quantidade vendida e receita.
                    </CardDescription>
                </CardHeader>
                <CardContent className="overflow-x-auto">
                    {isLoading ? (
                        <Loader2 className="h-8 w-8 animate-spin text-yellow-500 mx-auto py-8" />
                    ) : isError ? (
                        <p className="text-red-400 text-sm text-center py-8">
                            Erro ao carregar o relatório.
                        </p>
                    ) : items.length === 0 ? (
                        <p className="text-gray-500 text-sm text-center py-8">
                            Nenhum produto cadastrado no catálogo de crédito.
                        </p>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow className="border-yellow-500/20">
                                    <TableHead className="text-yellow-500">Produto</TableHead>
                                    <TableHead className="text-yellow-500">Estabelecimento</TableHead>
                                    <TableHead className="text-yellow-500 text-right">Em estoque</TableHead>
                                    <TableHead className="text-yellow-500 text-right">Vendidos</TableHead>
                                    <TableHead className="text-yellow-500 text-right">Receita vendida</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {items.map((row) => (
                                    <TableRow key={row.product_id} className="border-yellow-500/10">
                                        <TableCell className="text-gray-200 text-sm">
                                            <div className="font-medium">{row.name}</div>
                                            <div className="text-xs text-gray-500 mt-0.5">
                                                {money(row.unit_price)}
                                                {row.packaging_type === 'box' && row.units_per_box
                                                    ? ` · caixa c/ ${row.units_per_box}`
                                                    : ''}
                                                {!row.active ? ' · inativo' : ''}
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-gray-400 text-sm">
                                            {row.establishment_name}
                                        </TableCell>
                                        <TableCell className="text-right text-cyan-300 font-semibold tabular-nums">
                                            {qty(row.stock_quantity)}
                                        </TableCell>
                                        <TableCell className="text-right text-yellow-400 font-semibold tabular-nums">
                                            {qty(row.sold_quantity)}
                                        </TableCell>
                                        <TableCell className="text-right text-gray-300 tabular-nums">
                                            {money(row.sold_revenue)}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    )}
                </CardContent>
            </Card>
        </div>
    );
};

function StatCard({ label, value }: { label: string; value: string }) {
    return (
        <Card className="bg-black border-yellow-500/30">
            <CardContent className="pt-6">
                <p className="text-gray-500 text-xs">{label}</p>
                <p className="text-xl font-semibold text-yellow-500 mt-1">{value}</p>
            </CardContent>
        </Card>
    );
}

export default ManagerCreditProductInventoryReport;
