import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2, Mail, Play, Save } from 'lucide-react';
import { useSystemBillingSettings } from '@/hooks/use-system-billing-settings';
import {
    adminRunTicketInactivityCheck,
    adminRunTicketInactivityMonthlyJob,
} from '@/hooks/use-company-ticket-inactivity';
import { showError, showSuccess, showLoading, dismissToast } from '@/utils/toast';
import {
    billingAccentText,
    billingBtnGhost,
    billingBtnSolid,
    billingInput,
    billingPanelBorder,
    billingSpinner,
} from '@/constants/billing-ui';
import { supabase } from '@/integrations/supabase/client';

interface TicketInactivityAdminSectionProps {
    enabled: boolean;
}

const TicketInactivityAdminSection: React.FC<TicketInactivityAdminSectionProps> = ({ enabled }) => {
    const { settings, isLoading, invalidate } = useSystemBillingSettings(enabled);
    const [inactivityEnabled, setInactivityEnabled] = useState(true);
    const [feeDefault, setFeeDefault] = useState('0');
    const [useAutoMonth, setUseAutoMonth] = useState(true);
    const [referenceMonth, setReferenceMonth] = useState('');
    const [isSaving, setIsSaving] = useState(false);
    const [isRunning, setIsRunning] = useState(false);
    const [isRunningJob, setIsRunningJob] = useState(false);

    React.useEffect(() => {
        if (!settings) return;
        setInactivityEnabled(settings.ticket_inactivity_enabled ?? true);
        setFeeDefault(String(settings.ticket_inactivity_fee_default ?? 0));
    }, [settings]);

    const handleSaveSettings = async () => {
        const fee = Number.parseFloat(feeDefault.replace(',', '.'));
        if (!Number.isFinite(fee) || fee < 0) {
            showError('Informe um valor fixo válido (≥ 0).');
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
                    Cron automático no dia 5 (pg_cron) ou job completo abaixo.
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
                    </div>
                </div>
            </CardContent>
        </Card>
    );
};

export default TicketInactivityAdminSection;
