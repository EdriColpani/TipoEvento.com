import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
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
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { ArrowLeft, FileText, Loader2, Search } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useProfile } from '@/hooks/use-profile';
import {
    useAdminCompanyContractAcceptances,
    useAdminContractAcceptanceCompanies,
    type AdminContractAcceptanceRow,
} from '@/hooks/use-admin-contract-acceptances-report';
import { getContractTypeLabel } from '@/constants/event-contracts';
import { showError } from '@/utils/toast';
import ContractHtmlBody from '@/components/ContractHtmlBody';

const ADMIN_MASTER_USER_TYPE_ID = 1;

function dt(iso: string | null | undefined): string {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('pt-BR');
}

function boolLabel(value: boolean | null | undefined): string {
    if (value === true) return 'Sim';
    if (value === false) return 'Não';
    return '—';
}

const AdminContractAcceptancesReport: React.FC = () => {
    const navigate = useNavigate();
    const [userId, setUserId] = useState<string | undefined>();
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedCompanyId, setSelectedCompanyId] = useState('');
    const [detailRow, setDetailRow] = useState<AdminContractAcceptanceRow | null>(null);

    useEffect(() => {
        supabase.auth.getUser().then(({ data: { user } }) => setUserId(user?.id));
    }, []);

    const { profile, isLoading: isLoadingProfile } = useProfile(userId);
    const isAdminMaster = profile?.tipo_usuario_id === ADMIN_MASTER_USER_TYPE_ID;

    const companiesQuery = useAdminContractAcceptanceCompanies(searchTerm, Boolean(isAdminMaster));
    const reportQuery = useAdminCompanyContractAcceptances(
        selectedCompanyId || null,
    );

    const companyOptions = companiesQuery.data ?? [];

    const selectedCompanyLabel = useMemo(() => {
        const found = companyOptions.find((c) => c.company_id === selectedCompanyId);
        return found?.company_name ?? '';
    }, [companyOptions, selectedCompanyId]);

    useEffect(() => {
        if (companiesQuery.isError) {
            showError('Erro ao carregar empresas para o relatório de aceites.');
        }
    }, [companiesQuery.isError]);

    useEffect(() => {
        if (reportQuery.isError) {
            showError('Erro ao carregar aceites de contrato da empresa.');
        }
    }, [reportQuery.isError]);

    if (isLoadingProfile) {
        return (
            <div className="max-w-6xl mx-auto flex justify-center py-24">
                <Loader2 className="h-10 w-10 animate-spin text-yellow-500" />
            </div>
        );
    }

    if (!isAdminMaster) {
        return (
            <div className="max-w-3xl mx-auto text-center py-24">
                <p className="text-gray-400">Este relatório é exclusivo do Admin Master.</p>
                <Button className="mt-4" variant="outline" onClick={() => navigate('/manager/reports')}>
                    Voltar aos relatórios
                </Button>
            </div>
        );
    }

    const company = reportQuery.data?.company;
    const items = reportQuery.data?.items ?? [];

    return (
        <div className="max-w-7xl mx-auto">
            <div className="mb-6 flex items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-serif text-yellow-500 flex items-center gap-2">
                        <FileText className="h-7 w-7" />
                        Aceites de contrato (auditoria)
                    </h1>
                    <p className="text-gray-400 text-sm mt-1">
                        Trilha de aceite por empresa: usuário, versão, hash, snapshot e metadados do navegador.
                    </p>
                </div>
                <Button variant="ghost" className="text-gray-400" onClick={() => navigate('/manager/reports')}>
                    <ArrowLeft className="h-4 w-4 mr-1" /> Relatórios
                </Button>
            </div>

            <Card className="bg-black border-yellow-500/30 mb-6">
                <CardHeader>
                    <CardTitle className="text-white">Pesquisar empresa</CardTitle>
                    <CardDescription className="text-gray-400">
                        Busque por razão social, nome fantasia ou CNPJ e selecione a empresa para ver todos os aceites.
                    </CardDescription>
                </CardHeader>
                <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <Label className="text-gray-300">Busca</Label>
                        <div className="relative mt-1">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
                            <Input
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                placeholder="Nome ou CNPJ da empresa"
                                className="pl-9 bg-black border-yellow-500/30 text-white"
                            />
                        </div>
                    </div>
                    <div>
                        <Label className="text-gray-300">Empresa</Label>
                        <Select
                            value={selectedCompanyId}
                            onValueChange={setSelectedCompanyId}
                        >
                            <SelectTrigger className="mt-1 bg-black border-yellow-500/30 text-white">
                                <SelectValue placeholder="Selecione uma empresa" />
                            </SelectTrigger>
                            <SelectContent>
                                {companyOptions.map((companyOption) => (
                                    <SelectItem key={companyOption.company_id} value={companyOption.company_id}>
                                        {companyOption.company_name}
                                        {companyOption.billing_plan ? ` · ${companyOption.billing_plan}` : ''}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                </CardContent>
            </Card>

            {selectedCompanyId && (
                <Card className="bg-black border-yellow-500/30 mb-6">
                    <CardHeader>
                        <CardTitle className="text-white">{selectedCompanyLabel || 'Empresa selecionada'}</CardTitle>
                        <CardDescription className="text-gray-400">
                            Plano: {company?.billing_plan ?? '—'} · Aceite do plano:{' '}
                            {dt(company?.billing_plan_accepted_at)} · Reaceite pendente:{' '}
                            {company?.requires_billing_reacceptance ? 'Sim' : 'Não'}
                        </CardDescription>
                    </CardHeader>
                </Card>
            )}

            <Card className="bg-black border-yellow-500/30">
                <CardHeader>
                    <CardTitle className="text-white">
                        Aceites registrados ({selectedCompanyId ? items.length : 0})
                    </CardTitle>
                </CardHeader>
                <CardContent className="overflow-x-auto">
                    {!selectedCompanyId ? (
                        <p className="text-gray-500 text-sm text-center py-10">
                            Selecione uma empresa para visualizar os aceites.
                        </p>
                    ) : reportQuery.isLoading ? (
                        <Loader2 className="h-8 w-8 animate-spin text-yellow-500 mx-auto" />
                    ) : items.length === 0 ? (
                        <p className="text-gray-500 text-sm text-center py-10">
                            Nenhum aceite registrado para esta empresa ou usuários vinculados.
                        </p>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow className="border-yellow-500/20">
                                    <TableHead className="text-yellow-500">Data/hora</TableHead>
                                    <TableHead className="text-yellow-500">Tipo</TableHead>
                                    <TableHead className="text-yellow-500">Versão</TableHead>
                                    <TableHead className="text-yellow-500">Usuário</TableHead>
                                    <TableHead className="text-yellow-500">Origem</TableHead>
                                    <TableHead className="text-yellow-500">Scroll</TableHead>
                                    <TableHead className="text-yellow-500">Hash</TableHead>
                                    <TableHead className="text-yellow-500" />
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {items.map((row) => (
                                    <TableRow key={row.id} className="border-yellow-500/10">
                                        <TableCell className="text-gray-300 text-xs whitespace-nowrap">
                                            {dt(row.accepted_at)}
                                        </TableCell>
                                        <TableCell className="text-gray-300 text-xs">
                                            {getContractTypeLabel(row.contract_type)}
                                        </TableCell>
                                        <TableCell className="text-gray-300 text-xs">
                                            {row.contract_version}
                                            {row.current_contract_version &&
                                            row.current_contract_version !== row.contract_version
                                                ? ` (atual ${row.current_contract_version})`
                                                : ''}
                                        </TableCell>
                                        <TableCell className="text-gray-300 text-xs">
                                            <div>{row.user_name || '—'}</div>
                                            <div className="text-gray-500">{row.user_email || row.user_id}</div>
                                        </TableCell>
                                        <TableCell className="text-gray-300 text-xs">
                                            {row.acceptance_source || '—'}
                                        </TableCell>
                                        <TableCell className="text-gray-300 text-xs">
                                            {boolLabel(row.scrolled_to_end)}
                                        </TableCell>
                                        <TableCell
                                            className="text-gray-500 text-xs font-mono truncate max-w-[8rem]"
                                            title={row.content_hash ?? ''}
                                        >
                                            {row.content_hash ? `${row.content_hash.slice(0, 12)}…` : '—'}
                                        </TableCell>
                                        <TableCell>
                                            <Button
                                                type="button"
                                                size="sm"
                                                variant="outline"
                                                className="border-yellow-500/30 text-yellow-500"
                                                onClick={() => setDetailRow(row)}
                                            >
                                                Detalhes
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    )}
                </CardContent>
            </Card>

            <Dialog open={!!detailRow} onOpenChange={(open) => !open && setDetailRow(null)}>
                <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto bg-black border border-yellow-500/30 text-white">
                    {detailRow && (
                        <>
                            <DialogHeader>
                                <DialogTitle className="text-yellow-500">
                                    {detailRow.contract_title_snapshot || 'Aceite de contrato'}
                                </DialogTitle>
                                <DialogDescription className="text-gray-400">
                                    {getContractTypeLabel(detailRow.contract_type)} · versão {detailRow.contract_version} ·{' '}
                                    {dt(detailRow.accepted_at)}
                                </DialogDescription>
                            </DialogHeader>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                                <div><span className="text-gray-500">ID aceite:</span> <span className="font-mono text-xs">{detailRow.id}</span></div>
                                <div><span className="text-gray-500">Contrato ID:</span> <span className="font-mono text-xs">{detailRow.contract_id}</span></div>
                                <div><span className="text-gray-500">Usuário:</span> {detailRow.user_email || detailRow.user_id}</div>
                                <div><span className="text-gray-500">Empresa ID:</span> {detailRow.company_id || '—'}</div>
                                <div><span className="text-gray-500">Origem:</span> {detailRow.acceptance_source || '—'}</div>
                                <div><span className="text-gray-500">Scroll até o fim:</span> {boolLabel(detailRow.scrolled_to_end)}</div>
                                <div><span className="text-gray-500">IP:</span> {detailRow.accepted_ip || '—'}</div>
                                <div><span className="text-gray-500">Contrato ativo hoje:</span> {boolLabel(detailRow.current_contract_is_active)}</div>
                                <div className="md:col-span-2"><span className="text-gray-500">User-Agent:</span> <span className="text-xs break-all">{detailRow.user_agent || '—'}</span></div>
                                <div className="md:col-span-2"><span className="text-gray-500">Hash SHA-256:</span> <span className="font-mono text-xs break-all">{detailRow.content_hash || '—'}</span></div>
                            </div>

                            {detailRow.content_snapshot && (
                                <div className="mt-4 border border-yellow-500/20 rounded-xl p-4 bg-black/40 max-h-[24rem] overflow-y-auto">
                                    <ContractHtmlBody html={detailRow.content_snapshot} />
                                </div>
                            )}
                        </>
                    )}
                </DialogContent>
            </Dialog>
        </div>
    );
};

export default AdminContractAcceptancesReport;
