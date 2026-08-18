import React, { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Download, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import AdminTaxGuideCreateForm from '@/components/AdminTaxGuideCreateForm';
import {
    cancelAdminTaxGuide,
    createAdminTaxGuide,
    markAdminTaxGuidePaid,
    useAdminTaxGuides,
} from '@/hooks/use-admin-tax-guides';
import { exportTaxGuidesCsv } from '@/utils/export-tax-guides-csv';
import { showError, showSuccess } from '@/utils/toast';

function money(v: number | null | undefined): string {
    return Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function currentCompetence(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function todayIso(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fmtDate(iso: string | null | undefined): string {
    if (!iso) return '—';
    return new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR');
}

const STATUS_LABEL: Record<string, string> = {
    open: 'A pagar',
    paid: 'Pago',
    cancelled: 'Cancelado',
};

const BTN_OUTLINE =
    'bg-black/60 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 hover:text-yellow-400 disabled:opacity-50';
const INPUT_CLS = 'bg-black border-yellow-500/30 text-white mt-1';

const AdminTaxGuidesPanel: React.FC = () => {
    const queryClient = useQueryClient();
    const [competence, setCompetence] = useState(currentCompetence);
    const [taxType, setTaxType] = useState('DAS');
    const [description, setDescription] = useState('');
    const [dueDate, setDueDate] = useState('');
    const [amount, setAmount] = useState('');
    const [payDate, setPayDate] = useState(todayIso);
    const [busy, setBusy] = useState(false);

    const query = useAdminTaxGuides(competence);
    const items = query.data?.items ?? [];
    const summary = query.data?.summary;
    const profitBase = Number(query.data?.profit_base ?? 0);

    const competenceLabel = useMemo(() => {
        const [y, m] = competence.split('-');
        if (!y || !m) return competence;
        return `${m}/${y}`;
    }, [competence]);

    const refresh = () => queryClient.invalidateQueries({ queryKey: ['adminTaxGuides'] });

    const handleCreate = async () => {
        const value = Number(String(amount).replace(',', '.'));
        if (!taxType || !description.trim() || !competence || !dueDate || !(value > 0)) {
            showError('Preencha tipo, descrição, competência, vencimento e valor da guia.');
            return;
        }
        setBusy(true);
        try {
            await createAdminTaxGuide({
                taxType,
                description: description.trim(),
                competence,
                dueDate,
                amount: value,
            });
            showSuccess('Guia lançada como A pagar.');
            setDescription('');
            setAmount('');
            setDueDate('');
            refresh();
        } catch (err: unknown) {
            showError(err instanceof Error ? err.message : 'Falha ao lançar a guia.');
        } finally {
            setBusy(false);
        }
    };

    const handlePay = async (id: string) => {
        if (!payDate) {
            showError('Informe a data de pagamento.');
            return;
        }
        if (!window.confirm('Baixar esta guia como paga?')) return;
        setBusy(true);
        try {
            await markAdminTaxGuidePaid(id, payDate);
            showSuccess('Guia baixada como paga.');
            refresh();
        } catch (err: unknown) {
            showError(err instanceof Error ? err.message : 'Falha ao baixar a guia.');
        } finally {
            setBusy(false);
        }
    };

    const handleCancel = async (id: string) => {
        const reason = window.prompt('Motivo do cancelamento (obrigatório):');
        if (!reason?.trim()) return;
        setBusy(true);
        try {
            await cancelAdminTaxGuide(id, reason.trim());
            showSuccess('Guia cancelada.');
            refresh();
        } catch (err: unknown) {
            showError(err instanceof Error ? err.message : 'Falha ao cancelar.');
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="space-y-4">
            <Card className="bg-black border-yellow-500/30">
                <CardHeader>
                    <CardTitle className="text-white text-lg">Impostos a pagar</CardTitle>
                    <CardDescription className="text-gray-400">
                        A base é o lucro EventFest da competência (sintético fiscal). O contador lança o valor de cada
                        guia; o sistema não calcula alíquota.
                    </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-4 items-end">
                    <div>
                        <Label className="text-gray-400 text-xs">Competência</Label>
                        <Input
                            type="month"
                            value={competence}
                            onChange={(e) => setCompetence(e.target.value)}
                            className={INPUT_CLS}
                        />
                    </div>
                    <Button
                        type="button"
                        variant="outline"
                        className={BTN_OUTLINE}
                        onClick={() => exportTaxGuidesCsv(items, competence, profitBase)}
                        disabled={items.length === 0}
                    >
                        <Download className="h-4 w-4 mr-1" /> CSV
                    </Button>
                </CardContent>
            </Card>

            <Card className="bg-black border-cyan-500/40">
                <CardContent className="pt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    <div>
                        <p className="text-xs text-cyan-200/80">Base de impostos · {competenceLabel}</p>
                        <p className="text-2xl font-semibold text-white mt-1">{money(profitBase)}</p>
                        <p className="text-xs text-gray-500 mt-1">Soma de todas as receitas EventFest no mês.</p>
                    </div>
                    <div>
                        <p className="text-xs text-gray-400">Guias a pagar</p>
                        <p className="text-xl font-semibold text-yellow-400 mt-1">{money(summary?.open_total)}</p>
                    </div>
                    <div>
                        <p className="text-xs text-gray-400">Já pagas</p>
                        <p className="text-xl font-semibold text-white mt-1">{money(summary?.paid_total)}</p>
                    </div>
                    <div>
                        <p className="text-xs text-gray-400">Guias no mês</p>
                        <p className="text-xl font-semibold text-white mt-1">{summary?.guides_count ?? 0}</p>
                    </div>
                </CardContent>
            </Card>

            <AdminTaxGuideCreateForm
                taxType={taxType}
                description={description}
                dueDate={dueDate}
                amount={amount}
                busy={busy}
                onTaxType={setTaxType}
                onDescription={setDescription}
                onDueDate={setDueDate}
                onAmount={setAmount}
                onSubmit={handleCreate}
            />

            <Card className="bg-black border-yellow-500/30">
                <CardHeader>
                    <CardTitle className="text-white text-base">Guias da competência</CardTitle>
                    <CardDescription className="text-gray-400">
                        Data de pagamento é obrigatória na baixa. Use o campo abaixo e depois Baixar como pago.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="mb-4 max-w-[220px]">
                        <Label className="text-gray-400 text-xs">Data de pagamento (baixa)</Label>
                        <Input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} className={INPUT_CLS} />
                    </div>
                    {query.isLoading ? (
                        <Loader2 className="h-8 w-8 animate-spin text-yellow-500 mx-auto" />
                    ) : items.length === 0 ? (
                        <p className="text-gray-500 text-sm text-center py-8">Nenhuma guia lançada nesta competência.</p>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow className="border-yellow-500/20">
                                    <TableHead className="text-yellow-500">Tipo</TableHead>
                                    <TableHead className="text-yellow-500">Descrição</TableHead>
                                    <TableHead className="text-yellow-500">Vencimento</TableHead>
                                    <TableHead className="text-yellow-500 text-right">Valor</TableHead>
                                    <TableHead className="text-yellow-500">Status</TableHead>
                                    <TableHead className="text-yellow-500">Pagamento</TableHead>
                                    <TableHead className="text-yellow-500" />
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {items.map((row) => (
                                    <TableRow key={row.id} className="border-yellow-500/10">
                                        <TableCell className="text-gray-200 text-xs">{row.tax_type}</TableCell>
                                        <TableCell className="text-gray-300 text-xs max-w-[240px]">
                                            {row.description}
                                        </TableCell>
                                        <TableCell className="text-gray-400 text-xs">{fmtDate(row.due_date)}</TableCell>
                                        <TableCell className="text-right text-white text-xs">{money(row.amount)}</TableCell>
                                        <TableCell className="text-gray-200 text-xs">
                                            {STATUS_LABEL[row.status] ?? row.status}
                                        </TableCell>
                                        <TableCell className="text-gray-400 text-xs">{fmtDate(row.paid_at)}</TableCell>
                                        <TableCell className="text-right whitespace-nowrap">
                                            {row.status === 'open' && (
                                                <>
                                                    <Button
                                                        type="button"
                                                        size="sm"
                                                        className="bg-yellow-500 text-black hover:bg-yellow-600 disabled:opacity-50 mr-2"
                                                        disabled={busy}
                                                        onClick={() => handlePay(row.id)}
                                                    >
                                                        Baixar como pago
                                                    </Button>
                                                    <Button
                                                        type="button"
                                                        size="sm"
                                                        variant="outline"
                                                        className={BTN_OUTLINE}
                                                        disabled={busy}
                                                        onClick={() => handleCancel(row.id)}
                                                    >
                                                        Cancelar
                                                    </Button>
                                                </>
                                            )}
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

export default AdminTaxGuidesPanel;
