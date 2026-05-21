import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2, Save } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { showError, showSuccess, showLoading, dismissToast } from '@/utils/toast';
import { billingBtnSolid, billingInput, billingPanelBorder } from '@/constants/billing-ui';

type PlanKind = 'hybrid' | 'consumption';

interface FuturePlanSettingsSectionProps {
    kind: PlanKind;
    enabled: boolean;
}

const COPY: Record<
    PlanKind,
    { title: string; description: string; notesColumn: string; flagColumn: string; flagLabel: string }
> = {
    hybrid: {
        title: 'Plano híbrido (ingresso + consumo)',
        description:
            'Parâmetros reservados para quando o módulo de consumo interno estiver ativo. Ingressos seguem as faixas de comissão.',
        notesColumn: 'hybrid_plan_notes',
        flagColumn: 'hybrid_consumption_module_enabled',
        flagLabel: 'Liberar módulo de consumo no plano híbrido (piloto)',
    },
    consumption: {
        title: 'Plano consumo / licença',
        description:
            'Eventos em modo divulgação até o módulo de créditos/consumo. Atribuição do plano apenas pelo Admin Master.',
        notesColumn: 'consumption_plan_notes',
        flagColumn: 'consumption_module_enabled',
        flagLabel: 'Liberar módulo de consumo / créditos (piloto)',
    },
};

const FuturePlanSettingsSection: React.FC<FuturePlanSettingsSectionProps> = ({ kind, enabled }) => {
    const meta = COPY[kind];
    const [notes, setNotes] = useState('');
    const [moduleFlag, setModuleFlag] = useState(false);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!enabled) return;
        let cancelled = false;
        (async () => {
            setLoading(true);
            const { data, error } = await supabase
                .from('system_billing_settings')
                .select(`${meta.notesColumn}, ${meta.flagColumn}`)
                .eq('id', 1)
                .maybeSingle();

            if (!cancelled) {
                if (error && !error.message?.includes('does not exist')) {
                    showError(error.message);
                } else if (data) {
                    const row = data as Record<string, unknown>;
                    setNotes(String(row[meta.notesColumn] ?? ''));
                    setModuleFlag(row[meta.flagColumn] === true);
                }
                setLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [enabled, meta.notesColumn, meta.flagColumn]);

    const handleSave = async () => {
        setSaving(true);
        const toastId = showLoading('Salvando...');
        try {
            const { data: { user } } = await supabase.auth.getUser();
            const patch: Record<string, unknown> = {
                id: 1,
                updated_at: new Date().toISOString(),
                updated_by: user?.id ?? null,
                [meta.notesColumn]: notes.trim() || null,
                [meta.flagColumn]: moduleFlag,
            };
            const { error } = await supabase.from('system_billing_settings').upsert(patch, {
                onConflict: 'id',
            });
            if (error) throw error;
            dismissToast(toastId);
            showSuccess('Configurações salvas.');
        } catch (e: unknown) {
            dismissToast(toastId);
            showError(e instanceof Error ? e.message : 'Erro ao salvar.');
        } finally {
            setSaving(false);
        }
    };

    if (!enabled) return null;

    return (
        <Card className={`bg-black/40 ${billingPanelBorder}`}>
            <CardHeader>
                <CardTitle className="text-cyan-400 text-lg">{meta.title}</CardTitle>
                <CardDescription className="text-gray-400">{meta.description}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                {loading ? (
                    <Loader2 className="h-6 w-6 animate-spin text-cyan-400" />
                ) : (
                    <>
                        <div className="space-y-2">
                            <Label className="text-gray-300">Observações internas (admin)</Label>
                            <Textarea
                                value={notes}
                                onChange={(e) => setNotes(e.target.value)}
                                className={`${billingInput} min-h-[100px]`}
                                placeholder="Notas sobre precificação futura, regras comerciais, etc."
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
                        <p className="text-xs text-amber-400/90">
                            Enquanto o módulo estiver desligado, o plano segue as regras de segurança já
                            aplicadas no banco (sem venda de ingressos no plano consumo/licença).
                        </p>
                        <Button
                            type="button"
                            onClick={handleSave}
                            disabled={saving}
                            className={billingBtnSolid}
                        >
                            {saving ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                                <>
                                    <Save className="h-4 w-4 mr-2" />
                                    Salvar
                                </>
                            )}
                        </Button>
                    </>
                )}
            </CardContent>
        </Card>
    );
};

export default FuturePlanSettingsSection;
