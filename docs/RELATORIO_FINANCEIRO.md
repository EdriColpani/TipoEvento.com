# 📊 Relatório Financeiro - Sistema de Vendas de Ingressos

## 📋 Estrutura de Separação dos Valores

### Como os Registros são Separados

Quando um ingresso é vendido, o sistema grava **2 registros** na tabela `financial_splits` para cada transação:

1. **Registro do Valor Líquido do Organizador (Evento)**
   - `platform_amount = 0`
   - `manager_amount = valor_líquido` (valor total - comissão)
   - Identificação: `manager_amount > 0 AND platform_amount = 0`

2. **Registro da Comissão do Sistema (Plataforma)**
   - `platform_amount = valor_comissão` (percentual aplicado)
   - `manager_amount = 0`
   - Identificação: `platform_amount > 0 AND manager_amount = 0`

### Campos da Tabela `financial_splits`

- `id`: UUID único do registro
- `transaction_id`: ID da transação (FK para `receivables.id`)
- `event_id`: ID do evento (FK para `events.id`)
- `manager_user_id`: ID do organizador/gerente
- `platform_amount`: Valor da comissão do sistema (R$)
- `manager_amount`: Valor líquido do organizador (R$)
- `total_amount`: Valor total da transação (R$)
- `applied_percentage`: Percentual de comissão aplicado (%)
- `created_at`: Data/hora da criação

---

## 🔍 Queries SQL para Consultas

### 1. Valor Total Vendido por Evento

```sql
-- Valor total de vendas por evento (somando todos os receivables pagos)
SELECT 
    e.id AS event_id,
    e.title AS evento,
    e.date AS data_evento,
    COUNT(DISTINCT r.id) AS quantidade_vendas,
    SUM(r.total_value) AS valor_total_vendido
FROM receivables r
INNER JOIN events e ON r.event_id = e.id
WHERE r.status = 'paid'
GROUP BY e.id, e.title, e.date
ORDER BY valor_total_vendido DESC;
```

### 2. Valor Líquido do Organizador por Evento

```sql
-- Valor líquido que o organizador recebe (somando manager_amount)
SELECT 
    e.id AS event_id,
    e.title AS evento,
    SUM(fs.manager_amount) AS valor_liquido_organizador,
    COUNT(DISTINCT fs.transaction_id) AS quantidade_transacoes
FROM financial_splits fs
INNER JOIN events e ON fs.event_id = e.id
WHERE fs.manager_amount > 0  -- Apenas registros do organizador
GROUP BY e.id, e.title
ORDER BY valor_liquido_organizador DESC;
```

### 3. Comissão Total do Sistema por Evento

```sql
-- Valor total de comissão que o sistema recebe (somando platform_amount)
SELECT 
    e.id AS event_id,
    e.title AS evento,
    SUM(fs.platform_amount) AS comissao_total_sistema,
    AVG(fs.applied_percentage) AS percentual_medio_aplicado,
    COUNT(DISTINCT fs.transaction_id) AS quantidade_transacoes
FROM financial_splits fs
INNER JOIN events e ON fs.event_id = e.id
WHERE fs.platform_amount > 0  -- Apenas registros de comissão
GROUP BY e.id, e.title
ORDER BY comissao_total_sistema DESC;
```

### 4. Relatório Completo por Evento (Vendas + Comissões)

```sql
-- Relatório completo: vendas, valor líquido organizador, comissão sistema
SELECT 
    e.id AS event_id,
    e.title AS evento,
    e.date AS data_evento,
    COUNT(DISTINCT r.id) AS quantidade_ingressos_vendidos,
    SUM(r.total_value) AS valor_total_vendido,
    SUM(CASE WHEN fs.manager_amount > 0 THEN fs.manager_amount ELSE 0 END) AS valor_liquido_organizador,
    SUM(CASE WHEN fs.platform_amount > 0 THEN fs.platform_amount ELSE 0 END) AS comissao_total_sistema,
    AVG(CASE WHEN fs.platform_amount > 0 THEN fs.applied_percentage ELSE NULL END) AS percentual_comissao_medio
FROM receivables r
INNER JOIN events e ON r.event_id = e.id
LEFT JOIN financial_splits fs ON fs.transaction_id = r.id
WHERE r.status = 'paid'
GROUP BY e.id, e.title, e.date
ORDER BY valor_total_vendido DESC;
```

