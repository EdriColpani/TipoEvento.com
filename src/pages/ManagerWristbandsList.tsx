import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Search, Loader2, AlertTriangle, Tag, Settings, Info } from 'lucide-react';
import { usePageAuth } from '@/hooks/use-page-auth';
import { useManagerWristbands, WristbandData } from '@/hooks/use-manager-wristbands';
import { useProfile } from '@/hooks/use-profile';
import { useManagerCompany } from '@/hooks/use-manager-company';
import { useCompanyBilling } from '@/hooks/use-company-billing';
import { companyAllowsTicketSales } from '@/utils/company-billing-rules';
import EventActivationReminderBanner from '@/components/EventActivationReminderBanner';
import { isEventLifecycleEnded } from '@/utils/event-lifecycle';
import { formatEventDateForDisplay } from '@/utils/format-event-date';
import { showError } from '@/utils/toast';

const formatQty = (n: number) => n.toLocaleString('pt-BR');

const ADMIN_MASTER_USER_TYPE_ID = 1;

type LifecycleFilter = 'active' | 'ended' | 'all';

function isWristbandEventEnded(w: WristbandData): boolean {
    const ev = w.events;
    if (!ev) return false;
    return Boolean(ev.lifecycle_ended_at) || isEventLifecycleEnded(ev.date, ev.time);
}

