import React from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, CreditCard } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { MANAGER_CONSUMPTION_LICENSE_PATH } from '@/constants/consumption-license';
import type { ConsumptionLicenseStatus } from '@/hooks/use-consumption-license-status';

interface ConsumptionLicenseBannerProps {
    status: ConsumptionLicenseStatus;
}

const ConsumptionLicenseBanner: React.FC<ConsumptionLicenseBannerProps> = ({ status }) => {
    const navigate = useNavigate();

    if (!status.requires_license || !status.blocks_consumption) return null;

    const amountLabel =
        status.amount != null
            ? ` (R$ ${Number(status.amount).toFixed(2).replace('.', ',')})`
            : '';

    return (
        <div className="border-b px-4 py-3 bg-amber-950/60 border-amber-500/40">
            <div className="max-w-7xl mx-auto flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
                <div className="flex items-start gap-2 min-w-0">
                    <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5 text-amber-400" />
                    <div className="min-w-0">
                        <p className="text-sm font-semibold text-white">Licença mensal pendente</p>
                        <p className="text-xs text-gray-300 mt-1">
                            Pague a licença do plano consumo/licença para liberar o módulo de créditos
                            EventFest{amountLabel}. Relatórios e esta página de pagamento continuam
                            disponíveis.
                        </p>
                    </div>
                </div>
                <Button
                    type="button"
                    size="sm"
                    className="shrink-0 bg-cyan-400 text-black hover:bg-cyan-300"
                    onClick={() => navigate(MANAGER_CONSUMPTION_LICENSE_PATH)}
                >
                    <CreditCard className="h-4 w-4 mr-2" />
                    Pagar licença
                </Button>
            </div>
        </div>
    );
};

export default ConsumptionLicenseBanner;
