-- Corrige aditivo chargeback em client_terms quando não há contrato ativo (usa o mais recente).

CREATE OR REPLACE FUNCTION public.apply_event_contract_amendment(
  p_contract_type TEXT,
  p_section_html TEXT,
  p_marker TEXT,
  p_force_reaccept_billing BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_contract public.event_contracts%ROWTYPE;
  v_new_version TEXT;
  v_reaccept_count INTEGER := 0;
BEGIN
  IF p_contract_type IS NULL OR trim(p_contract_type) = '' THEN
    RAISE EXCEPTION 'Tipo de contrato inválido.';
  END IF;

  IF p_marker IS NULL OR trim(p_marker) = '' THEN
    RAISE EXCEPTION 'Marcador de aditivo inválido.';
  END IF;

  SELECT * INTO v_contract
  FROM public.event_contracts
  WHERE contract_type = trim(p_contract_type)
    AND is_active = true
  ORDER BY updated_at DESC
  LIMIT 1;

  IF v_contract.id IS NULL THEN
    SELECT * INTO v_contract
    FROM public.event_contracts
    WHERE contract_type = trim(p_contract_type)
    ORDER BY updated_at DESC NULLS LAST, created_at DESC
    LIMIT 1;
  END IF;

  IF v_contract.id IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'skipped', true,
      'contract_type', p_contract_type,
      'reason', 'no_contract_found'
    );
  END IF;

  IF position(p_marker IN v_contract.content) > 0 THEN
    RETURN jsonb_build_object(
      'ok', true,
      'skipped', true,
      'contract_type', p_contract_type,
      'contract_id', v_contract.id,
      'reason', 'already_applied'
    );
  END IF;

  v_new_version := public.bump_event_contract_version(v_contract.version);

  UPDATE public.event_contracts
  SET
    content = v_contract.content || E'\n' || p_section_html,
    version = v_new_version,
    updated_at = timezone('utc'::text, now())
  WHERE id = v_contract.id;

  IF COALESCE(p_force_reaccept_billing, false) THEN
    UPDATE public.companies c
    SET requires_billing_reacceptance = true
    WHERE c.billing_plan::text = trim(p_contract_type)
       OR c.billing_contract_id = v_contract.id;

    GET DIAGNOSTICS v_reaccept_count = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'applied', true,
    'contract_type', p_contract_type,
    'contract_id', v_contract.id,
    'previous_version', v_contract.version,
    'new_version', v_new_version,
    'was_active', v_contract.is_active,
    'companies_flagged_reaccept', v_reaccept_count
  );
END;
$$;

DO $retry_client$
DECLARE
  v_client_section TEXT;
  v_marker TEXT := 'data-eventfest-clause="credit-chargeback-2026-07"';
  r JSONB;
BEGIN
  v_client_section := $html$
<section data-eventfest-clause="credit-chargeback-2026-07">
<h3>Carteira EventFest — recarga de crédito, chargeback e uso na rede</h3>
<p><strong>Última atualização do aditivo:</strong> julho de 2026.</p>
<p><strong>1. Valor creditado.</strong> Na recarga de crédito EventFest, o valor creditado na sua carteira corresponde ao valor pago, nos termos da plataforma. Taxas de processamento do Mercado Pago não reduzem o saldo de crédito concedido, salvo disposição legal em contrário.</p>
<p><strong>2. Meios de pagamento na recarga.</strong> A recarga via cartão é aceita somente à vista (1 parcela). Pagamentos via Pix seguem as regras exibidas no checkout.</p>
<p><strong>3. Chargeback, estorno ou contestação no Mercado Pago.</strong> Se a operadora de pagamentos ou o emissor do cartão estornar, contestar ou aplicar chargeback sobre uma recarga já creditada, a EventFest poderá: (a) debitar da sua carteira o crédito ainda disponível, até o limite do crédito concedido naquela recarga; (b) registrar a operação no extrato; e (c) adotar as medidas previstas nos Termos para recuperação de valores já utilizados na rede, inclusive clawback proporcional junto aos parceiros que receberam repasses financiados por aquela recarga.</p>
<p><strong>4. Saldo insuficiente.</strong> Se o saldo da carteira for inferior ao valor a recuperar, a diferença poderá ser tratada conforme política da plataforma e legislação aplicável, sem prejuízo de outros meios de cobrança ou compensação permitidos em lei.</p>
<p><strong>5. Uso na rede.</strong> O crédito é utilizável nos estabelecimentos e eventos parceiros habilitados. Cada consumo gera registro no extrato com descrição da operação.</p>
</section>
$html$;

  r := public.apply_event_contract_amendment('client_terms', v_client_section, v_marker, false);
  RAISE NOTICE 'client_terms retry: %', r;
END
$retry_client$;
