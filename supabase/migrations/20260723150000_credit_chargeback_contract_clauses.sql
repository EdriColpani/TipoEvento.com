-- Aditivo contratual: chargeback em recarga de crédito e clawback proporcional ao gestor
-- Aplica seção HTML nos contratos ativos (marcador idempotente) e exige reaceite nos planos de consumo.

CREATE OR REPLACE FUNCTION public.bump_event_contract_version(p_version TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_trimmed TEXT;
  v_major INTEGER;
  v_minor INTEGER;
  v_prefix TEXT;
BEGIN
  v_trimmed := trim(COALESCE(p_version, '1.0'));
  IF v_trimmed ~* '^v?(\d+)(?:\.(\d+))?$' THEN
    v_major := (regexp_match(v_trimmed, '^v?(\d+)', 'i'))[1]::integer;
    v_minor := COALESCE((regexp_match(v_trimmed, '\.(\d+)$'))[1]::integer, 0) + 1;
    v_prefix := CASE WHEN v_trimmed ~* '^v' THEN 'v' ELSE '' END;
    RETURN v_prefix || v_major::text || '.' || v_minor::text;
  END IF;
  RETURN v_trimmed || '.1';
END;
$$;

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
    RETURN jsonb_build_object(
      'ok', false,
      'skipped', true,
      'contract_type', p_contract_type,
      'reason', 'no_active_contract'
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
    'companies_flagged_reaccept', v_reaccept_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_event_contract_amendment(TEXT, TEXT, TEXT, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_event_contract_amendment(TEXT, TEXT, TEXT, BOOLEAN) TO service_role;

DO $apply$
DECLARE
  v_marker TEXT := 'data-eventfest-clause="credit-chargeback-2026-07"';
  v_client_section TEXT;
  v_gestor_registration_section TEXT;
  v_gestor_consumption_section TEXT;
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

  v_gestor_registration_section := $html$
<section data-eventfest-clause="credit-chargeback-2026-07">
<h3>Aditivo — crédito EventFest, chargebacks e compensações</h3>
<p><strong>Última atualização do aditivo:</strong> julho de 2026.</p>
<p><strong>1. Rede de crédito.</strong> Quando a empresa participar, direta ou indiretamente, da rede de crédito EventFest (recarga de clientes e consumo em eventos ou estabelecimentos), aplicam-se também as regras do contrato comercial do plano vigente e deste aditivo.</p>
<p><strong>2. Chargeback na recarga do cliente.</strong> Em caso de chargeback, estorno ou contestação no Mercado Pago sobre recarga de crédito já liquidada, a EventFest poderá estornar saldo remanescente do cliente e promover <strong>clawback proporcional</strong> sobre repasses ou liquidações vinculados a consumos financiados por aquela recarga.</p>
<p><strong>3. Autorização de débito e compensação.</strong> A empresa autoriza a EventFest a: (a) marcar como estornados ou clawback os valores em repasse ainda não pagos; (b) compensar valores já pagos ou sacados mediante débito em repasses futuros, saldos a liquidar ou outros créditos devidos à empresa na plataforma, até o limite do valor proporcional atribuível aos consumos financiados pela recarga contestada; (c) registrar o motivo e os identificadores da operação para auditoria.</p>
<p><strong>4. Proporcionalidade.</strong> O clawback observará a participação da empresa nos consumos atribuíveis à recarga contestada, e não será integral automático sobre repasses não relacionados.</p>
<p><strong>5. Absorção residual.</strong> Valores não recuperados do cliente nem compensados com a empresa poderão ser absorvidos pela EventFest conforme política operacional e legislação aplicável.</p>
</section>
$html$;

  v_gestor_consumption_section := $html$
<section data-eventfest-clause="credit-chargeback-2026-07">
<h3>Crédito EventFest — chargeback na recarga e clawback de repasses</h3>
<p><strong>Última atualização do aditivo:</strong> julho de 2026.</p>
<p><strong>1. Escopo.</strong> Esta cláusula integra o plano de consumo/crédito EventFest e disciplina a recuperação de valores quando houver chargeback, estorno ou contestação no Mercado Pago sobre recarga de crédito de cliente já creditada na carteira universal.</p>
<p><strong>2. Ordem de recuperação.</strong> A EventFest poderá, de forma automatizada e auditável: (i) debitar da carteira do cliente até o limite do crédito concedido na recarga contestada; (ii) promover clawback <strong>proporcional</strong> sobre os repasses da empresa vinculados a consumos financiados por aquela recarga, inclusive consumos cross-empresa na rede; (iii) absorver o saldo residual não recuperado, quando aplicável.</p>
<p><strong>3. Clawback proporcional.</strong> O valor clawback corresponderá à parcela do repasse da empresa atribuível aos consumos financiados pela recarga contestada, calculada de forma proporcional ao valor consumido, e não implicará estorno integral cego de todos os repasses da empresa.</p>
<p><strong>4. Repasses já liquidados.</strong> Se o repasse proporcional já tiver sido liberado, pago ou transferido via Mercado Pago, a empresa autoriza expressamente a compensação mediante: (a) débito em repasses futuros; (b) retenção de valores pendentes; (c) ajuste em liquidações em aberto; e (d) demais mecanismos operacionais disponíveis na plataforma, até a recomposição do valor clawback.</p>
<p><strong>5. Registros e transparência.</strong> A plataforma manterá extrato, status de liquidação (incluindo clawback) e identificadores de pagamento Mercado Pago para fins de conciliação, defesa em disputas e obrigações fiscais da empresa.</p>
<p><strong>6. Recarga via cartão.</strong> Recargas de crédito via cartão na plataforma são aceitas somente à vista (1 parcela), como medida de mitigação de risco de chargeback.</p>
<p><strong>7. Aceite.</strong> A continuidade do uso do módulo de crédito/consumo após a publicação deste aditivo implica aceite das regras acima, sem prejuízo de reaceite formal quando exigido pela plataforma.</p>
</section>
$html$;

  r := public.apply_event_contract_amendment('client_terms', v_client_section, v_marker, false);
  RAISE NOTICE 'client_terms: %', r;

  r := public.apply_event_contract_amendment('company_registration', v_gestor_registration_section, v_marker, false);
  RAISE NOTICE 'company_registration: %', r;

  r := public.apply_event_contract_amendment(
    'ticket_plus_consumption',
    v_gestor_consumption_section,
    v_marker,
    true
  );
  RAISE NOTICE 'ticket_plus_consumption: %', r;

  r := public.apply_event_contract_amendment(
    'consumption_or_license',
    v_gestor_consumption_section,
    v_marker,
    true
  );
  RAISE NOTICE 'consumption_or_license: %', r;
END
$apply$;
