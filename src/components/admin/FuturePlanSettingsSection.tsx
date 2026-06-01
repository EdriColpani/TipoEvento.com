import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2, Save } from 'lucide-react';
import {
    saveConsumptionLicensePlanSettings,
    saveHybridPlanSettings,
    useSystemBillingSettings,
} from '@/hooks/use-system-billing-settings';
import { showError, showSuccess, showLoading, dismissToast } from '@/utils/toast';
import { billingBtnSolid, billingInput, billingPanelBorder } from '@/constants/billing-ui';
import {
    formatCurrencyBrInput,
    isValidCurrencyBr,
    parseCurrencyBr,
    sanitizeCurrencyBrInput,
} from '@/utils/currency-input';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

type PlanKind = 'hybrid' | 'consumption';

interface FuturePlanSettingsSectionProps {
    kind: PlanKind;
    enabled: boolean;
}

const COPY: Record<
    PlanKind,
    { title: string; description: string; commissionHelp: string; flagLabel: string }
> = {
    hybrid: {
        title: 'Plano híbrido (ingresso + consumo)',
        description:
            'Comissão sobre consumo de créditos EventFest no plano híbrido. Ingressos continuam pelas faixas de comissão. Licença mensal não se aplica (Opção A).',
        commissionHelp:
            '% cobrado sobre cada consumo de crédito (PDV, cardápio) em empresas no plano ingresso + consumo.',
        flagLabel: 'Liberar módulo de consumo no plano híbrido (piloto)',
    },
    consumption: {
        title: 'Plano consumo / licença',
        description:
            'Licença mensal de uso do sistema + comissão sobre consumo de créditos. Consumo bloqueado até a licença do mês estar paga.',
        commissionHelp:
            '% cobrado sobre cada consumo de crédito em empresas no plano consumo/licença.',
        flagLabel: 'Liberar módulo de consumo / créditos (piloto)',
    },
};

function parseCommissionInput(raw: string): number | null {
    const normalized = raw.replace(',', '.').trim();
    if (!normalized) return null;
    const value = Number(normalized);
    if (!Number.isFinite(value) || value < 0 || value > 100) return null;
    return Math.round(value * 100) / 100;
}

const FuturePlanSettingsSection: React.FC<FuturePlanSettingsSectionProps> = ({ kind, enabled }) => {
    const meta = COPY[kind];
    const { settings, isLoading, invalidate } = useSystemBillingSettings(enabled);

    const [commissionPct, setCommissionPct] = useState('8');
    const [licenseFee, setLicenseFee] = useState('99,99');
    const [notes, setNotes] = useState('');
    const [moduleFlag, setModuleFlag] = useState(false);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!settings) return;
        if (kind === 'hybrid') {
            setCommissionPct(String(settings.hybrid_consumption_commission_pct).replace('.', ','));
            setNotes(settings.hybrid_plan_notes ?? '');
            setModuleFlag(settings.hybrid_consumption_module_enabled);
        } else {
            setCommissionPct(String(settings.consumption_license_commission_pct).replace('.', ','));
            setLicenseFee(formatCurrencyBrInput(settings.consumption_license_default_fee));
            setNotes(settings.consumption_plan_notes ?? '');
            setModuleFlag(settings.consumption_module_enabled);
        }
    }, [settings, kind]);

    const handleSave = async () => {
        const pct = parseCommissionInput(commissionPct);
        if (pct === null) {
            showError('Informe um percentual válido entre 0 e 100.');
            return;
        }

        if (kind === 'consumption') {
            if (!isValidCurrencyBr(licenseFee)) {
                showError('Informe um valor de licença válido (ex.: 99,99).');
                return;
            }
        }

        setSaving(true);
        const toastId = showLoading('Salvando...');
        try {
            if (kind === 'hybrid') {
                await saveHybridPlanSettings({
                    commissionPct: pct,
                    notes: notes.trim() || null,
                    moduleEnabled: moduleFlag,
                });
            } else {
                await saveConsumptionLicensePlanSettings({
                    commissionPct: pct,
                    licenseFee: parseCurrencyBr(licenseFee),
                    notes: notes.trim() || null,
                    moduleEnabled: moduleFlag,
                });
            }
            dismissToast(toastId);
            showSuccess('Configurações salvas.');
            invalidate();
        } catch (e: unknown) {
            dismissToast(toastId);
            showError(e instanceof Error ? e.message : 'Erro ao salvar.');
        } finally {
            setSaving(false);
        }
    };

    if (!enabled) return null;

    if (isLoading) {
        return (
            <div className="py-8 text-center">
                <Loader2 className="h-8 w-8 animate-spin text-cyan-400 mx-auto" />
            </div>
        );
    }

    return (
        <Card className={`bg-black/40 ${billingPanelBorder}`}>
            <CardHeader>
                <CardTitle className="text-cyan-400 text-lg">{meta.title}</CardTitle>
                <CardDescription className="text-gray-400">{meta.description}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 max-w-lg">
                <div className="space-y-2">
                    <Label className="text-gray-300">% EventFest sobre consumo de créditos</Label>
                    <Input
                        type="text"
                        inputMode="decimal"
                        value={commissionPct}
                        onChange={(e) => setCommissionPct(e.target.value.replace(/[^\d,.]/g, ''))}
                        className={billingInput}
                        placeholder="8,00"
                    />
                    <p className="text-xs text-gray-500">{meta.commissionHelp}</p>
                </div>

                {kind === 'consumption' && (
                    <div className="space-y-2">
                        <Label className="text-gray-300">Licença mensal padrão (R$)</Label>
                        <Input
                            type="text"
                            inputMode="decimal"
                            value={licenseFee}
                            onChange={(e) => setLicenseFee(sanitizeCurrencyBrInput(e.target.value))}
                            className={billingInput}
                            placeholder="99,99"
                        />
                        <p className="text-xs text-gray-500">
                            Cobrança integral no upgrade ou confirmação do plano consumo/licença. Override por
                            empresa em Planos das Empresas.{' '}
                            <Link
                                to="/admin/settings/monthly-invoices?tab=license"
                                className="text-cyan-400 underline hover:text-cyan-300"
                            >
                                Ver faturas de licença
                            </Link>
                            .
                        </p>
                    </div>
                )}

                <div className="space-y-2">
                    <Label className="text-gray-300">Observações internas (admin)</Label>
                    <Textarea
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        className={`${billingInput} min-h-[80px]`}
                        placeholder="Notas comerciais ou operacionais"
                    />
                </div>

                <label className="flex items-start gap-3 cursor-pointer">
                    <Checkbox
                        checked={moduleFlag}
                        onCheckedChange={(v) => setModuleFlag(v === true)}
                        className="mt-1 border-cyan-500/50 data-[state=checked]:bg-cyan-400 data-[state=checked]:text-black"
                    />
                    <span className="text-sm text-gray-300">{meta.flagLabel}</span>
                </label>

                {settings?.updated_at && (
                    <p className="text-xs text-gray-500">
                        Última alteração:{' '}
                        {format(new Date(settings.updated_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
                    </p>
                )}

                <Button type="button" onClick={handleSave} disabled={saving} className={billingBtnSolid}>
                    {saving ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                        <>
                            <Save className="h-4 w-4 mr-2" />
                            Salvar
                        </>
                    )}
                </Button>
            </CardContent>
        </Card>
    );
};

export default FuturePlanSettingsSection;
