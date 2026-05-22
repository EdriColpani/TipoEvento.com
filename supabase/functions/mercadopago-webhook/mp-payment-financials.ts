/** Valores financeiros alinhados ao extrato MP (gestor = net_received, plataforma = marketplace_fee). */

export function toAmount(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export type MpPaymentFinancials = {
  grossAmount: number | null;
  /** Taxa de processamento Mercado Pago (não inclui comissão marketplace). */
  mpFeeAmount: number | null;
  /** Comissão EventFest (marketplace / application_fee). */
  platformFeeAmount: number | null;
  /** Valor creditado na conta do gestor (transaction_details.net_received_amount). */
  collectorNetAmount: number | null;
};

function isPlatformFeeType(type: string): boolean {
  return (
    type.includes('application') ||
    type.includes('marketplace') ||
    type.includes('collector_fee')
  );
}

export function extractMpPaymentFinancials(mpPaymentData: Record<string, unknown>): MpPaymentFinancials {
  const grossAmount = toAmount(mpPaymentData.transaction_amount);
  const transactionDetails = mpPaymentData.transaction_details as Record<string, unknown> | undefined;
  const collectorNet = toAmount(transactionDetails?.net_received_amount);

  let platformFee =
    toAmount(mpPaymentData.marketplace_fee) ??
    toAmount(mpPaymentData.application_fee);

  const feeDetails = Array.isArray(mpPaymentData.fee_details) ? mpPaymentData.fee_details : [];
  let mpFeeFromDetails = 0;
  let platformFromDetails = 0;

  for (const raw of feeDetails) {
    const fee = raw as Record<string, unknown>;
    const amt = toAmount(fee?.amount) ?? 0;
    const type = String(fee?.type ?? '').toLowerCase();
    if (isPlatformFeeType(type)) {
      platformFromDetails += amt;
    } else {
      mpFeeFromDetails += amt;
    }
  }

  if ((platformFee === null || platformFee === 0) && platformFromDetails > 0) {
    platformFee = roundMoney(platformFromDetails);
  }

  let mpFeeAmount: number | null = mpFeeFromDetails > 0 ? roundMoney(mpFeeFromDetails) : null;

  if (
    grossAmount !== null &&
    collectorNet !== null &&
    platformFee !== null &&
    (mpFeeAmount === null || mpFeeAmount === 0)
  ) {
    const derived = grossAmount - collectorNet - platformFee;
    if (derived >= 0) mpFeeAmount = roundMoney(derived);
  }

  if (platformFee === null && grossAmount !== null && collectorNet !== null) {
    const residual = grossAmount - collectorNet - (mpFeeAmount ?? 0);
    if (residual > 0.001) platformFee = roundMoney(residual);
  }

  if (mpFeeAmount === null && grossAmount !== null && collectorNet !== null) {
    const derived = grossAmount - collectorNet - (platformFee ?? 0);
    if (derived >= 0) mpFeeAmount = roundMoney(derived);
  }

  return {
    grossAmount,
    mpFeeAmount,
    platformFeeAmount: platformFee !== null ? roundMoney(platformFee) : null,
    collectorNetAmount: collectorNet,
  };
}

export function resolveSplitAmounts(params: {
  grossFallback: number;
  appliedPercentage: number;
  financials: MpPaymentFinancials;
}): {
  grossSaleAmount: number;
  mpFeeAmount: number;
  platformAmount: number;
  managerAmount: number;
  collectorNetAmount: number | null;
} {
  const grossSaleAmount = params.financials.grossAmount ?? params.grossFallback;
  const collectorNet = params.financials.collectorNetAmount;

  const platformAmount =
    params.financials.platformFeeAmount !== null && params.financials.platformFeeAmount >= 0
      ? params.financials.platformFeeAmount
      : roundMoney(grossSaleAmount * (params.appliedPercentage / 100));

  const mpFeeAmount =
    params.financials.mpFeeAmount !== null && params.financials.mpFeeAmount >= 0
      ? params.financials.mpFeeAmount
      : Math.max(
          roundMoney(grossSaleAmount - (collectorNet ?? 0) - platformAmount),
          0,
        );

  /** Igual ao extrato do gestor: net_received (ex.: R$ 0,89). Não descontar comissão de novo. */
  const managerAmount =
    collectorNet !== null && collectorNet >= 0
      ? roundMoney(collectorNet)
      : Math.max(roundMoney(grossSaleAmount - mpFeeAmount - platformAmount), 0);

  return {
    grossSaleAmount: roundMoney(grossSaleAmount),
    mpFeeAmount,
    platformAmount,
    managerAmount,
    collectorNetAmount: collectorNet,
  };
}