### 5. Quantidade de Ingressos Vendidos por Evento

```sql
-- Contagem de ingressos vendidos (baseado em wristband_analytics com status 'used')
SELECT 
    e.id AS event_id,
    e.title AS evento,
    COUNT(wa.id) AS quantidade_ingressos_vendidos
FROM wristband_analytics wa
INNER JOIN wristbands w ON wa.wristband_id = w.id
INNER JOIN events e ON w.event_id = e.id
WHERE wa.status = 'used' 
  AND wa.event_type = 'purchase'
GROUP BY e.id, e.title
ORDER BY quantidade_ingressos_vendidos DESC;
```

### 6. Relatório Consolidado do Sistema (Todos os Eventos)

```sql
-- Relatório geral: total de vendas, comissões e ingressos vendidos
SELECT 
    COUNT(DISTINCT r.id) AS total_vendas,
    COUNT(DISTINCT r.event_id) AS total_eventos_com_vendas,
    SUM(r.total_value) AS valor_total_vendido_sistema,
    SUM(CASE WHEN fs.manager_amount > 0 THEN fs.manager_amount ELSE 0 END) AS valor_total_organizadores,
    SUM(CASE WHEN fs.platform_amount > 0 THEN fs.platform_amount ELSE 0 END) AS comissao_total_sistema,
    COUNT(DISTINCT wa.id) AS total_ingressos_vendidos
FROM receivables r
LEFT JOIN financial_splits fs ON fs.transaction_id = r.id
LEFT JOIN wristband_analytics wa ON wa.id = ANY(r.wristband_analytics_ids)
WHERE r.status = 'paid'
  AND (wa.status = 'used' OR wa.status IS NULL);
```

### 7. Detalhamento por Transação Individual

```sql
-- Ver detalhes de cada transação: valor total, valor organizador, comissão
SELECT 
    r.id AS transaction_id,
    r.created_at AS data_compra,
    e.title AS evento,
    r.total_value AS valor_total,
    MAX(CASE WHEN fs.manager_amount > 0 THEN fs.manager_amount ELSE 0 END) AS valor_organizador,
    MAX(CASE WHEN fs.platform_amount > 0 THEN fs.platform_amount ELSE 0 END) AS comissao_sistema,
    MAX(CASE WHEN fs.platform_amount > 0 THEN fs.applied_percentage ELSE NULL END) AS percentual_comissao,
    array_length(r.wristband_analytics_ids, 1) AS quantidade_ingressos
FROM receivables r
INNER JOIN events e ON r.event_id = e.id
LEFT JOIN financial_splits fs ON fs.transaction_id = r.id
WHERE r.status = 'paid'
GROUP BY r.id, r.created_at, e.title, r.total_value, r.wristband_analytics_ids
ORDER BY r.created_at DESC;
```

### 8. Relatório por Período (Mensal/Anual)

```sql
-- Vendas e comissões agrupadas por mês/ano
SELECT 
    DATE_TRUNC('month', r.created_at) AS mes,
    COUNT(DISTINCT r.id) AS quantidade_vendas,
    COUNT(DISTINCT r.event_id) AS quantidade_eventos,
    SUM(r.total_value) AS valor_total_vendido,
    SUM(CASE WHEN fs.manager_amount > 0 THEN fs.manager_amount ELSE 0 END) AS valor_total_organizadores,
    SUM(CASE WHEN fs.platform_amount > 0 THEN fs.platform_amount ELSE 0 END) AS comissao_total_sistema
FROM receivables r
LEFT JOIN financial_splits fs ON fs.transaction_id = r.id
WHERE r.status = 'paid'
GROUP BY DATE_TRUNC('month', r.created_at)
ORDER BY mes DESC;
```

