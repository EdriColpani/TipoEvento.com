import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Plus, Loader2, Edit, AlertTriangle, Power, History } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { showSuccess, showError, showLoading, dismissToast } from '@/utils/toast';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import CommissionTierForm from '@/components/CommissionTierForm';
import {
    CommissionRange,
    fetchCommissionRangesHistory,
    useCommissionRanges,
} from '@/hooks/use-commission-ranges';
import type { CommissionRangeHistory } from '@/hooks/use-commission-ranges';
import {
    billingAccentText,
    billingBtnGhost,
    billingBtnIconDanger,
    billingBtnIconEdit,
    billingBtnSolid,
    billingDialogSurface,
    billingPanelBorder,
    billingSpinner,
    billingTableHead,
} from '@/constants/billing-ui';

interface CommissionTiersPanelProps {
    userId: string;
    isAdminMaster: boolean;
}

const ToggleActiveDialog: React.FC<{ range: CommissionRange; onToggleSuccess: () => void }> = ({
    range,
    onToggleSuccess,
}) => {
    const [isToggling, setIsToggling] = useState(false);
    const [isDialogOpen, setIsDialogOpen] = useState(false);

    const handleToggle = async () => {
        setIsToggling(true);
        const toastId = showLoading(`${range.active ? 'Desativando' : 'Ativando'} faixa...`);

        try {
            if (range.active) {
                await supabase.from('commission_ranges_history').insert({
                    commission_range_id: range.id,
                    min_tickets: range.min_tickets,
                    max_tickets: range.max_tickets,
                    percentage: range.percentage,
                });
            }

            const { error } = await supabase
                .from('commission_ranges')
                .update({ active: !range.active })
                .eq('id', range.id);

            if (error) throw error;

            dismissToast(toastId);
            showSuccess(`Faixa ${range.active ? 'desativada' : 'ativada'} com sucesso.`);
            onToggleSuccess();
            setIsDialogOpen(false);
        } catch (error: unknown) {
            dismissToast(toastId);
            showError(
                `Falha ao ${range.active ? 'desativar' : 'ativar'} faixa: ${
                    error instanceof Error ? error.message : 'Erro desconhecido'
                }`,
            );
        } finally {
            setIsToggling(false);
        }
    };

    const rangeLabel = `${range.min_tickets.toLocaleString('pt-BR')} - ${
        range.max_tickets === 999999 ? 'ou mais' : range.max_tickets.toLocaleString('pt-BR')
    } ingressos`;

    return (
        <AlertDialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <AlertDialogTrigger asChild>
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className={range.active ? billingBtnIconDanger : billingBtnIconEdit}
                >
                    <Power className="h-4 w-4" />
                </Button>
            </AlertDialogTrigger>
            <AlertDialogContent className={billingDialogSurface}>
                <AlertDialogHeader>
                    <AlertDialogTitle className={billingAccentText}>
                        {range.active ? 'Desativar Faixa' : 'Ativar Faixa'}
                    </AlertDialogTitle>
                    <AlertDialogDescription className="text-gray-400">
                        Faixa: <span className="font-semibold text-white">{rangeLabel}</span>
                        <br />
                        Taxa:{' '}
                        <span className="font-semibold text-white">
                            {range.percentage.toFixed(2).replace('.', ',')}%
                        </span>
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel className={billingBtnGhost}>Cancelar</AlertDialogCancel>
                    <AlertDialogAction
                        onClick={handleToggle}
                        className={
                            range.active
                                ? 'bg-red-600 text-white hover:bg-red-700'
                                : billingBtnSolid
                        }
                        disabled={isToggling}
                    >
                        {isToggling ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                        ) : range.active ? (
                            'Desativar'
                        ) : (
                            'Ativar'
                        )}
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
};

