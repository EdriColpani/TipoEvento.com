# Roteiro: cadastrar e publicar um evento (EventFest)

Fluxo do gestor em `/manager/events/create` → editar → **Ativar**.

---

## 1. Antes de começar (pré-requisitos)

Sem isso o formulário não abre ou o banco rejeita o save:

1. **Empresa** vinculada ao usuário gestor
2. **Plano aceito** em Configurações → Perfil da Empresa → **Plano** (contrato assinado, sem reaceitação pendente)
3. Se o plano **vende ingresso** (`ticket_commission` ou híbrido):
   - **Recebimento** configurado (Mercado Pago **ou** banco/PIX) em Perfil → **Recebimento**
4. **Sem bloqueio de chargeback** (≥ 3 dívidas abertas → não cria / não reativa)
5. **Sem bloqueio de inatividade** comercial (sem venda em eventos realizados, se a regra estiver ativa)
6. Plano com permissão **Criar evento** (`events_create`)

| Plano | O que o evento pode ser |
|--------|-------------------------|
| Comissão / Híbrido | Evento **pago** com lotes (nasce **inativo**) |
| Divulgação / Consumo-licença | Só **vitrine** (sem venda de ingresso na plataforma) |

---

## 2. Abrir o cadastro

- Menu / Dashboard → **Cadastrar novo evento**
- Rota: `/manager/events/create`
- Edição depois: `/manager/events/edit/:id`

Wizard em etapas (sem contrato legado):

1. **Detalhes**
2. **Imagens**
3. **Preço e lotes** (só se não for vitrine)

(Se ainda existir contrato de evento antigo sem plano na empresa, aparece um passo **Contrato** no início.)

---

## 3. Passo Detalhes — campos

| Campo | Obrigatório | Observação |
|--------|-------------|------------|
| **Título do Evento** | Sim | 3–100 caracteres |
| **Descrição Detalhada** | Sim | 10–1000 caracteres |
| **Destaques do evento** | Não | Até 10 linhas / 2000 chars |
| **Data do Evento** | Sim | DatePicker |
| **Hora do Evento** | Sim | Não pode ficar vazia |
| **Local do evento** | Sim | 3–100 (nome do lugar) |
| **Endereço completo** | Sim | 5–200; ideal usar autocomplete (lat/lng) |
| **Aceitar crédito EventFest** | Não | Só plano híbrido/consumo |
| **Idade mínima** | Sim | 0–18 |
| **Categoria** | Sim | Lista da empresa (pode criar) |
| **Capacidade máxima** | Sim | Inteiro > 0 (no pago, a venda segue a soma dos lotes) |
| **Duração estimada (horas)** | Sim | Texto, ex.: “3 horas” |
| **Evento pago?** | Condicional | Oculto se o plano força pago ou só vitrine |

---

## 4. Passo Imagens — as 3 são obrigatórias

| Imagem | Uso | Sugestão |
|--------|-----|----------|
| **Card da listagem** | Grade / busca | 1920×1080 |
| **Card de exposição** | Carrosséis | 16:9 |
| **Banner da página** | Topo da página do evento | ~1920×640 (3:1) |

Upload ~5 MB; URL válida após upload.

---

## 5. Passo Preço e lotes (evento pago)

### Configurações gerais de ingresso

| Campo | Default | Função |
|--------|---------|--------|
| **Permitir ingresso impresso na portaria** | Não | Impressão física |
| **Validade do QR no app** | 90 s | 60 / 90 / 120 |
| **Exibir titular no validador** | Sim | Portaria |
| **Número de lotes** | 1 | Até 20 |

### Por lote

| Campo | Obrigatório | Regra |
|--------|-------------|--------|
| **Lote cortesia / gratuito** | Não | Preço fica R$ 0,00 |
| **Nome do lote** | Sim | Ex.: Pista, VIP, Staff |
| **Quantidade** | Sim | 1–500.000; depois de vendas só **aumenta** |
| **Preço (R$)** | Sim | > 0 se venda; 0 se cortesia |
| **Início das vendas** | Sim | Data |
| **Fim das vendas** | Sim | ≥ início |

### Regras que travam o save

- Pelo menos **1 lote de venda** (preço > 0); só cortesia → erro
- Soma das quantidades ≥ **mínimo do plano** (em geral 10, pode ser customizado na empresa)
- Depois de vendas: não troca pago ↔ gratuito; lotes não diminuem qty

**Evento gratuito** (quando o plano permite): opção de **turmas** (nome + capacidade).

### O que o sistema grava ao salvar (pago)

- Estoque em modo **contador** (por lote)
- Capacidade / total = soma dos lotes
- Preço “de referência” = menor preço pago
- Comissão conforme faixa do contrato
- Status aprovado se há empresa
- **`is_active = false`** até o gestor **Ativar**

---

## 6. Depois de salvar — rotinas de ingresso

### Venda online (padrão)

1. Lotes já criados no wizard → estoque pronto
2. QR nasce **na compra** (não precisa emitir ingresso um a um)
3. Se houver lote cortesia → `/manager/events/:id/cortesias` → **Enviar pacotes cortesia**

### Emissão manual (legado / físico)

- `/manager/wristbands/create`
- Associar evento, quantidade, tipo de acesso, valor
- **Gerar ingresso não publica o evento**

### Portaria

- `/manager/validation-keys` → **Nova chave**
- Tipo Entrada/saída, colaborador, evento
- Código de 8 caracteres só na criação

*(Empresa parceira / só consumo: usa PDV, não esse menu.)*

---

## 7. Opcionais pós-cadastro

| Item | Onde | Observação |
|------|------|------------|
| Banner do carrossel home | `/manager/events/banners/create` | 1 banner por evento; datas = data do evento |
| Cortesias | `/manager/events/:id/cortesias` | Após lote R$ 0 |
| Editar lotes / imagens | `/manager/events/edit/:id` | Enquanto não encerrado |

---

## 8. Ir ao ar — checklist e Ativar

Em **Meus Eventos** → botão **Ativar** (planos com ingresso).

Itens que **bloqueiam** a ativação (go-live):

- [ ] Estoque contador configurado
- [ ] Lotes / inventário ok
- [ ] Integridade (sem overselling)
- [ ] Webhook assíncrono de checkout
- [ ] Recebimento (MP ou PIX/banco) válido
- [ ] Quantidade ≥ mínimo de ingressos
- [ ] Sem bloqueio chargeback / inatividade

Recomendados (não bloqueiam): teste de compra, soft open, chave de portaria, banner.

Depois de ativo: smoke na vitrine → comprar → validar QR na portaria.

---

## 9. Checklist único (copiar e usar)

**Antes**
- [ ] Plano + contrato ok
- [ ] Recebimento ok (se vende)
- [ ] Sem ≥3 chargebacks / sem inatividade

**Cadastro**
- [ ] Detalhes completos
- [ ] 3 imagens
- [ ] Lotes (nome, qty, preço, janela) + ≥1 venda + mínimo
- [ ] Salvar

**Operação**
- [ ] Cortesias (se houver)
- [ ] Banner (opcional)
- [ ] Chave de validação
- [ ] Checklist go-live verde
- [ ] **Ativar**
- [ ] Teste de compra + portaria

---

## 10. Ordem sugerida no dia a dia

```
Plano → Recebimento → Criar evento (detalhes → imagens → lotes)
  → Cortesias (se houver) → Chave portaria → Banner (opcional)
  → Revisar go-live → Ativar → Testar venda
```
