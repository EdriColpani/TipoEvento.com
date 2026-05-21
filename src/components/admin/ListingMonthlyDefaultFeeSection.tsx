import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Save } from 'lucide-react';
import { Link } from 'react-router-dom';
import {
    saveListingMonthlyDefaultFee,
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
import {
    formatCurrencyBrInput,
    isValidCurrencyBr,
    parseCurrencyBr,
    sanitizeCurrencyBrInput,
} from '@/utils/currency-input';

interface ListingMonthlyDefaultFeeSectionProps {
    enabled: boolean;
}

const ListingMonthlyDefaultFeeSection: React.FC<ListingMonthlyDefaultFeeSectionProps> = ({ enabled }) => {
    const { settings, isLoading, invalidate } = useSystemBillingSettings(enabled);
    const [fee, setFee] = useState('');
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        if (settings) {
            setFee(formatCurrencyBrInput(settings.listing_monthly_default_fee));
        }
    }, [settings]);

    const handleSave = async () => {
        if (!isValidCurrencyBr(fee)) {
            showError('Informe um valor válido (ex.: 299,99).');
            return;
        }
        const value = parseCurrencyBr(fee);

        setIsSaving(true);
        const toastId = showLoading('Salvando mensalidade padrão...');
        try {
            await saveListingMonthlyDefaultFee(value);
            dismissToast(toastId);
            showSuccess('Mensalidade padrão atualizada.');
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
        <Card className={`bg-black/40 border ${billingPanelBorder}`}>
            <CardHeader>
                <CardTitle className={`${billingAccentText} text-lg`}>Divulgação (mensalidade)</CardTitle>
                <CardDescription className="text-gray-400">
                    Plano <strong className="text-white">mensalidade — só divulgação</strong>. Valor padrão usado ao
                    gerar faturas quando a empresa não tiver valor próprio em{' '}
                    <Link to="/admin/settings/companies-billing" className="text-cyan-400 underline hover:text-cyan-300">
                        Planos das Empresas
                    </Link>
                    .
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 max-w-md">
                <div className="space-y-2">
                    <Label className="text-white">Mensalidade padrão do sistema (R$)</Label>
                    <Input
                        type="text"
                        inputMode="decimal"
                        placeholder="0,00"
                        value={fee}
                        onChange={(e) => setFee(sanitizeCurrencyBrInput(e.target.value))}
                        className={billingInput}
                    />
                </div>
                {settings?.updated_at && (
                    <p className="text-xs text-gray-500">
                        Última alteração:{' '}
                        {format(new Date(settings.updated_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
                    </p>
                )}
                <Button
                    onClick={handleSave}
                    disabled={isSaving}
                    className={billingBtnSolid}
                >
                    {isSaving ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    ) : (
                        <Save className="h-4 w-4 mr-2" />
                    )}
                    Salvar mensalidade padrão
                </Button>
                <p className="text-xs text-gray-500">
                    Para lançar cobranças por mês, use o menu{' '}
                    <Link to="/admin/settings/monthly-invoices" className="text-cyan-400 underline hover:text-cyan-300">
                        Faturas mensais
                    </Link>
                    .
                </p>
            </CardContent>
        </Card>
    );
};

export default ListingMonthlyDefaultFeeSection;