const ManagerWristbandsList: React.FC = () => {
    const navigate = useNavigate();
    const { userId, authPending } = usePageAuth();
    const [searchTerm, setSearchTerm] = useState('');
    const [lifecycleFilter, setLifecycleFilter] = useState<LifecycleFilter>('active');

    const { profile, isLoading: isLoadingProfile } = useProfile(userId);
    const isAdminMaster = profile?.tipo_usuario_id === ADMIN_MASTER_USER_TYPE_ID;
    const { company } = useManagerCompany(userId);
    const { billing } = useCompanyBilling(company?.id);
    const requiresPaidTickets = companyAllowsTicketSales(billing?.billing_plan);
    const hideManualCreate = requiresPaidTickets && !isAdminMaster;

    const { wristbands, isLoading, isFetching, isError } = useManagerWristbands(userId, isAdminMaster);

    const filteredWristbands = useMemo(() => {
        const term = searchTerm.toLowerCase();
        return wristbands.filter((wristband) => {
            const ended = isWristbandEventEnded(wristband);
            if (lifecycleFilter === 'active' && ended) return false;
            if (lifecycleFilter === 'ended' && !ended) return false;

            if (!term) return true;
            return (
                wristband.code.toLowerCase().includes(term) ||
                wristband.events?.title?.toLowerCase().includes(term) ||
                wristband.access_type.toLowerCase().includes(term)
            );
        });
    }, [wristbands, searchTerm, lifecycleFilter]);

    const endedCount = useMemo(
        () => wristbands.filter((w) => isWristbandEventEnded(w)).length,
        [wristbands],
    );
    const activeCount = wristbands.length - endedCount;

    const hasCounterRows = filteredWristbands.some((w) => w.inventory_mode === 'counter');
    const counterStockTotal = filteredWristbands
        .filter((w) => w.inventory_mode === 'counter')
        .reduce((sum, w) => sum + (w.batch_stock_total ?? 0), 0);
    const listCountLabel = hasCounterRows
        ? `${filteredWristbands.length} tipo(s) · ${formatQty(counterStockTotal)} ingressos em estoque`
        : String(filteredWristbands.length);

    const getStatusClasses = (status: WristbandData['status']) => {
        switch (status) {
            case 'active':
                return 'bg-green-500/20 text-green-400';
            case 'used':
            case 'cancelled':
                return 'bg-gray-500/20 text-gray-400';
            case 'lost':
                return 'bg-red-500/20 text-red-400';
            case 'pending':
                return 'bg-yellow-500/20 text-yellow-400';
            default:
                return 'bg-yellow-500/20 text-yellow-400';
        }
    };

    const getStatusText = (status: WristbandData['status']) => {
        switch (status) {
            case 'active': return 'Lote ativo';
            case 'used': return 'Vendido / associado';
            case 'lost': return 'Perdido';
            case 'cancelled': return 'Cancelado';
            case 'pending': return 'Pendente';
            default: return 'Desconhecido';
        }
    };

    const handleManageClick = (wristband: WristbandData) => {
        const ended = isWristbandEventEnded(wristband);
        if (ended && !isAdminMaster) {
            showError('Evento encerrado: ingressos só podem ser alterados pelo administrador.');
            return;
        }
        navigate(`/manager/wristbands/manage/${wristband.id}`);
    };

    if (authPending || (userId && isLoadingProfile)) {
        return (
            <div className="max-w-7xl mx-auto text-center py-20">
                <Loader2 className="h-8 w-8 animate-spin text-yellow-500 mx-auto mb-4" />
                <p className="text-gray-400">Verificando autenticação e perfil...</p>
            </div>
        );
    }

    if (isError) {
        return (
            <div className="text-red-400 text-center py-10 flex flex-col items-center">
                <AlertTriangle className="h-10 w-10 mb-4" />
                Erro ao carregar ingressos.
            </div>
        );
    }

    const filterBtn = (key: LifecycleFilter, label: string, count: number) => (
        <Button
            key={key}
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setLifecycleFilter(key)}
            className={
                lifecycleFilter === key
                    ? 'bg-yellow-500 text-black border-yellow-500 hover:bg-yellow-600 hover:text-black'
                    : 'bg-black/60 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 hover:text-yellow-400'
            }
        >
            {label} ({count})
        </Button>
    );

    return (
        <>
            <div className="max-w-7xl mx-auto">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-8">
                <h1 className="text-2xl sm:text-3xl font-serif text-yellow-500 mb-4 sm:mb-0 flex items-center">
                    {isAdminMaster ? `Todos os Ingressos (${listCountLabel})` : `Gestão de Ingressos (${listCountLabel})`}
                </h1>
                <div className="flex w-full sm:w-auto flex-col sm:flex-row gap-3">
                    <Button
                        onClick={() => navigate('/manager/dashboard')}
                        variant="outline"
                        className="bg-black/60 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 text-sm"
                    >
                        Voltar para o Dashboard
                    </Button>
                    {!hideManualCreate && (
                    <Button
                        onClick={() => navigate('/manager/wristbands/create')}
                        className="bg-yellow-500 text-black hover:bg-yellow-600 py-3 text-base font-semibold transition-all duration-300 cursor-pointer"
                    >
                        <Plus className="mr-2 h-5 w-5" />
                        Cadastrar Novo Ingresso
                    </Button>
                    )}
                </div>
            </div>

            <EventActivationReminderBanner />

            <Card className="bg-black border border-yellow-500/30 rounded-2xl shadow-2xl shadow-yellow-500/10 p-6">
                {hasCounterRows && (
                    <div className="mb-6 flex items-start gap-3 rounded-xl border border-cyan-400/40 bg-cyan-950/50 p-4 text-sm text-cyan-50">
                        <Info className="h-5 w-5 text-cyan-300 shrink-0 mt-0.5" />
                        <div>
                            <p className="font-semibold text-white mb-1">Estoque por lote</p>
                            <p className="text-cyan-100/90 text-xs leading-relaxed">
                                Cada linha abaixo é um <strong className="text-white">tipo</strong> (Standard, VIP…), não um
                                ingresso individual. A quantidade cadastrada no lote aparece na coluna{' '}
                                <strong className="text-white">Estoque</strong>. O QR code de cada ingresso é criado
                                automaticamente na venda.
                            </p>
                        </div>
                    </div>
                )}
                {!hideManualCreate && (
                <Button
                    onClick={() => navigate('/manager/wristbands/create')}
                    className="w-full bg-yellow-500 text-black hover:bg-yellow-600 py-3 px-8 text-lg font-semibold transition-all duration-300 cursor-pointer shadow-lg shadow-yellow-500/30 hover:shadow-yellow-500/50 mb-6"
                >
                    <Plus className="mr-2 h-6 w-6" />
                    Cadastrar Novo Ingresso
                </Button>
                )}

                <div className="flex flex-wrap gap-2 mb-2">
                    {filterBtn('active', 'Ativos', activeCount)}
                    {filterBtn('ended', 'Encerrados', endedCount)}
                    {filterBtn('all', 'Todos', wristbands.length)}
                </div>
                <p className="text-xs text-gray-500 mb-4">
                    <strong className="text-gray-400">Status do lote</strong> (ativo / vendido) é do ingresso.
                    Evento encerrado aparece no nome e na aba — não muda o status do lote.
                </p>

                <div className="relative mb-6">
                    <Input
                        type="search"
                        placeholder="Pesquisar por código ou evento..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="bg-black/60 border-yellow-500/30 text-white placeholder-gray-500 focus:border-yellow-500 w-full pl-10 py-3 rounded-xl"
                    />
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-yellow-500/60" />
                </div>

                {isLoading || (isFetching && wristbands.length === 0) ? (
                    <div className="text-center py-10">
                        <Loader2 className="h-8 w-8 animate-spin text-yellow-500 mx-auto mb-4" />
                        <p className="text-gray-400">Carregando ingressos...</p>
                    </div>
                ) : filteredWristbands.length === 0 ? (
                    <div className="text-center py-10">
                        <Tag className="h-12 w-12 text-gray-600 mx-auto mb-4" />
                        <p className="text-gray-400 text-lg">Nenhum ingresso encontrado.</p>
                        <p className="text-gray-500 text-sm mt-2">
                            {lifecycleFilter === 'active'
                                ? 'Não há ingressos de eventos ativos. Veja a aba Encerrados se precisar consultar o histórico.'
                                : 'Cadastre o primeiro ingresso para começar a gerenciar.'}
                        </p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <Table className="w-full min-w-[1000px]">
                            <TableHeader>
                                <TableRow className="border-b border-yellow-500/20 text-sm hover:bg-black/40">
                                    <TableHead className="text-left text-gray-400 font-semibold py-3">Código</TableHead>
                                    <TableHead className="text-left text-gray-400 font-semibold py-3">Evento</TableHead>
                                    <TableHead className="text-center text-gray-400 font-semibold py-3">Tipo de Acesso</TableHead>
                                    <TableHead className="text-center text-gray-400 font-semibold py-3">Início venda</TableHead>
                                    <TableHead className="text-center text-gray-400 font-semibold py-3">Término venda</TableHead>
                                    <TableHead className="text-center text-gray-400 font-semibold py-3">Estoque</TableHead>
                                    <TableHead className="text-center text-gray-400 font-semibold py-3">Status do lote</TableHead>
                                    <TableHead className="text-right text-gray-400 font-semibold py-3 w-[220px]">Ações</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {filteredWristbands.map((wristband) => {
                                    const ended = isWristbandEventEnded(wristband);
                                    const manageLocked = ended && !isAdminMaster;
                                    const saleStart = formatEventDateForDisplay(wristband.sale_start_date);
                                    const saleEnd = formatEventDateForDisplay(wristband.sale_end_date);
                                    return (
                                        <TableRow
                                            key={wristband.id}
                                            className="border-b border-yellow-500/10 hover:bg-black/40 transition-colors text-sm"
                                        >
                                            <TableCell className="py-4">
                                                <div className="text-white font-medium">{wristband.code}</div>
                                            </TableCell>
                                            <TableCell className="py-4">
                                                <div className="text-gray-300 truncate max-w-[200px]">{wristband.events?.title || 'Evento Removido'}</div>
                                                {ended && (
                                                    <span className="mt-1 inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-500/20 text-slate-300">
                                                        Evento encerrado
                                                    </span>
                                                )}
                                            </TableCell>
                                            <TableCell className="text-center py-4">
                                                <span className="text-yellow-500 font-medium">{wristband.access_type}</span>
                                            </TableCell>
                                            <TableCell className="text-center py-4 text-gray-300 text-xs sm:text-sm tabular-nums">
                                                {saleStart || '—'}
                                            </TableCell>
                                            <TableCell className="text-center py-4 text-gray-300 text-xs sm:text-sm tabular-nums">
                                                {saleEnd || '—'}
                                            </TableCell>
                                            <TableCell className="text-center py-4 tabular-nums text-gray-200">
                                                {wristband.inventory_mode === 'counter' ? (
                                                    <div className="text-xs sm:text-sm">
                                                        <div className="font-semibold text-white">
                                                            {formatQty(wristband.batch_stock_total ?? 0)}
                                                        </div>
                                                        <div className="text-gray-400 text-[11px]">
                                                            disp.{' '}
                                                            {formatQty(wristband.batch_stock_available ?? wristband.batch_stock_total ?? 0)}
                                                            {(wristband.batch_stock_sold ?? 0) > 0 && (
                                                                <> · vend. {formatQty(wristband.batch_stock_sold ?? 0)}</>
                                                            )}
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <span className="text-gray-500 text-xs">Unitário</span>
                                                )}
                                            </TableCell>
                                            <TableCell className="text-center py-4">
                                                <div className="flex flex-col items-center gap-1">
                                                    <span className={`px-3 py-1 rounded-full text-xs font-semibold ${getStatusClasses(wristband.status)}`}>
                                                        {getStatusText(wristband.status)}
                                                    </span>
                                                    {ended && (
                                                        <span className="text-[10px] text-slate-400">
                                                            (evento já encerrado)
                                                        </span>
                                                    )}
                                                </div>
                                            </TableCell>
                                            <TableCell className="text-right py-4 flex items-center justify-end space-x-2">
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    disabled={manageLocked}
                                                    title={
                                                        manageLocked
                                                            ? 'Evento encerrado — só o administrador pode editar'
                                                            : 'Gerenciar ingresso'
                                                    }
                                                    className="bg-black/60 border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 h-8 px-3 disabled:opacity-50"
                                                    onClick={() => handleManageClick(wristband)}
                                                >
                                                    <Settings className="h-4 w-4 mr-2" />
                                                    {manageLocked ? 'Bloqueado' : 'Gerenciar'}
                                                </Button>
                                            </TableCell>
                                        </TableRow>
                                    );
                                })}
                            </TableBody>
                        </Table>
                    </div>
                )}
            </Card>
        </div>
        </>
    );
};

export default ManagerWristbandsList;
