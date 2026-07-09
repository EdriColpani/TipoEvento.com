-- Aditivo contratual: liquidação manual D+1 (PIX/TED) dos repasses de consumo/crédito EventFest.
-- Atualiza contratos ativos ticket_plus_consumption e consumption_or_license (v1.3 → v1.4).

DO $apply$
DECLARE
  v_marker TEXT := 'liquidação manual D+1';
  v_old_ticket TEXT := E'4.4. Os prazos de repasse poderão variar conforme regras operacionais, meios de pagamento, análise de risco ou plano contratado.';
  v_new_ticket TEXT := E'4.4. Os repasses decorrentes da venda de ingressos intermediada pela plataforma seguirão as regras operacionais, prazos e meios de pagamento aplicáveis a esse fluxo, inclusive intermediação via Mercado Pago quando utilizada pela plataforma.

4.5. Os repasses decorrentes de consumo interno com créditos digitais EventFest (cashless) não são transferidos automaticamente no momento do consumo. O valor líquido devido ao CONTRATANTE, após dedução de comissões e encargos aplicáveis, será registrado eletronicamente na plataforma e submetido a retenção operacional de um (1) dia (liquidação manual D+1) para fins de conciliação, prevenção a fraudes e análise de risco.

4.6. Decorrido o prazo de retenção D+1, o valor será disponibilizado para liquidação manual pela CONTRATADA, mediante transferência PIX ou TED realizada pela EventFest para conta bancária indicada ou validada pelo CONTRATANTE, conforme dados cadastrais e políticas da plataforma.

4.7. A liquidação somente será considerada concluída após registro na plataforma pelo administrador da EventFest, com indicação do meio de pagamento (PIX ou TED) e referência/comprovante da transferência, gerando trilha de auditoria para o CONTRATANTE.

4.8. O CONTRATANTE poderá acompanhar, nos relatórios da plataforma, os status das liquidações (em retenção D+1, liberado para pagamento, pago e eventuais ajustes), bem como o detalhamento por consumo, comissão e valor líquido.';
  v_old_consumption_repasse TEXT := E'5.3. Os prazos de repasse poderão variar conforme análise operacional, regras financeiras, meios de pagamento ou condições comerciais aplicáveis.';
  v_new_consumption_repasse TEXT := E'5.3. Os repasses decorrentes de consumo interno com créditos digitais EventFest (cashless) não são transferidos automaticamente no momento do consumo. O valor líquido devido ao CONTRATANTE, após dedução de mensalidades, comissões e demais encargos aplicáveis, será registrado eletronicamente na plataforma e submetido a retenção operacional de um (1) dia (liquidação manual D+1) para fins de conciliação, prevenção a fraudes e análise de risco.

5.4. Decorrido o prazo de retenção D+1, o valor será disponibilizado para liquidação manual pela CONTRATADA, mediante transferência PIX ou TED realizada pela EventFest para conta bancária indicada ou validada pelo CONTRATANTE.

5.5. A liquidação somente será considerada concluída após registro na plataforma pelo administrador da EventFest, com indicação do meio de pagamento (PIX ou TED) e referência/comprovante da transferência.

5.6. O CONTRATANTE poderá acompanhar, nos relatórios da plataforma, os status das liquidações (em retenção D+1, liberado para pagamento, pago e eventuais ajustes), bem como o detalhamento por consumo, comissão e valor líquido.

5.7. A recarga de créditos pelos usuários finais poderá continuar a ser processada por meios de pagamento eletrônicos integrados à plataforma (incluindo Mercado Pago), sem que isso implique repasse automático imediato ao CONTRATANTE sobre os consumos realizados com tais créditos.';
  v_old_consumption_audit TEXT := E'6.5. A plataforma manterá registros, extratos, identificadores de pagamento e histórico de liquidação para fins de auditoria, conciliação e defesa em disputas.';
  v_new_consumption_audit TEXT := E'6.5. A plataforma manterá registros, extratos, identificadores das recargas (quando aplicável), comprovantes de liquidação PIX/TED e histórico de repasses para fins de auditoria, conciliação e defesa em disputas.';
  v_ticket_id UUID;
  v_consumption_id UUID;
  v_reaccept INTEGER := 0;
BEGIN
  SELECT id INTO v_ticket_id
  FROM public.event_contracts
  WHERE contract_type = 'ticket_plus_consumption'
    AND is_active = true
  ORDER BY updated_at DESC
  LIMIT 1;

  IF v_ticket_id IS NOT NULL
     AND position(v_marker IN (SELECT content FROM public.event_contracts WHERE id = v_ticket_id)) = 0
     AND position(v_old_ticket IN (SELECT content FROM public.event_contracts WHERE id = v_ticket_id)) > 0 THEN
    UPDATE public.event_contracts
    SET
      content = replace(content, v_old_ticket, v_new_ticket),
      version = public.bump_event_contract_version(version),
      updated_at = timezone('utc'::text, now())
    WHERE id = v_ticket_id;
  END IF;

  SELECT id INTO v_consumption_id
  FROM public.event_contracts
  WHERE contract_type = 'consumption_or_license'
    AND is_active = true
  ORDER BY updated_at DESC
  LIMIT 1;

  IF v_consumption_id IS NOT NULL
     AND position(v_marker IN (SELECT content FROM public.event_contracts WHERE id = v_consumption_id)) = 0 THEN
    UPDATE public.event_contracts
    SET
      content = replace(
        replace(content, v_old_consumption_repasse, v_new_consumption_repasse),
        v_old_consumption_audit,
        v_new_consumption_audit
      ),
      version = public.bump_event_contract_version(version),
      updated_at = timezone('utc'::text, now())
    WHERE id = v_consumption_id
      AND position(v_old_consumption_repasse IN content) > 0;
  END IF;

  UPDATE public.companies c
  SET requires_billing_reacceptance = true
  WHERE c.billing_plan::text IN ('ticket_plus_consumption', 'consumption_or_license')
     OR c.billing_contract_id IN (v_ticket_id, v_consumption_id);

  GET DIAGNOSTICS v_reaccept = ROW_COUNT;

  RAISE NOTICE 'contract_manual_settlement_d1: ticket=%, consumption=%, companies_reaccept=%',
    v_ticket_id, v_consumption_id, v_reaccept;
END
$apply$;
