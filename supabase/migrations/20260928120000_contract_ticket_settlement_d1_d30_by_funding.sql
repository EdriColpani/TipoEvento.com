-- Aditivo contratual: repasse de ingressos no modo banco — PIX/débito D+1 · cartão D+30 (ou data MP).
-- Alinha ticket_commission e ticket_plus_consumption à regra operacional v0.2 (settlement funding).

DO $apply$
DECLARE
  v_marker TEXT := 'ticket-settlement-funding-d1-d30-2026-09';

  v_old_ticket_ii TEXT := E'II – Conta bancária / PIX (sem Mercado Pago do CONTRATANTE): o pagamento do ingresso é processado na conta Mercado Pago da CONTRATADA (EventFest); o valor líquido devido ao CONTRATANTE, após comissão EventFest, tarifas do meio de pagamento e demais encargos aplicáveis, será registrado na plataforma e submetido a retenção operacional de um (1) dia (liquidação manual D+1) para conciliação e análise de risco, sendo posteriormente liquidado via PIX ou TED para a conta bancária e chave PIX cadastradas pelo CONTRATANTE.';

  v_new_ticket_ii TEXT := E'II – Conta bancária / PIX (sem Mercado Pago do CONTRATANTE): o pagamento do ingresso é processado na conta Mercado Pago da CONTRATADA (EventFest); o valor líquido devido ao CONTRATANTE, após comissão EventFest, tarifas do meio de pagamento e demais encargos aplicáveis, será registrado na plataforma e submetido a retenção operacional conforme o meio de pagamento utilizado na venda: (a) pagamentos por PIX ou cartão de débito — liquidação manual em um (1) dia (D+1), para conciliação e análise de risco; (b) pagamentos por cartão de crédito — liquidação manual em até trinta (30) dias corridos (D+30), ou na data de liberação financeira informada pelo Mercado Pago quando essa data for posterior a dois (2) dias da confirmação do pagamento, o que ocorrer por último. Após o prazo aplicável, o valor será liquidado via PIX ou TED para a conta bancária e chave PIX cadastradas pelo CONTRATANTE.';

  v_old_ticket_36 TEXT := E'A liquidação D+1 prevista no item II somente será considerada concluída após registro na plataforma pelo administrador da EventFest, com indicação do meio (PIX ou TED) e referência/comprovante, gerando trilha de auditoria. O CONTRATANTE poderá acompanhar os status (em retenção D+1, liberado para pagamento e pago) nos relatórios da plataforma.';

  v_new_ticket_36 TEXT := E'A liquidação prevista no item II somente será considerada concluída após registro na plataforma pelo administrador da EventFest, com indicação do meio (PIX ou TED) e referência/comprovante, gerando trilha de auditoria. O CONTRATANTE poderá acompanhar os status (em retenção conforme prazo do meio de pagamento — D+1 para PIX/débito e D+30 ou data MP para cartão de crédito —, liberado para pagamento e pago) nos relatórios da plataforma.';

  v_old_hybrid_44 TEXT := E'4.4. O CONTRATANTE configurará na plataforma o modo de recebimento de ingressos, de forma exclusiva:\n\nI – Mercado Pago (conta do CONTRATANTE): split/marketplace no ato, com comissão EventFest retida na cobrança e líquido creditado na conta Mercado Pago do CONTRATANTE;\n\nII – Conta bancária / PIX: cobrança na conta Mercado Pago da EventFest; o líquido do ingresso, após comissão e encargos, entra em liquidação manual D+1 (retenção de um dia) e é pago via PIX/TED à conta e chave PIX cadastradas pelo CONTRATANTE.\n\nSem configuração válida do modo de recebimento, não será permitida a criação/ativação de eventos com venda de ingressos. A liquidação do item II só se conclui com registro administrativo (meio e comprovante) na plataforma.';

  v_new_hybrid_44 TEXT := E'4.4. O CONTRATANTE configurará na plataforma o modo de recebimento de ingressos, de forma exclusiva:\n\nI – Mercado Pago (conta do CONTRATANTE): split/marketplace no ato, com comissão EventFest retida na cobrança e líquido creditado na conta Mercado Pago do CONTRATANTE;\n\nII – Conta bancária / PIX: cobrança na conta Mercado Pago da EventFest; o líquido do ingresso, após comissão e encargos, entra em liquidação manual conforme o meio de pagamento: PIX ou cartão de débito em D+1 (retenção de um dia); cartão de crédito em D+30 ou na data de liberação financeira informada pelo Mercado Pago quando posterior a dois (2) dias da confirmação do pagamento. O pagamento ao CONTRATANTE é feito via PIX/TED à conta e chave PIX cadastradas.\n\nSem configuração válida do modo de recebimento, não será permitida a criação/ativação de eventos com venda de ingressos. A liquidação do item II só se conclui com registro administrativo (meio e comprovante) na plataforma.';

  v_marker_footer TEXT := E'\n\n<!-- ticket-settlement-funding-d1-d30-2026-09 -->';

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
     AND position(v_old_ticket_ii IN (SELECT content FROM public.event_contracts WHERE id = v_ticket_id)) > 0 THEN
    UPDATE public.event_contracts
    SET
      content = replace(
        replace(content, v_old_ticket_ii, v_new_ticket_ii),
        v_old_ticket_36,
        v_new_ticket_36
      ) || v_marker_footer,
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
     AND position(v_old_hybrid_44 IN (SELECT content FROM public.event_contracts WHERE id = v_hybrid_id)) > 0 THEN
    UPDATE public.event_contracts
    SET
      content = replace(content, v_old_hybrid_44, v_new_hybrid_44) || v_marker_footer,
      version = public.bump_event_contract_version(version),
      updated_at = timezone('utc'::text, now())
    WHERE id = v_hybrid_id;
  END IF;

  UPDATE public.companies c
  SET requires_billing_reacceptance = true
  WHERE c.billing_plan::text IN ('ticket_commission', 'ticket_plus_consumption')
     OR c.billing_contract_id IN (v_ticket_id, v_hybrid_id);

  GET DIAGNOSTICS v_reaccept = ROW_COUNT;

  RAISE NOTICE 'contract_ticket_settlement_d1_d30: ticket_commission=%, hybrid=%, companies_reaccept=%',
    v_ticket_id, v_hybrid_id, v_reaccept;
END
$apply$;
