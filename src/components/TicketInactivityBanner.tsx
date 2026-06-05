import React from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import type { CompanyTicketInactivityStatus } from '@/hooks/use-company-ticket-inactivity';

interface TicketInactivityBannerProps {
    status: CompanyTicketInactivityStatus | undefined;
    isLoading?: boolean;
}

const TicketInactivityBanner: React.FC<TicketInactivityBannerProps> = ({ status, isLoading }) => {
    const navigate = useNavigate();

    if (isLoading || !status?.blocked) {
        return null;
    }

    const monthLabel = status.reference_month
        ? format(new Date(`${status.reference_month}T12:00:00`), 'MMMM yyyy', { locale: ptBR })
        : 'mês anterior';

    const activePending = status.pending_events.filter((e) => e.is_active);

    return (
        <Card className="mb-6 bg-orange-500/10 border border-orange-500/40">
            <CardContent className="pt-6 flex gap-3">
                <AlertTriangle className="h-6 w-6 text-orange-400 shrink-0 mt-0.5" />
                <div className="text-sm text-orange-100 space-y-2">
                    <p className="font-medium">Pendência de inatividade comercial</p>
                    <p className="text-orange-200/90">
                        Há evento(s) realizados em {monthLabel} sem venda de ingressos. Enquanto isso não for
                        resolvido, você não pode criar novos eventos nem reativar eventos na vitrine.
                    </p>
                    {activePending.length > 0 && (
                        <ul className="list-disc pl-5 text-orange-200/90 space-y-1">
                            {activePending.map((e) => (
                                <li key={e.event_id}>
                                    {e.event_title}
                                    {e.event_date
                                        ? ` (${format(new Date(`${e.event_date}T12:00:00`), 'dd/MM/yyyy')})`
                                        : ''}
                                </li>
                            ))}
                        </ul>
                    )}
                    <p className="text-orange-200/80 text-xs">
                        Para liberar: desative os eventos acima na lista de eventos. Se precisar de exceção,
                        contate o suporte EventFest.
                    </p>
                    <Button
                        type="button"
                        size="sm"
                        className="bg-orange-500 text-black hover:bg-orange-600"
                        onClick={() => navigate('/manager/events')}
                    >
                        Ir para Meus Eventos
                    </Button>
                </div>
            </CardContent>
        </Card>
    );
};

export default TicketInactivityBanner;
