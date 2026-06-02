import React from 'react';
import type { PublicCommissionRange } from '@/utils/billing-plan-catalog';
import { formatCommissionRangesDetail } from '@/utils/billing-plan-catalog';
import { billingTableHead } from '@/constants/billing-ui';

interface BillingPlanCommissionTiersTableProps {
    tiers: PublicCommissionRange[];
}

function formatMaxTickets(max: number): string {
    if (max >= 999999) return 'ou mais';
    return max.toLocaleString('pt-BR');
}

const BillingPlanCommissionTiersTable: React.FC<BillingPlanCommissionTiersTableProps> = ({ tiers }) => {
    if (!tiers.length) return null;

    const detailLines = formatCommissionRangesDetail(tiers);
    if (!detailLines.length) return null;

    return (
        <div className="overflow-x-auto rounded-lg border border-cyan-500/20">
            <table className="w-full text-sm">
                <thead>
                    <tr className="border-b border-cyan-500/20 bg-cyan-500/5">
                        <th className={`text-left px-3 py-2 font-medium ${billingTableHead}`}>Ingressos vendidos</th>
                        <th className={`text-right px-3 py-2 font-medium ${billingTableHead}`}>Comissão EventFest</th>
                    </tr>
                </thead>
                <tbody>
                    {tiers.map((tier) => (
                        <tr key={`${tier.min_tickets}-${tier.max_tickets}`} className="border-b border-white/5 last:border-0">
                            <td className="px-3 py-2 text-gray-300">
                                {tier.min_tickets.toLocaleString('pt-BR')} — {formatMaxTickets(tier.max_tickets)}
                            </td>
                            <td className="px-3 py-2 text-right text-cyan-300 font-medium">
                                {Number(tier.percentage).toFixed(2).replace('.', ',')}%
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
            <p className="text-[11px] text-gray-500 px-3 py-2 border-t border-cyan-500/10">
                Mesmas faixas cadastradas em Admin → Preços e comissões → Cobrança de ingressos.
            </p>
        </div>
    );
};

export default BillingPlanCommissionTiersTable;
