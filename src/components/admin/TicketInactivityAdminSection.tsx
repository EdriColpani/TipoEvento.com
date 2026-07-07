import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2, Mail, Play, Save } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useSystemBillingSettings } from '@/hooks/use-system-billing-settings';
import {
    adminRunTicketInactivityCheck,
    adminRunTicketInactivityAutoDeactivateJob,
    adminRunTicketInactivityMonthlyJob,
    verifyAntiFraudDeploy,
} from '@/hooks/use-company-ticket-inactivity';
import { showError, showSuccess, showLoading, dismissToast } from '@/utils/toast';
import {
    billingAccentText,
    billingBtnGhost,
    billingBtnSolid,
    billingInput,
    billingPanelBorder,
    billingSpinner,
    billingTableHead,
} from '@/constants/billing-ui';
import { supabase } from '@/integrations/supabase/client';
import { callRpcRest } from '@/utils/supabase-rest-rpc';

interface AutoDeactivateLogRow {
    id: string;
    event_title: string;
    company_name: string | null;
    event_date: string;
    days_after: number;
    created_at: string;
}

async function fetchAutoDeactivateLog(): Promise<AutoDeactivateLogRow[]> {
    const data = await callRpcRest<{ rows?: AutoDeactivateLogRow[] }>(
        'admin_list_event_auto_deactivate_log',
        { p_limit: 20 },
        12_000,
    );
    return Array.isArray(data?.rows) ? data.rows : [];
}

interface TicketInactivityAdminSectionProps {
    enabled: boolean;
}

