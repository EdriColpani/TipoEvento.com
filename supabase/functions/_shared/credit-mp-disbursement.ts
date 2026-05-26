import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { getPlatformMpAccessToken } from './mp-token-resolver.ts';
import { resolveReceiverCompanyMpCredentials } from './mp-manager-credentials.ts';

export type CreditSpendDisburseInput = {
  spendOrderId: string;
  receiverCompanyId: string;
  grossAmount: number;
  platformAmount: number;
  managerAmount: number;
  idempotencyKey: string;
  description?: string;
};

export type CreditMpDisburseResult = {
  mpTransferId: string;
  mpExternalReference: string;
  mode: 'advanced_payments' | 'simulated';
};

function roundMoney(v: number): number {
  return Math.round(v * 100) / 100;
}

function isSimulateMode(): boolean {
  return (Deno.env.get('CREDIT_MP_SIMULATE_DISBURSE') ?? '').trim() === 'true';
}

/**
 * Transfere manager_amount da conta EventFest (pool) para o gestor/parceiro receptor via MP.
 * Usa Advanced Payments (disbursements) com token da plataforma + collector_id OAuth do receptor.
 */
export async function executeCreditMpDisbursement(
  supabaseService: SupabaseClient,
  input: CreditSpendDisburseInput,
): Promise<CreditMpDisburseResult> {
  const managerAmount = roundMoney(input.managerAmount);
  if (managerAmount <= 0) {
    throw new Error('Valor líquido do gestor inválido para repasse.');
  }

  const mpRef = `credit_disburse:${input.spendOrderId}`;
  const idempotencyKey = `credit-disburse:${input.idempotencyKey || input.spendOrderId}`;

  if (isSimulateMode()) {
    console.warn('[credit-mp-disbursement] SIMULATE mode — no real MP transfer');
    return {
      mpTransferId: `SIM-${input.spendOrderId.slice(0, 8)}`,
      mpExternalReference: mpRef,
      mode: 'simulated',
    };
  }

  const receiver = await resolveReceiverCompanyMpCredentials(supabaseService, input.receiverCompanyId);
  if (!receiver?.collectorId) {
    throw new Error(
      'Empresa receptora sem Mercado Pago conectado. O gestor deve conectar OAuth em Perfil da Empresa → Ingressos MP.',
    );
  }

  const platformToken = await getPlatformMpAccessToken(supabaseService);
  const collectorId = Number(receiver.collectorId);
  if (!Number.isFinite(collectorId) || collectorId <= 0) {
    throw new Error('collector_id Mercado Pago inválido para a empresa receptora.');
  }

  const body = {
    external_reference: mpRef,
    description: input.description ?? `Repasse crédito EventFest — spend ${input.spendOrderId}`,
    disbursements: [
      {
        collector_id: collectorId,
        amount: managerAmount,
        external_reference: mpRef,
      },
    ],
  };

  const res = await fetch('https://api.mercadopago.com/v1/advanced_payments', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${platformToken}`,
      'Content-Type': 'application/json',
      'X-Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify(body),
  });

  const raw = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = raw ? JSON.parse(raw) : {};
  } catch {
    json = { message: raw };
  }

  if (!res.ok) {
    const msg =
      (json.message as string) ||
      (json.error as string) ||
      (Array.isArray(json.cause) && (json.cause as Array<{ description?: string }>)[0]?.description) ||
      `Mercado Pago recusou o repasse (${res.status}).`;
    console.error('[credit-mp-disbursement] MP error:', res.status, raw);
    throw new Error(msg);
  }

  const transferId = String(
    json.id ??
      (Array.isArray(json.disbursements) && (json.disbursements as Array<{ id?: unknown }>)[0]?.id) ??
      '',
  );

  if (!transferId) {
    throw new Error('Mercado Pago não retornou identificador do repasse.');
  }

  return {
    mpTransferId: transferId,
    mpExternalReference: mpRef,
    mode: 'advanced_payments',
  };
}

export type SpendRpcPayload = {
  ok?: boolean;
  duplicate?: boolean;
  spend_order_id?: string;
  receiver_company_id?: string;
  gross_amount?: number;
  platform_amount?: number;
  manager_amount?: number;
  balance?: number;
  public_description?: string;
};

export async function finalizeCreditSpendWithMpDisbursement(
  supabaseService: SupabaseClient,
  spendPayload: SpendRpcPayload,
  idempotencyKey: string,
  description?: string,
): Promise<SpendRpcPayload & { mpTransferId?: string; mpExternalReference?: string }> {
  if (!spendPayload?.ok || !spendPayload.spend_order_id) {
    throw new Error('Resposta de spend inválida.');
  }

  const spendOrderId = spendPayload.spend_order_id;

  const { data: disbStatus, error: disbErr } = await supabaseService.rpc(
    'get_credit_spend_disbursement_status',
    { p_spend_order_id: spendOrderId },
  );
  if (disbErr) throw new Error(disbErr.message);

  const disbursement = disbStatus as {
    found?: boolean;
    status?: string;
    mp_transfer_id?: string;
    mp_external_reference?: string;
    receiver_company_id?: string;
    manager_amount?: number;
    platform_amount?: number;
    gross_amount?: number;
  };

  if (disbursement?.status === 'completed' && disbursement.mp_transfer_id) {
    return {
      ...spendPayload,
      mpTransferId: disbursement.mp_transfer_id,
      mpExternalReference: disbursement.mp_external_reference,
    };
  }

  const receiverCompanyId =
    spendPayload.receiver_company_id ?? disbursement?.receiver_company_id;

  const managerAmount = Number(
    spendPayload.manager_amount ?? disbursement?.manager_amount ?? 0,
  );
  const platformAmount = Number(
    spendPayload.platform_amount ?? disbursement?.platform_amount ?? 0,
  );
  const grossAmount = Number(spendPayload.gross_amount ?? 0);

  if (!receiverCompanyId) {
    if (!spendPayload.duplicate) {
      await supabaseService.rpc('rollback_credit_spend', {
        p_spend_order_id: spendOrderId,
        p_reason: 'Empresa receptora não identificada para repasse MP.',
      });
    }
    throw new Error('Empresa receptora não identificada.');
  }

  try {
    const mp = await executeCreditMpDisbursement(supabaseService, {
      spendOrderId,
      receiverCompanyId,
      grossAmount,
      platformAmount,
      managerAmount,
      idempotencyKey,
      description,
    });

    const { data: confirmed, error: confirmErr } = await supabaseService.rpc(
      'confirm_credit_mp_disbursement',
      {
        p_spend_order_id: spendOrderId,
        p_mp_transfer_id: mp.mpTransferId,
        p_mp_external_reference: mp.mpExternalReference,
        p_mp_mode: mp.mode,
      },
    );

    if (confirmErr) {
      console.error('[credit-spend-flow] confirm failed after MP success:', confirmErr.message);
      throw new Error(confirmErr.message);
    }

    const confirmPayload = confirmed as { ok?: boolean; error?: string };
    if (!confirmPayload?.ok) {
      throw new Error(confirmPayload?.error ?? 'Falha ao confirmar repasse MP.');
    }

    return {
      ...spendPayload,
      mpTransferId: mp.mpTransferId,
      mpExternalReference: mp.mpExternalReference,
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'Falha no repasse Mercado Pago.';
    if (!spendPayload.duplicate) {
      await supabaseService.rpc('rollback_credit_spend', {
        p_spend_order_id: spendOrderId,
        p_reason: reason,
      });
    } else {
      await supabaseService.rpc('mark_credit_disbursement_failed', {
        p_spend_order_id: spendOrderId,
        p_error: reason,
      });
    }
    throw err instanceof Error ? err : new Error(reason);
  }
}
