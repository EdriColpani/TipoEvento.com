import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Banknote, Percent, Ticket, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
    useAdminCreditFinancialPosition,
    useTicketManualSettlementTotals,
} from '@/hooks/use-credit-reports';
import { useSystemBillingSettings } from '@/hooks/use-system-billing-settings';

function money(v: number | null | undefined): string {
    return Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function pct(part: number, total: number): string {
    if (!total || total <= 0) return '0%';
    return `${((part / total) * 100).toLocaleString('pt-BR', {
        maximumFractionDigits: 1,
        minimumFractionDigits: 0,
    })}%`;
}

type CardProps = {
    icon: React.ReactNode;
    label: string;
    value: string;
    hint: string;
    onClick?: () => void;
};

const FinanceCard: React.FC<CardProps> = ({ icon, label, value, hint, onClick }) => (
    <button
        type="button"
        onClick={onClick}
        className="text-left bg-black border-2 border-yellow-500/70 rounded-2xl p-5 shadow-lg shadow-yellow-500/10 hover:shadow-yellow-500/25 hover:border-yellow-500 transition-all"
    >
        <div className="flex items-center justify-between mb-3">
            <div className="w-10 h-10 bg-yellow-500/20 rounded-xl flex items-center justify-center">
                {icon}
            </div>
            <span className="text-[10px] font-bold uppercase tracking-wide text-yellow-500">
                Gerencial
            </span>
        </div>
        <div className="text-xl sm:text-2xl font-bold text-white mb-1">{value}</div>
        <div className="text-sm text-gray-200">{label}</div>
        <p className="text-xs text-gray-500 mt-2 leading-snug">{hint}</p>
    </button>
);

type Props = {
    enabled: boolean;
};

const AdminDashboardFinanceCards: React.FC<Props> = ({ enabled }) => {
    const navigate = useNavigate();
    const position = useAdminCreditFinancialPosition(null, null);
    const settlements = useTicketManualSettlementTotals(enabled);
    const { settings, isLoading: loadingSettings } = useSystemBillingSettings(enabled);

    const client = Number(position.data?.client_credit?.liability_now ?? 0);
    const wallets = Number(position.data?.client_credit?.wallet_balances ?? 0);
    const mpEstimated = Number(position.data?.managerial_position?.estimated_mp_wallet_position ?? 0);
    const systemCash = Number(position.data?.managerial_position?.available_operational_cash ?? 0);
    const spendGross = Number(position.data?.platform_revenue?.spend_gross ?? 0);
    const consumeCommission = Number(
        position.data?.platform_billing?.consumption_commission?.revenue ??
            position.data?.platform_revenue?.platform_commission ??
            0,
    );
    const ticketCommission = Number(position.data?.platform_billing?.ticket_commission?.revenue ?? 0);
    const consolidated = Number(position.data?.platform_billing?.totals?.consolidated_revenue_net ?? 0);
    const d1Open =
        Number(settlements.data?.pending_retention ?? 0) +
        Number(settlements.data?.awaiting_payment ?? 0);
    const hybridPct = Number(settings?.hybrid_consumption_commission_pct ?? 0);
    const licensePct = Number(settings?.consumption_license_commission_pct ?? 0);
    const configuredSame = Math.abs(hybridPct - licensePct) < 0.001;
    const realizedPctLabel = pct(consumeCommission, spendGross);

    const openCredits = () =>
        navigate('/admin/settings/credit-reports', { state: { creditTab: 'position' } });

    return (
        <section className="mb-8">
            <div className="flex flex-wrap items-end justify-between gap-2 mb-4">
                <div>
                    <h2 className="text-lg font-semibold text-yellow-500">Posição financeira (conta EventFest)</h2>
                    <p className="text-xs text-gray-500 mt-1">
                        Estimativa pelo ledger — não é saldo ao vivo da API do Mercado Pago. Clique no card para o
                        detalhe.
                    </p>
                </div>
                <Button
                    type="button"
                    variant="outline"
                    className="bg-black/60 border border-yellow-500/30 text-yellow-500 hover:bg-yellow-500/10 hover:text-yellow-400"
                    onClick={openCredits}
                >
                    Abrir posição completa
                </Button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                <FinanceCard
                    icon={<Wallet className="h-5 w-5 text-yellow-500" />}
                    label="Posição estimada na conta MP"
                    value={position.isLoading ? '…' : money(mpEstimated)}
                    hint={`Cliente (carteiras): ${money(wallets || client)} · Sistema (caixa operacional): ${money(systemCash)}`}
                    onClick={openCredits}
                />
                <FinanceCard
                    icon={<Banknote className="h-5 w-5 text-yellow-500" />}
                    label="Do cliente vs % do sistema"
                    value={
                        position.isLoading
                            ? '…'
                            : `${pct(client, client + Math.max(systemCash, 0))} cliente`
                    }
                    hint={`Cliente ${money(client)} · EventFest ${money(Math.max(systemCash, 0))} (${pct(Math.max(systemCash, 0), client + Math.max(systemCash, 0))} do caixa crédito)`}
                    onClick={openCredits}
                />
                <FinanceCard
                    icon={<Percent className="h-5 w-5 text-yellow-500" />}
                    label="% vigente no consumo"
                    value={
                        loadingSettings
                            ? '…'
                            : configuredSame
                              ? `${hybridPct.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`
                              : `${hybridPct.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}% / ${licensePct.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`
                    }
                    hint={
                        configuredSame
                            ? `Cadastrado agora: ${hybridPct.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%. Nas vendas já feitas a média foi ${realizedPctLabel} (${money(consumeCommission)} de ${money(spendGross)}). Vale nas próximas vendas.`
                            : `Híbrido ${hybridPct.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}% · licença ${licensePct.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%. Histórico realizado: ${realizedPctLabel} (${money(consumeCommission)} / ${money(spendGross)}).`
                    }
                    onClick={() => navigate('/manager/settings/advanced')}
                />
                <FinanceCard
                    icon={<Ticket className="h-5 w-5 text-yellow-500" />}
                    label="Comissão ingressos + D+1"
                    value={position.isLoading ? '…' : money(ticketCommission)}
                    hint={`Receita consolidada (recorrente + comissões): ${money(consolidated)}. Ingressos D+1 ainda na fila: ${money(d1Open)}.`}
                    onClick={() => navigate('/manager/reports/financial')}
                />
            </div>
        </section>
    );
};

export default AdminDashboardFinanceCards;