const TicketInactivityAdminSection: React.FC<TicketInactivityAdminSectionProps> = ({ enabled }) => {
    const { settings, isLoading, invalidate } = useSystemBillingSettings(enabled);
    const autoDeactivateLog = useQuery({
        queryKey: ['adminEventAutoDeactivateLog'],
        queryFn: fetchAutoDeactivateLog,
        enabled,
        staleTime: 60_000,
    });
    const [inactivityEnabled, setInactivityEnabled] = useState(true);
    const [feeDefault, setFeeDefault] = useState('0');
    const [autoDeactivateEnabled, setAutoDeactivateEnabled] = useState(false);
    const [autoDeactivateDays, setAutoDeactivateDays] = useState('30');
    const [useAutoMonth, setUseAutoMonth] = useState(true);
    const [referenceMonth, setReferenceMonth] = useState('');
    const [isSaving, setIsSaving] = useState(false);
    const [isRunning, setIsRunning] = useState(false);
    const [isRunningJob, setIsRunningJob] = useState(false);
    const [isRunningAutoDeactivate, setIsRunningAutoDeactivate] = useState(false);
    const [isVerifyingDeploy, setIsVerifyingDeploy] = useState(false);

    React.useEffect(() => {
        if (!settings) return;
        setInactivityEnabled(settings.ticket_inactivity_enabled ?? true);
        setFeeDefault(String(settings.ticket_inactivity_fee_default ?? 0));
        setAutoDeactivateEnabled(settings.ticket_inactivity_auto_deactivate_enabled === true);
        setAutoDeactivateDays(String(settings.ticket_inactivity_auto_deactivate_days ?? 30));
    }, [settings]);

    const handleSaveSettings = async () => {
        const fee = Number.parseFloat(feeDefault.replace(',', '.'));
        const days = Number.parseInt(autoDeactivateDays, 10);
        if (!Number.isFinite(fee) || fee < 0) {
            showError('Informe um valor fixo válido (≥ 0).');
            return;
        }
        if (!Number.isFinite(days) || days < 0 || days > 365) {
            showError('Informe dias válidos (0–365). Use 0 para desligar a auto-desativação.');
            return;
        }

        setIsSaving(true);
        const toastId = showLoading('Salvando regras de inatividade...');
        try {
            const { error } = await supabase.from('system_billing_settings').upsert(
                {
                    id: 1,
                    ticket_inactivity_enabled: inactivityEnabled,
                    ticket_inactivity_fee_default: fee,
                    ticket_inactivity_auto_deactivate_enabled: autoDeactivateEnabled,
                    ticket_inactivity_auto_deactivate_days: days,
                    updated_at: new Date().toISOString(),
                },
                { onConflict: 'id' },
            );
            if (error) throw error;
            dismissToast(toastId);
            showSuccess('Regras de inatividade salvas.');
            invalidate();
        } catch (e: unknown) {
            dismissToast(toastId);
            showError(e instanceof Error ? e.message : 'Erro ao salvar.');
        } finally {
            setIsSaving(false);
        }
    };

    const handleRunCheck = async () => {
        setIsRunning(true);
        const toastId = showLoading('Executando verificação de inatividade...');
        try {
            const result = await adminRunTicketInactivityCheck(
                !useAutoMonth && referenceMonth.trim() !== '' ? `${referenceMonth}-01` : undefined,
            );
            dismissToast(toastId);
            showSuccess(
                `Verificação concluída. Mês: ${result.reference_month ?? '—'}. ` +
                    `Eventos sinalizados: ${result.events_flagged ?? 0}. ` +
                    `Empresas bloqueadas: ${result.companies_blocked ?? 0}. ` +
                    `Cobranças: ${result.charges_created ?? 0}.`,
            );
        } catch (e: unknown) {
            dismissToast(toastId);
            showError(e instanceof Error ? e.message : 'Erro ao executar verificação.');
        } finally {
            setIsRunning(false);
        }
    };

    const handleRunMonthlyJob = async () => {
        setIsRunningJob(true);
        const toastId = showLoading('Executando job mensal (verificação + e-mails)...');
        try {
            const result = await adminRunTicketInactivityMonthlyJob(
                !useAutoMonth && referenceMonth.trim() !== '' ? `${referenceMonth}-01` : undefined,
            );
            dismissToast(toastId);
            const check = result.check ?? {};
            showSuccess(
                `Job concluído. Bloqueios: ${check.companies_blocked ?? 0}. ` +
                    `E-mails enviados: ${result.emails_sent ?? 0}. ` +
                    `Falhas: ${result.emails_failed ?? 0}.`,
            );
        } catch (e: unknown) {
            dismissToast(toastId);
            showError(e instanceof Error ? e.message : 'Erro ao executar job mensal.');
        } finally {
            setIsRunningJob(false);
        }
    };

    const handleRunAutoDeactivate = async () => {
        setIsRunningAutoDeactivate(true);
        const toastId = showLoading('Executando auto-desativação + e-mails...');
        try {
            const result = await adminRunTicketInactivityAutoDeactivateJob();
            dismissToast(toastId);
            const deactivate = result.deactivate ?? {};
            if (deactivate.skipped) {
                showSuccess('Auto-desativação desligada ou dias = 0.');
                return;
            }
            showSuccess(
                `Concluído. Eventos desativados: ${deactivate.events_deactivated ?? 0}. ` +
                    `E-mails: ${result.emails_sent ?? 0} (falhas: ${result.emails_failed ?? 0}).`,
            );
            void autoDeactivateLog.refetch();
        } catch (e: unknown) {
            dismissToast(toastId);
            showError(e instanceof Error ? e.message : 'Erro ao executar auto-desativação.');
        } finally {
            setIsRunningAutoDeactivate(false);
        }
    };

    const handleVerifyDeploy = async () => {
        setIsVerifyingDeploy(true);
        const toastId = showLoading('Verificando deploy anti-fraude...');
        try {
            const result = await verifyAntiFraudDeploy();
            dismissToast(toastId);
            const cron = (result.pg_cron ?? {}) as Record<string, unknown>;
            showSuccess(
                `Deploy OK. Cron mensal: ${cron.ticket_inactivity_monthly_check ? 'sim' : 'não'}. ` +
                    `Cron auto-desativar: ${cron.ticket_inactivity_auto_deactivate_daily ? 'sim' : 'não'}.`,
            );
        } catch (e: unknown) {
            dismissToast(toastId);
            showError(e instanceof Error ? e.message : 'Falha na verificação. Aplique as migrations.');
        } finally {
            setIsVerifyingDeploy(false);
        }
    };

    if (isLoading) {
        return (
            <div className="text-center py-12">
                <Loader2 className={`h-8 w-8 animate-spin ${billingSpinner} mx-auto`} />
            </div>
        );
    }

    return (
        <Card className={`bg-black/40 border ${billingPanelBorder} mb-6`}>
            <CardHeader>
                <CardTitle className={`${billingAccentText} text-lg`}>
                    Inatividade de venda de ingressos
                </CardTitle>
                <CardDescription className="text-gray-400">
                    Planos % ingressos e % ingresso + consumo: bloqueia criar/reativar eventos quando há evento
                    realizado no mês sem venda de ingressos. Taxa fixa após 2 meses consecutivos de inatividade.
                    Cron automático no dia 5 (pg_cron) ou job completo abaixo. Auto-desativa vitrine após X dias da
                    data do evento (somente planos com venda de ingressos).
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="flex items-start gap-3">
                    <Checkbox
                        id="ticket-inactivity-enabled"
                        checked={inactivityEnabled}
                        onCheckedChange={(v) => setInactivityEnabled(v === true)}
                        className="border-cyan-500 data-[state=checked]:bg-cyan-400 data-[state=checked]:text-black"
                    />
                    <label htmlFor="ticket-inactivity-enabled" className="text-sm text-gray-300 leading-snug">
                        Ativar verificação mensal automática (executar via botão ou cron no dia 5)
                    </label>
                </div>
                <div className="max-w-xs">
                    <Label className="text-gray-300">Taxa fixa global (após 2 meses consecutivos — R$ 0 desativa)</Label>
                    <Input
                        type="text"
                        inputMode="decimal"
                        value={feeDefault}
                        onChange={(e) => setFeeDefault(e.target.value)}
                        className={`mt-2 ${billingInput}`}
                    />
                </div>

                <div className="pt-2 border-t border-cyan-500/10 space-y-3">
                    <p className="text-sm text-gray-400 font-medium">Auto-desativar vitrine (evento sem venda)</p>
                    <div className="flex items-start gap-3">
                        <Checkbox
                            id="ticket-inactivity-auto-deactivate-enabled"
                            checked={autoDeactivateEnabled}
                            onCheckedChange={(v) => setAutoDeactivateEnabled(v === true)}
                            className="border-cyan-500 data-[state=checked]:bg-cyan-400 data-[state=checked]:text-black"
                        />
                        <label
                            htmlFor="ticket-inactivity-auto-deactivate-enabled"
                            className="text-sm text-gray-300 leading-snug"
                        >
                            Ativar desativação automática de eventos ativos sem venda após a data do evento
                        </label>
                    </div>
                    <div className="max-w-xs">
                        <Label className="text-gray-300">Dias após a data do evento (0 = desligado)</Label>
                        <Input
                            type="number"
                            min={0}
                            max={365}
                            value={autoDeactivateDays}
                            onChange={(e) => setAutoDeactivateDays(e.target.value)}
                            className={`mt-2 ${billingInput}`}
                        />
                    </div>
                </div>

                <Button type="button" onClick={() => void handleSaveSettings()} disabled={isSaving} className={billingBtnSolid}>
                    {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
                    Salvar regras
                </Button>

                <div className="pt-4 border-t border-cyan-500/20 space-y-3">
                    <Label className="text-gray-300">Executar verificação manual</Label>
                    <div className="flex items-start gap-3">
                        <Checkbox
                            id="ticket-inactivity-auto-month"
                            checked={useAutoMonth}
                            onCheckedChange={(v) => {
                                const auto = v === true;
                                setUseAutoMonth(auto);
                                if (auto) setReferenceMonth('');
                            }}
                            className="border-cyan-500 data-[state=checked]:bg-cyan-400 data-[state=checked]:text-black mt-0.5"
                        />
                        <label
                            htmlFor="ticket-inactivity-auto-month"
                            className="text-sm text-gray-300 leading-snug"
                        >
                            Usar mês calendário anterior (recomendado no dia 5 de cada mês)
                        </label>
                    </div>
                    {!useAutoMonth && (
                        <div className="flex flex-wrap items-center gap-2 max-w-md">
                            <Input
                                type="month"
                                value={referenceMonth}
                                onChange={(e) => setReferenceMonth(e.target.value)}
                                className={`flex-1 min-w-[200px] ${billingInput}`}
                            />
                            <Button
                                type="button"
                                className={billingBtnGhost}
                                onClick={() => {
                                    setReferenceMonth('');
                                    setUseAutoMonth(true);
                                }}
                            >
                                Voltar ao automático
                            </Button>
                        </div>
                    )}
                    <p className="text-xs text-gray-500">
                        Desmarque a opção acima apenas se quiser analisar um mês específico.
                    </p>
                    <div className="flex flex-wrap gap-2">
                        <Button
                            type="button"
                            className={billingBtnSolid}
                            disabled={isRunning}
                            onClick={() => void handleRunCheck()}
                        >
                            {isRunning ? (
                                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                            ) : (
                                <Play className="h-4 w-4 mr-2" />
                            )}
                            Rodar verificação agora
                        </Button>
                        <Button
                            type="button"
                            className={billingBtnGhost}
                            disabled={isRunningJob}
                            onClick={() => void handleRunMonthlyJob()}
                        >
                            {isRunningJob ? (
                                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                            ) : (
                                <Mail className="h-4 w-4 mr-2" />
                            )}
                            Job completo (verificação + e-mails)
                        </Button>
                        <Button
                            type="button"
                            className={billingBtnGhost}
                            disabled={isRunningAutoDeactivate}
                            onClick={() => void handleRunAutoDeactivate()}
                        >
                            {isRunningAutoDeactivate ? (
                                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                            ) : (
                                <Play className="h-4 w-4 mr-2" />
                            )}
                            Rodar auto-desativação agora
                        </Button>
                        <Button
                            type="button"
                            className={billingBtnGhost}
                            disabled={isVerifyingDeploy}
                            onClick={() => void handleVerifyDeploy()}
                        >
                            {isVerifyingDeploy ? (
                                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                            ) : null}
                            Verificar deploy
                        </Button>
                    </div>
                </div>

                <div className="pt-4 border-t border-cyan-500/20 space-y-3">
                    <Label className="text-gray-300">Últimas auto-desativações de vitrine</Label>
                    {autoDeactivateLog.isLoading ? (
                        <Loader2 className={`h-5 w-5 animate-spin ${billingSpinner}`} />
                    ) : autoDeactivateLog.isError ? (
                        <p className="text-xs text-gray-500">
                            Log indisponível (aplique a migration mais recente no Supabase).
                        </p>
                    ) : !autoDeactivateLog.data?.length ? (
                        <p className="text-xs text-gray-500">Nenhum evento desativado automaticamente ainda.</p>
                    ) : (
                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow className="border-cyan-500/20">
                                        <TableHead className={billingTableHead}>Data</TableHead>
                                        <TableHead className={billingTableHead}>Evento</TableHead>
                                        <TableHead className={billingTableHead}>Empresa</TableHead>
                                        <TableHead className={billingTableHead}>Data evento</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {autoDeactivateLog.data.map((row) => (
                                        <TableRow key={row.id} className="border-cyan-500/10">
                                            <TableCell className="text-gray-400 text-xs whitespace-nowrap">
                                                {format(new Date(row.created_at), 'dd/MM/yy HH:mm', { locale: ptBR })}
                                            </TableCell>
                                            <TableCell className="text-gray-300 text-sm">{row.event_title}</TableCell>
                                            <TableCell className="text-gray-400 text-xs">
                                                {row.company_name ?? '—'}
                                            </TableCell>
                                            <TableCell className="text-gray-400 text-xs whitespace-nowrap">
                                                {row.event_date
                                                    ? format(new Date(`${row.event_date}T12:00:00`), 'dd/MM/yyyy', {
                                                          locale: ptBR,
                                                      })
                                                    : '—'}
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    )}
                </div>
            </CardContent>
        </Card>
    );
};

export default TicketInactivityAdminSection;