### 9. Top Organizadores (por Valor Vendido)

```sql
-- Organizadores que mais venderam
SELECT 
    u.id AS manager_id,
    u.email AS email_organizador,
    COUNT(DISTINCT r.id) AS quantidade_vendas,
    SUM(r.total_value) AS valor_total_vendido,
    SUM(CASE WHEN fs.manager_amount > 0 THEN fs.manager_amount ELSE 0 END) AS valor_liquido_recebido
FROM receivables r
INNER JOIN auth.users u ON r.manager_user_id = u.id
LEFT JOIN financial_splits fs ON fs.transaction_id = r.id
WHERE r.status = 'paid'
GROUP BY u.id, u.email
ORDER BY valor_total_vendido DESC
LIMIT 10;
```

### 10. Verificar Separação de Valores de uma Transação Específica

```sql
-- Ver os 2 registros de financial_splits de uma transação específica
SELECT 
    fs.id,
    fs.transaction_id,
    CASE 
        WHEN fs.platform_amount > 0 THEN 'Comissão Sistema'
        WHEN fs.manager_amount > 0 THEN 'Valor Organizador'
    END AS tipo_registro,
    fs.platform_amount AS comissao_sistema,
    fs.manager_amount AS valor_organizador,
    fs.total_amount AS valor_total,
    fs.applied_percentage AS percentual_comissao,
    e.title AS evento
FROM financial_splits fs
INNER JOIN events e ON fs.event_id = e.id
WHERE fs.transaction_id = 'SEU_TRANSACTION_ID_AQUI'  -- Substitua pelo ID da transação
ORDER BY fs.platform_amount DESC;  -- Comissão primeiro, depois valor organizador
```

---

## 📈 Como Identificar os Valores

### Identificar Valor do Ingresso para o Evento:
```sql
-- Buscar registros onde manager_amount > 0
SELECT * FROM financial_splits 
WHERE manager_amount > 0 AND platform_amount = 0;
```

### Identificar Comissão do Sistema:
```sql
-- Buscar registros onde platform_amount > 0
SELECT * FROM financial_splits 
WHERE platform_amount > 0 AND manager_amount = 0;
```

---

## 🎯 Resumo da Estrutura

| Campo | Descrição | Como Usar |
|-------|-----------|-----------|
| `platform_amount > 0` | Comissão do sistema | Somar para obter comissão total |
| `manager_amount > 0` | Valor líquido do organizador | Somar para obter valor total dos organizadores |
| `total_amount` | Valor total da transação | Usado para validação (deve ser igual à soma dos outros dois) |
| `applied_percentage` | Percentual de comissão | Mostra o % aplicado naquele momento |

---

## ⚠️ Observações Importantes

1. **Cada transação gera 2 registros** em `financial_splits`:
   - 1 registro com `manager_amount` (valor do organizador)
   - 1 registro com `platform_amount` (comissão do sistema)

2. **O `total_amount` é o mesmo nos 2 registros** (valor total da transação)

3. **Para calcular totais**, sempre filtre por:
   - `platform_amount > 0` para comissões
   - `manager_amount > 0` para valores dos organizadores

4. **Quantidade de ingressos vendidos** está em:
   - `receivables.wristband_analytics_ids` (array de IDs)
   - `wristband_analytics.status = 'used'` e `event_type = 'purchase'`

---

## 🔧 Próximos Passos Sugeridos

1. **Criar uma View SQL** para facilitar consultas recorrentes
2. **Criar um Dashboard/Relatório** na interface do sistema
3. **Exportar dados** para Excel/CSV quando necessário
4. **Configurar alertas** para valores acima de determinado limite

