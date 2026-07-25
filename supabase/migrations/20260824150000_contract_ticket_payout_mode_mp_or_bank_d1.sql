-- Aditivo: modo de recebimento de ingresso (Mercado Pago split OU conta bancária / liquidação D+1).
-- Atualiza ticket_commission e ticket_plus_consumption; exige reaceitação do plano.

DO $apply$
DECLARE
  v_marker TEXT := 'modo de recebimento de ingressos';
  v_old_ticket_commission TEXT := E'3.4.\n\nOs prazos de repasse financeiro poderão variar conforme regras operacionais, análise de risco, meios de pagamento utilizados ou condições comerciais aplicáveis.';
  v_new_ticket_commission TEXT := E'3.4.\n\nO CONTRATANTE deverá configurar, na plataforma, o modo de recebimento de ingressos, escolhendo uma das alternativas abaixo, de forma exclusiva e vinculante enquanto vigente a configuração:\n\nI – Mercado Pago (conta do CONTRATANTE): o pagamento do ingresso é processado na conta Mercado Pago vinculada pelo CONTRATANTE, com retenção automática da comissão da EventFest no ato (split/marketplace), creditando-se o líquido na referida conta conforme regras do meio de pagamento;\n\nII – Conta bancária / PIX (sem Mercado Pago do CONTRATANTE): o pagamento do ingresso é processado na conta Mercado Pago da CONTRATADA (EventFest); o valor líquido devido ao CONTRATANTE, após comissão EventFest, tarifas do meio de pagamento e demais encargos aplicáveis, será registrado na plataforma e submetido a retenção operacional de um (1) dia (liquidação manual D+1) para conciliação e análise de risco, sendo posteriormente liquidado via PIX ou TED para a conta bancária e chave PIX cadastradas pelo CONTRATANTE.\n\n3.5.\n\nSem a configuração válida do modo de recebimento (Mercado Pago conectado ou dados bancários/PIX completos), o CONTRATANTE não poderá criar nem ativar eventos com venda de ingressos pela plataforma.\n\n3.6.\n\nA liquidação D+1 prevista no item II somente será considerada concluída após registro na plataforma pelo administrador da EventFest, com indicação do meio (PIX ou TED) e referência/comprovante, gerando trilha de auditoria. O CONTRATANTE poderá acompanhar os status (em retenção D+1, liberado para pagamento e pago) nos relatórios da plataforma.\n\n3.7.\n\nOs prazos e condições de repasse poderão ainda variar conforme análise de risco, chargebacks, estornos, fraudes, cancelamentos ou condições comerciais aplicáveis.';

  v_old_hybrid_ticket TEXT := E'4.4. Os repasses decorrentes da venda de ingressos intermediada pela plataforma seguirão as regras operacionais, prazos e meios de pagamento aplicáveis a esse fluxo, inclusive intermediação via Mercado Pago quando utilizada pela plataforma.';
  v_new_hybrid_ticket TEXT := E'4.4. O CONTRATANTE configurará na plataforma o modo de recebimento de ingressos, de forma exclusiva:\n\nI – Mercado Pago (conta do CONTRATANTE): split/marketplace no ato, com comissão EventFest retida na cobrança e líquido creditado na conta Mercado Pago do CONTRATANTE;\n\nII – Conta bancária / PIX: cobrança na conta Mercado Pago da EventFest; o líquido do ingresso, após comissão e encargos, entra em liquidação manual D+1 (retenção de um dia) e é pago via PIX/TED à conta e chave PIX cadastradas pelo CONTRATANTE.\n\nSem configuração válida do modo de recebimento, não será permitida a criação/ativação de eventos com venda de ingressos. A liquidação do item II só se conclui com registro administrativo (meio e comprovante) na plataforma.';

  v_ticket_id UUID;
  v_hybrid_id UUID;
  v_reaccept INTEGER := 0;
BEGIN
  SELECT id INTO v_ticket_id
  FROM public.event_contracts
  WHERE contract_type = 'ticket_commission'
    AND is_active = true
  ORDER BY updated_at DESC
  LIMIT 1;

  IF v_ticket_id IS NOT NULL
     AND position(v_marker IN (SELECT content FROM public.event_contracts WHERE id = v_ticket_id)) = 0
     AND position(v_old_ticket_commission IN (SELECT content FROM public.event_contracts WHERE id = v_ticket_id)) > 0 THEN
    UPDATE public.event_contracts
    SET
      content = replace(content, v_old_ticket_commission, v_new_ticket_commission),
      version = public.bump_event_contract_version(version),
      updated_at = timezone('utc'::text, now())
    WHERE id = v_ticket_id;
  END IF;

  SELECT id INTO v_hybrid_id
  FROM public.event_contracts
  WHERE contract_type = 'ticket_plus_consumption'
    AND is_active = true
  ORDER BY updated_at DESC
  LIMIT 1;

  IF v_hybrid_id IS NOT NULL
     AND position(v_marker IN (SELECT content FROM public.event_contracts WHERE id = v_hybrid_id)) = 0
     AND position(v_old_hybrid_ticket IN (SELECT content FROM public.event_contracts WHERE id = v_hybrid_id)) > 0 THEN
    UPDATE public.event_contracts
    SET
      content = replace(content, v_old_hybrid_ticket, v_new_hybrid_ticket),
      version = public.bump_event_contract_version(version),
      updated_at = timezone('utc'::text, now())
    WHERE id = v_hybrid_id;
  END IF;

  UPDATE public.companies c
  SET requires_billing_reacceptance = true
  WHERE c.billing_plan::text IN ('ticket_commission', 'ticket_plus_consumption')
     OR c.billing_contract_id IN (v_ticket_id, v_hybrid_id);

  GET DIAGNOSTICS v_reaccept = ROW_COUNT;

  RAISE NOTICE 'contract_ticket_payout_mode_d1: ticket_commission=%, hybrid=%, companies_reaccept=%',
    v_ticket_id, v_hybrid_id, v_reaccept;
END
$apply$;
