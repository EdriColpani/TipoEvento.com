import React from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Card, CardContent } from '@/components/ui/card';
import { SETTLEMENT_POLICY_SHORT } from '@/utils/settlement-funding-labels';
import type { SettlementFundingTotals } from '@/utils/settlement-funding-totals';
import { awaitingTotal, retentionTotal } from '@/utils/settlement-funding-totals';

function money(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

type Audience = 'manager' | 'admin';

type SettlementFundingClarityBoardProps = {
  totals: SettlementFundingTotals;
  audience: Audience;
  /** Já recebidos / já pagos (opcional, rodapé). */
  paidTotal?: number;
  clawbackTotal?: number;
  loading?: boolean;
};

/**
 * Painel visual: o que já pode ser liquidado (released) vs o que ainda
 * está em retenção, separado em PIX/débito (D+1) e cartão (D+30).
 */
export function SettlementFundingClarityBoard({
  totals,
  audience,
  paidTotal,
  clawbackTotal,
  loading,
}: SettlementFundingClarityBoardProps) {
  const nowLabel =
    audience === 'admin'
      ? 'Repassar agora (TED/PIX EventFest → gestor)'
      : 'Liberado para receber (EventFest → você)';
  const holdLabel =
    audience === 'admin'
      ? 'Ainda não repassar (em retenção)'
      : 'Ainda em retenção (ainda não disponível)';

  const nowTotal = awaitingTotal(totals);
  const holdTotal = retentionTotal(totals);

  return (
    <div className="space-y-4 mb-6">
      <Alert className="border-cyan-500/30 bg-cyan-950/40">
        <AlertTitle className="text-cyan-100 text-sm font-medium">
          Como ler os valores — {SETTLEMENT_POLICY_SHORT}
        </AlertTitle>
        <AlertDescription className="text-cyan-50/90 text-sm space-y-1">
          <p>
            <strong className="text-white">PIX e débito</strong> liberam em{' '}
            <strong className="text-white">D+1</strong>.{' '}
            <strong className="text-white">Cartão de crédito</strong> libera na data do Mercado Pago
            ou em <strong className="text-white">D+30</strong>.
          </p>
          <p>
            Só o bloco <strong className="text-yellow-400">“agora”</strong> entra na fila de
            TED/PIX. O bloco <strong className="text-amber-300">“retenção”</strong> ainda não deve
            ser pago.
          </p>
        </AlertDescription>
      </Alert>

      <div>
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
          <h2 className="text-yellow-500 text-sm font-semibold uppercase tracking-wide">{nowLabel}</h2>
          <p className="text-yellow-400 text-lg font-semibold">
            Total: {loading ? '…' : money(nowTotal)}
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <BucketCard
            title="PIX / débito (D+1)"
            subtitle="Já passou a data de liberação"
            value={loading ? '…' : money(totals.awaitingFast)}
            tone="now"
            emphasize={totals.awaitingFast > 0}
          />
          <BucketCard
            title="Cartão de crédito (D+30 / data MP)"
            subtitle="Já liberado pelo prazo do cartão"
            value={loading ? '…' : money(totals.awaitingCard)}
            tone="now"
            emphasize={totals.awaitingCard > 0}
          />
        </div>
      </div>

      <div>
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
          <h2 className="text-amber-300/90 text-sm font-semibold uppercase tracking-wide">{holdLabel}</h2>
          <p className="text-amber-200 text-lg font-semibold">
            Total: {loading ? '…' : money(holdTotal)}
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <BucketCard
            title="PIX / débito — aguardando D+1"
            subtitle="Ainda não venceu a data de liberação"
            value={loading ? '…' : money(totals.retentionFast)}
            tone="hold"
          />
          <BucketCard
            title="Cartão — aguardando D+30 / data MP"
            subtitle="Não liquidar até esta data"
            value={loading ? '…' : money(totals.retentionCard)}
            tone="hold"
          />
        </div>
      </div>

      {(paidTotal !== undefined || clawbackTotal !== undefined) && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {paidTotal !== undefined && (
            <MiniStat
              label={audience === 'admin' ? 'Já pagos aos gestores' : 'Já recebidos'}
              value={loading ? '…' : money(paidTotal)}
            />
          )}
          {clawbackTotal !== undefined && clawbackTotal > 0 && (
            <MiniStat label="Clawback" value={loading ? '…' : money(clawbackTotal)} />
          )}
          <MiniStat
            label="PIX/débito já liquidados"
            value={loading ? '…' : money(totals.paidFast)}
          />
          <MiniStat
            label="Cartão já liquidado"
            value={loading ? '…' : money(totals.paidCard)}
          />
        </div>
      )}
    </div>
  );
}

function BucketCard({
  title,
  subtitle,
  value,
  tone,
  emphasize,
}: {
  title: string;
  subtitle: string;
  value: string;
  tone: 'now' | 'hold';
  emphasize?: boolean;
}) {
  const border =
    tone === 'now'
      ? emphasize
        ? 'border-yellow-500/70 bg-yellow-500/10'
        : 'border-yellow-500/30 bg-black'
      : 'border-amber-500/30 bg-amber-950/30';
  const valueColor = tone === 'now' ? 'text-yellow-400' : 'text-amber-200';

  return (
    <Card className={`border ${border}`}>
      <CardContent className="pt-4 pb-4">
        <p className="text-white text-sm font-medium">{title}</p>
        <p className="text-gray-500 text-xs mt-0.5">{subtitle}</p>
        <p className={`text-2xl font-semibold mt-2 ${valueColor}`}>{value}</p>
      </CardContent>
    </Card>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <Card className="bg-black border-yellow-500/20">
      <CardContent className="pt-3 pb-3">
        <p className="text-gray-500 text-xs">{label}</p>
        <p className="text-white text-sm font-semibold mt-1">{value}</p>
      </CardContent>
    </Card>
  );
}