const CommissionTiersPanel: React.FC<CommissionTiersPanelProps> = ({ userId, isAdminMaster }) => {
    const { ranges, isLoading, isError, invalidateRanges } = useCommissionRanges(isAdminMaster);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingRange, setEditingRange] = useState<CommissionRange | undefined>();
    const [showHistory, setShowHistory] = useState(false);
    const [history, setHistory] = useState<CommissionRangeHistory[]>([]);
    const [isLoadingHistory, setIsLoadingHistory] = useState(false);

    const handleToggleHistory = async () => {
        if (!showHistory) {
            setIsLoadingHistory(true);
            try {
                setHistory(await fetchCommissionRangesHistory());
            } catch (error: unknown) {
                showError(
                    `Erro ao carregar histórico: ${error instanceof Error ? error.message : 'Erro desconhecido'}`,
                );
            } finally {
                setIsLoadingHistory(false);
            }
        }
        setShowHistory(!showHistory);
    };

    if (isLoading) {
        return (
            <div className="text-center py-12">
                <Loader2 className={`h-8 w-8 animate-spin ${billingSpinner} mx-auto mb-4`} />
                <p className="text-gray-400">Carregando faixas de comissão...</p>
            </div>
        );
    }

    if (isError) {
        return (
            <div className="text-red-400 text-center py-10">
                <AlertTriangle className="h-12 w-12 mx-auto mb-4" />
                <p>Erro ao carregar faixas de comissão.</p>
            </div>
        );
    }

    const activeCount = ranges.filter((r) => r.active).length;

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-gray-400 text-sm">
                    Plano <strong className="text-white">% sobre venda de ingressos</strong> —{' '}
                    {activeCount} faixa(s) ativa(s) de {ranges.length}
                </p>
                <div className="flex flex-wrap gap-2">
                    <Button type="button" onClick={handleToggleHistory} size="sm" className={billingBtnGhost}>
                        <History className="mr-2 h-4 w-4" />
                        {showHistory ? 'Ocultar' : 'Mostrar'} histórico
                    </Button>
                    <Button
                        type="button"
                        size="sm"
                        className={billingBtnSolid}
                        onClick={() => {
                            setEditingRange(undefined);
                            setIsModalOpen(true);
                        }}
                    >
                        <Plus className="mr-2 h-4 w-4" />
                        Adicionar faixa
                    </Button>
                </div>
            </div>

            <Card className={`bg-black/40 border ${billingPanelBorder}`}>
                <CardDescription className="text-gray-400 text-sm p-6 pb-0">
                    Defina faixas de quantidade de ingressos com suas respectivas taxas de comissão. As faixas não
                    podem se sobrepor.
                </CardDescription>
                <CardContent className="p-6 pt-4">
                    {ranges.length === 0 ? (
                        <p className="text-gray-400 text-center py-8">Nenhuma faixa cadastrada.</p>
                    ) : (
                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow className="border-cyan-500/20">
                                        <TableHead className={billingTableHead}>Faixa de ingressos</TableHead>
                                        <TableHead className={`${billingTableHead} text-center`}>Comissão</TableHead>
                                        <TableHead className={`${billingTableHead} text-center`}>Status</TableHead>
                                        <TableHead className={`${billingTableHead} text-right`}>Ações</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {ranges.map((range) => {
                                        const maxDisplay =
                                            range.max_tickets === 999999
                                                ? 'ou mais'
                                                : range.max_tickets.toLocaleString('pt-BR');
                                        return (
                                            <TableRow
                                                key={range.id}
                                                className={`border-cyan-500/10 ${!range.active ? 'opacity-50' : ''}`}
                                            >
                                                <TableCell className="text-white">
                                                    {range.min_tickets.toLocaleString('pt-BR')} - {maxDisplay}
                                                </TableCell>
                                                <TableCell className="text-center text-cyan-400 font-bold">
                                                    {range.percentage.toFixed(2).replace('.', ',')}%
                                                </TableCell>
                                                <TableCell className="text-center">
                                                    <span
                                                        className={
                                                            range.active
                                                                ? 'text-green-400 text-xs'
                                                                : 'text-red-400 text-xs'
                                                        }
                                                    >
                                                        {range.active ? 'Ativa' : 'Inativa'}
                                                    </span>
                                                </TableCell>
                                                <TableCell className="text-right">
                                                    <div className="inline-flex items-center justify-end gap-2">
                                                        <Button
                                                            type="button"
                                                            variant="outline"
                                                            size="sm"
                                                            className={billingBtnIconEdit}
                                                            onClick={() => {
                                                                setEditingRange(range);
                                                                setIsModalOpen(true);
                                                            }}
                                                        >
                                                            <Edit className="h-4 w-4" />
                                                        </Button>
                                                        <Tooltip>
                                                            <TooltipTrigger asChild>
                                                                <span>
                                                                    <ToggleActiveDialog
                                                                        range={range}
                                                                        onToggleSuccess={invalidateRanges}
                                                                    />
                                                                </span>
                                                            </TooltipTrigger>
                                                            <TooltipContent>
                                                                {range.active ? 'Desativar' : 'Ativar'}
                                                            </TooltipContent>
                                                        </Tooltip>
                                                    </div>
                                                </TableCell>
                                            </TableRow>
                                        );
                                    })}
                                </TableBody>
                            </Table>
                        </div>
                    )}
                </CardContent>
            </Card>

            {showHistory && (
                <Card className={`bg-black/40 border ${billingPanelBorder}`}>
                    <CardHeader>
                        <CardTitle className={`${billingAccentText} text-lg`}>Histórico de alterações</CardTitle>
                    </CardHeader>
                    <CardContent>
                        {isLoadingHistory ? (
                            <Loader2 className={`h-6 w-6 animate-spin ${billingSpinner} mx-auto`} />
                        ) : history.length === 0 ? (
                            <p className="text-gray-500 text-sm text-center py-4">Nenhum registro.</p>
                        ) : (
                            <div className="overflow-x-auto max-h-64">
                                <Table>
                                    <TableBody>
                                        {history.map((entry) => (
                                            <TableRow key={entry.id} className="border-cyan-500/10">
                                                <TableCell className="text-white text-sm">
                                                    {entry.min_tickets.toLocaleString('pt-BR')} -{' '}
                                                    {entry.max_tickets === 999999
                                                        ? 'ou mais'
                                                        : entry.max_tickets.toLocaleString('pt-BR')}{' '}
                                                    → {entry.percentage.toFixed(2).replace('.', ',')}%
                                                </TableCell>
                                                <TableCell className="text-gray-500 text-xs text-right">
                                                    {new Date(entry.changed_at).toLocaleString('pt-BR')}
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </div>
                        )}
                    </CardContent>
                </Card>
            )}

            <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
                <DialogContent className={`sm:max-w-[700px] ${billingDialogSurface}`}>
                    <DialogHeader>
                        <DialogTitle className={billingAccentText}>
                            {editingRange ? 'Editar faixa' : 'Nova faixa de comissão'}
                        </DialogTitle>
                        <DialogDescription className="text-gray-400">
                            Faixas por volume de ingressos vendidos no evento.
                        </DialogDescription>
                    </DialogHeader>
                    <CommissionTierForm
                        initialData={editingRange}
                        existingRanges={ranges.filter((r) => r.id !== editingRange?.id)}
                        onSaveSuccess={() => {
                            setIsModalOpen(false);
                            setEditingRange(undefined);
                            invalidateRanges();
                        }}
                        onCancel={() => {
                            setIsModalOpen(false);
                            setEditingRange(undefined);
                        }}
                        userId={userId}
                    />
                </DialogContent>
            </Dialog>
        </div>
    );
};

export default CommissionTiersPanel;
