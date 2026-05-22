import React from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, CreditCard } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ListingSubscriptionPhase } from '@/constants/listing-subscription';
import { MANAGER_LISTING_RENEWAL_PATH } from '@/constants/listing-subscription';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface ListingSubscriptionBannerProps {
    phase: ListingSubscriptionPhase;
    message: string | null;
    listingActiveUntil: string | null;
}

const ListingSubscriptionBanner: React.FC<ListingSubscriptionBannerProps> = ({
    phase,
    message,
    listingActiveUntil,
}) => {
    const navigate = useNavigate();

    if (phase === 'not_applicable' || phase === 'active') return null;

    const untilDate = listingActiveUntil ? new Date(listingActiveUntil) : null;
    const untilLabel =
        untilDate && !Number.isNaN(untilDate.getTime())
            ? format(untilDate, 'dd/MM/yyyy', { locale: ptBR })
            : null;

    const isPastDue = phase === 'past_due';
    const isDueToday = phase === 'due_today';

    return (
        <div
            className={`border-b px-4 py-3 ${
                isPastDue
                    ? 'bg-red-950/80 border-red-500/50'
                    : isDueToday
                      ? 'bg-orange-950/60 border-orange-500/40'
                      : 'bg-amber-950/50 border-amber-500/40'
            }`}
        >
            <div className="max-w-7xl mx-auto flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
                <div className="flex items-start gap-2 min-w-0">
                    <AlertTriangle
                        className={`h-5 w-5 shrink-0 mt-0.5 ${
                            isPastDue ? 'text-red-400' : 'text-amber-400'
                        }`}
                    />
                    <div className="min-w-0">
                        <p className="text-sm font-semibold text-white">
                            {isPastDue
                                ? 'Assinatura vencida — painel restrito'
                                : isDueToday
                                  ? 'Vencimento hoje'
                                  : 'Assinatura próxima do vencimento'}
                        </p>
                        <p className="text-xs text-gray-300 mt-1">
                            {message}
                            {untilLabel && (
                                <span className="block mt-1">
                                    Válido até: <strong>{untilLabel}</strong>
                                </span>
                            )}
                        </p>
                        {isPastDue && (
                            <p className="text-xs text-red-200/90 mt-1">
                                Chaves de validação foram desativadas. Relatórios e renovação continuam
                                disponíveis.
                            </p>
                        )}
                    </div>
                </div>
                <Button
                    type="button"
                    size="sm"
                    className="shrink-0 bg-yellow-500 text-black hover:bg-yellow-600"
                    onClick={() => navigate(MANAGER_LISTING_RENEWAL_PATH)}
                >
                    <CreditCard className="h-4 w-4 mr-2" />
                    Renovar assinatura
                </Button>
            </div>
        </div>
    );
};

export default ListingSubscriptionBanner;
