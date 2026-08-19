import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { Download, FileText, Loader2 } from 'lucide-react';
import { useManagerCompanyContractAcceptances } from '@/hooks/use-manager-contract-acceptances';
import { getContractTypeLabel } from '@/constants/event-contracts';
import { getBillingPlanLabel } from '@/constants/billing-plans';
import { downloadContractAcceptancePdf, openContractAcceptancePdf } from '@/utils/contract-acceptance-pdf';
import { showError } from '@/utils/toast';

const OUTLINE_BTN =
    'bg-black/60 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 hover:text-yellow-400';

type Props = {
    companyId: string;
};

function dt(iso: string | null | undefined): string {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('pt-BR');
}

function planFromSnapshot(snap: Record<string, unknown> | null | undefined): string {
    const plan = snap?.billing_plan;
    if (typeof plan !== 'string' || !plan) return '—';
    return getBillingPlanLabel(plan) || plan;
}

const CompanyContractAcceptancesHistory: React.FC<Props> = ({ companyId }) => {
    const query = useManagerCompanyContractAcceptances(companyId);
    const [busyId, setBusyId] = useState<string | null>(null);
    const items = (query.data?.items ?? []).filter(
        (row): row is typeof row & { id: string } => typeof row?.id === 'string' && row.id.length > 0,
    );

    const handlePdf = async (rowId: string, path: string | null, mode: 'view' | 'download') => {
        if (!path) {
            showError('PDF ainda não disponível para este aceite.');
            return;
        }
        setBusyId(rowId);
        try {
            if (mode === 'view') await openContractAcceptancePdf(path);
            else await downloadContractAcceptancePdf(path, `contrato-aceite-${rowId.slice(0, 8) || 'aceite'}.pdf`);
        } catch (e: unknown) {
            showError(e instanceof Error ? e.message : 'Falha ao abrir o PDF.');
        } finally {
            setBusyId(null);
        }
    };

    return (
        <Card className="bg-black border border-yellow-500/30 rounded-2xl mt-6">
            <CardHeader>
                <CardTitle className="text-yellow-500 text-xl flex items-center gap-2">
                    <FileText className="h-5 w-5" />
                    Histórico de contratos aceitos
                </CardTitle>
                <CardDescription className="text-gray-400">
                    Aceites registrados desta empresa. Versões antigas permanecem preservadas com PDF e hash.
                </CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
                {query.isLoading ? (
                    <div className="py-8 text-center">
                        <Loader2 className="h-8 w-8 animate-spin text-yellow-500 mx-auto" />
                    </div>
                ) : query.isError ? (
                    <p className="text-red-400 text-sm text-center py-6">
                        Não foi possível carregar o histórico de aceites.
                    </p>
                ) : items.length === 0 ? (
                    <p className="text-gray-500 text-sm text-center py-8">
                        Nenhum aceite de contrato registrado ainda para esta empresa.
                    </p>
                ) : (
                    <Table>
                        <TableHeader>
                            <TableRow className="border-yellow-500/20">
                                <TableHead className="text-yellow-500">Data</TableHead>
                                <TableHead className="text-yellow-500">Versão</TableHead>
                                <TableHead className="text-yellow-500">Tipo</TableHead>
                                <TableHead className="text-yellow-500">Plano</TableHead>
                                <TableHead className="text-yellow-500">Status</TableHead>
                                <TableHead className="text-yellow-500">ID</TableHead>
                                <TableHead className="text-yellow-500" />
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {items.map((row) => {
                                const isCurrent =
                                    row.current_contract_is_active &&
                                    row.current_contract_version === row.contract_version;
                                return (
                                    <TableRow key={row.id} className="border-yellow-500/10">
                                        <TableCell className="text-gray-300 text-xs whitespace-nowrap">
                                            {dt(row.accepted_at)}
                                        </TableCell>
                                        <TableCell className="text-gray-300 text-xs">
                                            {row.contract_version}
                                        </TableCell>
                                        <TableCell className="text-gray-300 text-xs">
                                            {getContractTypeLabel(row.contract_type)}
                                        </TableCell>
                                        <TableCell className="text-gray-300 text-xs">
                                            {planFromSnapshot(row.commercial_terms_snapshot)}
                                        </TableCell>
                                        <TableCell className="text-gray-300 text-xs">
                                            {isCurrent ? 'Vigente' : 'Histórico'}
                                            {row.verification_method === 'email_otp' ? ' · OTP e-mail' : ''}
                                        </TableCell>
                                        <TableCell
                                            className="text-gray-500 text-xs font-mono truncate max-w-[7rem]"
                                            title={row.id}
                                        >
                                            {row.id.slice(0, 8)}…
                                        </TableCell>
                                        <TableCell className="space-x-2 whitespace-nowrap">
                                            <Button
                                                type="button"
                                                size="sm"
                                                variant="outline"
                                                className={OUTLINE_BTN}
                                                disabled={!row.pdf_storage_path || busyId === row.id}
                                                onClick={() =>
                                                    void handlePdf(row.id, row.pdf_storage_path, 'view')
                                                }
                                            >
                                                {busyId === row.id ? (
                                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                                ) : (
                                                    'Visualizar'
                                                )}
                                            </Button>
                                            <Button
                                                type="button"
                                                size="sm"
                                                variant="outline"
                                                className={OUTLINE_BTN}
                                                disabled={!row.pdf_storage_path || busyId === row.id}
                                                onClick={() =>
                                                    void handlePdf(row.id, row.pdf_storage_path, 'download')
                                                }
                                            >
                                                <Download className="h-3.5 w-3.5" />
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                );
                            })}
                        </TableBody>
                    </Table>
                )}
            </CardContent>
        </Card>
    );
};

export default CompanyContractAcceptancesHistory;
