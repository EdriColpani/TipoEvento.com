import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2, Save } from 'lucide-react';
import {
    saveMinEventTicketsDefault,
    useSystemBillingSettings,
} from '@/hooks/use-system-billing-settings';
import { showError, showSuccess, showLoading, dismissToast } from '@/utils/toast';
import {
    billingAccentText,
    billingBtnSolid,
    billingInput,
    billingPanelBorder,
    billingSpinner,
} from '@/constants/billing-ui';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { DEFAULT_MIN_EVENT_TICKETS } from '@/utils/company-billing-rules';

interface MinEventTicketsDefaultSectionProps {
    enabled: boolean;
}

const MinEventTicketsDefaultSection: React.FC<MinEventTicketsDefaultSectionProps> = ({ enabled }) => {
    const { settings, isLoading, invalidate } = useSystemBillingSettings(enabled);
    const [minTickets, setMinTickets] = useState(String(DEFAULT_MIN_EVENT_TICKETS));
    const [applyToCompanies, setApplyToCompanies] = useState(true);
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        if (settings) {
            setMinTickets(String(settings.min_event_tickets_default));
        }
    }, [settings]);

    const handleSave = async () => {
        const value = Number.parseInt(minTickets, 10);
        if (!Number.isFinite(value) || value < 1 || value > 100000) {
            showError('Informe um número inteiro entre 1 e 100.000.');
            return;
        }

        setIsSaving(true);
        const toastId = showLoading('Salvando mínimo de ingressos...');
        try {
            const result = await saveMinEventTicketsDefault(value, applyToCompanies);
            dismissToast(toastId);
            showSuccess(
                applyToCompanies
                    ? `Padrão atualizado para ${value}. ${result.companies_updated} empresa(s) não personalizada(s) foram atualizadas.`
                    : `Padrão global definido como ${value} ingressos.`,
            );
            invalidate();
        } catch (e: unknown) {
            dismissToast(toastId);
            showError(e instanceof Error ? e.message : 'Erro ao salvar.');
        } finally {
            setIsSaving(false);
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
                    Mínimo de ingressos por evento pago
                </CardTitle>
                <CardDescription className="text-gray-400">
                    Valor padrão para novas empresas e para empresas sem personalização. Planos{' '}
                    <strong className="text-white">% sobre ingressos</strong> e{' '}
                    <strong className="text-white">% ingresso + consumo</strong> exigem esse mínimo
                    nos lotes e nos ingressos ativos antes de ativar o evento.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="max-w-xs">
                    <Label className="text-gray-300">Quantidade mínima padrão</Label>
                    <Input
                        type="number"
                        min={1}
                        max={100000}
                        value={minTickets}
                        onChange={(e) => setMinTickets(e.target.value)}
                        className={`mt-2 ${billingInput}`}
                    />
                </div>
                <div className="flex items-start gap-3">
                    <Checkbox
                        id="apply-min-tickets-companies"
                        checked={applyToCompanies}
                        onCheckedChange={(v) => setApplyToCompanies(v === true)}
                        className="border-cyan-500 data-[state=checked]:bg-cyan-400 data-[state=checked]:text-black"
                    />
                    <label htmlFor="apply-min-tickets-companies" className="text-sm text-gray-300 leading-snug">
                        Atualizar também todas as empresas que{' '}
                        <strong className="text-white">não</strong> possuem valor personalizado
                    </label>
                </div>
                {settings?.updated_at && (
                    <p className="text-xs text-gray-500">
                        Última alteração:{' '}
                        {format(new Date(settings.updated_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
                    </p>
                )}
                <Button type="button" onClick={() => void handleSave()} disabled={isSaving} className={billingBtnSolid}>
                    {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
                    Salvar mínimo global
                </Button>
            </CardContent>
        </Card>
    );
};

export default MinEventTicketsDefaultSection;
