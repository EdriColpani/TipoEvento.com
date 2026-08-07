# QA — Consumo com crédito (catálogo cliente + entrega)

Checklist manual (dev → test → prod). Migrations / RPCs já no remoto EventFest:

- `list_client_event_credit_catalog` / `list_client_establishment_credit_catalog`
- `create_credit_consumption_intent(..., p_event_id)`
- `finalize_client_credit_consumption_payment` + baixa de estoque
- `complete_credit_consumption_delivery`
- `list_client_credit_consumption_orders`
- `list_manager_credit_product_inventory_report`

Edges (redeploy se necessário):

- `create-credit-consumption-intent`
- `confirm-credit-consumption-intent`
- `confirm-credit-consumption-intent-manager`
- `resolve-credit-menu-token` (filtra estoque > 0 + foto)
## 1. Entrada do cliente

- [ ] Meus Ingressos → **Consumo no evento** abre `/wallet/consumo/evento/:eventId`
- [ ] Carteira → evento **Consumo** / estabelecimento **Cardápio**
- [ ] QR do balcão (PDV) abre `/wallet/consumo?m=...`
- [ ] Evento sem catálogo / crédito desligado mostra mensagem clara (sem crash)

## 2. Compra (débito na hora)

- [ ] Selecionar itens respeita estoque máximo
- [ ] Biometria exigida quando gross ≥ threshold
- [ ] Saldo insuficiente → erro claro; estoque **não** baixa
- [ ] Sucesso: saldo cai, pedido em `/wallet/pedidos`, QR `EFDEL.*` na tela
- [ ] Compra via evento grava `event_id` no intent (visível no PDV)
- [ ] Split / ledger D+1 gerado (relatório consumo / repasses)

## 3. Estoque

- [ ] Após pagar, `quantity` do produto diminui
- [ ] Segundo pedido acima do estoque falha
- [ ] Cardápio deixa de listar produto com estoque 0

## 4. Entrega (gestor)

- [ ] PDV lista pedido com cliente, `#public_id`, itens, evento
- [ ] Colar `EFDEL` → **Confirmar entrega** → status `completed`, QR some
- [ ] **Escanear QR do pedido** (câmera) entrega e invalida
- [ ] Reutilizar o mesmo QR → erro / duplicate seguro
- [ ] Pedido já pago mostra **Confirmar entrega** (não “Cobrar agora”)
- [ ] Histórico de status registra nota com cliente + itens

## 5. Cliente pós-entrega

- [ ] Em `/wallet/pedidos`, pedido vai para Histórico / **Entregue**
- [ ] Botão **Ver QR** some
- [ ] Com a tela aberta, toast “foi entregue” após o gestor confirmar (polling ~30s)

## 6. Relatório estoque × vendidos

- [ ] Central de Relatórios → card **Estoque e vendas de produtos**
- [ ] Colunas **Em estoque** e **Vendidos** preenchidas
- [ ] Filtro por estabelecimento funciona
- [ ] Após uma venda com `product_id`, coluna Vendidos sobe; estoque cai no cadastro

## 7. Regressões

- [ ] PDV cobrança clássica (QR carteira + carrinho) continua ok
- [ ] Pedido antigo só criado (não pago) ainda pode **Cobrar agora**
- [ ] Botões seguem padrão amarelo/escuro EventFest
- [ ] Menu mobile / Perfil: atalho **Meus pedidos**
