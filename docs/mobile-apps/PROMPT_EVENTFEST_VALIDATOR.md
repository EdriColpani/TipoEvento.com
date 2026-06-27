# PROMPT — EventFest Validator (App Portaria)

> **Uso:** copie este documento integralmente ao iniciar o projeto mobile da equipe de validação.
> **Repositório sugerido:** `eventfest-validator` (1 repo, iOS + Android)
> **Backend:** mesmo Supabase + Edge Function `validate-ticket` do projeto web EventFest (`tipoevento`)

---

## Contexto

Você vai criar o aplicativo mobile **EventFest Validator** para a **equipe de portaria** em eventos — seguranças, recepcionistas, voluntários. Essas pessoas **não são gestores** e **não devem** ter acesso ao dashboard financeiro ou configurações do evento.

O app é **ultra focado**: autenticar com **chave de validação** (gerada no EventFest Manager), escanear QR/código do ingresso, mostrar resultado imediato (válido/inválido/já usado) e registrar a entrada.

Base existente no web: rota `/validador` (PWA), tabela `validation_api_keys`, Edge Function `validate-ticket`, docs `VALIDADOR_INSTALAR_CELULAR.md`.

---

## Princípios de design

1. **Uma mão, uma ação** — operador segura celular e escaneia
2. **Feedback instantâneo** — som + cor verde/vermelha + vibração
3. **Funciona com internet instável** — fila offline de validações (fase 2)
4. **Zero acesso a dados sensíveis** — sem vendas, sem CPF completo desnecessário
5. **Sessão temporária** — chave expira; ao fim do turno, encerrar sessão

---

## Stack técnica

- **Expo (React Native) + TypeScript**
- **expo-camera** ou **react-native-vision-camera** + leitor QR/barcode
- Chamadas HTTP para Edge Function `validate-ticket` (não expor service role no app)
- **Async Storage** — histórico local do turno, fila offline (fase 2)
- **Expo AV / Haptics** — som e vibração de sucesso/erro
- **Expo Keep Awake** — tela não apaga durante validação
- Sem Supabase Auth de usuário gestor — autenticação por **API key de validação**
- UI: alto contraste, botões grandes, modo escuro/claro automático para portaria externa

---

## Autenticação (chave de validação)

### Fluxo principal
1. Tela inicial: campo para **colar ou digitar chave** + botão "Ativar"
2. Opcional: escanear QR da chave (gestor gera QR com a chave no Manager)
3. App chama endpoint de **verificação de chave** (somente validar, sem ler ingresso ainda)
4. Se válida: armazena chave em Secure Store + exibe nome do evento/equipe
5. Se inválida/expirada/revogada: mensagem clara + não prossegue

### Dados da sessão
- Nome da chave / equipe (`validated_by_name`)
- `event_id` vinculado (ou multi-evento se chave global — conforme backend)
- Validade (`expires_at`)
- Contador de leituras do turno

### Encerrar sessão
- Botão "Encerrar turno" — apaga chave local
- Auto-logout se chave expirar (polling ou 401 da API)
- Não exigir conta pessoal do operador

### Reautenticação
- Mesma aba/sessão: reutilizar chave em memória (como `SESSION_VERIFIED_KEY` no web)
- App fechado: exigir chave novamente (segurança)

---

## Funcionalidades — Fase 1 (MVP)

### 1. Ativação por chave
- Input manual da chave (mascarada)
- Validação contra backend
- Exibir: evento, data, nome da equipe, expiração
- Tratamento de erros: chave inválida, expirada, revogada, sem internet

### 2. Scanner de ingressos
- Câmera fullscreen com moldura de leitura
- Suporte a QR code e código alfanumérico
- Leitura contínua (não precisa tocar entre cada ingresso)
- **Debounce** ~1,5s para não validar duas vezes o mesmo QR
- Alternativa: **entrada manual** do código (teclado grande)
- Toggle lanterna (flash)

### 3. Resultado da validação
- **Sucesso:** tela verde, ✓, nome do titular (se `show_holder_check`), tipo de acesso, som agudo
- **Já utilizado:** amarelo/laranja, horário da entrada anterior
- **Inválido:** vermelho, motivo (não encontrado, evento errado, cancelado, fora da data)
- **Erro de rede:** mensagem + opção tentar de novo
- Campos retornados pela API (alinhar com `ValidationResult` do web):
  - `success`, `message`, `wristband_code`, `validation_type`, `validated_at`
  - `holder_name`, `holder_email_hint`, `holder_cpf_hint` (mascarados)
  - `access_type`, `scanned_via`

### 4. Histórico do turno
- Lista local das últimas 100 validações
- Filtros: todas, hoje, sucesso, erro
- Item: horário, código, resultado, titular
- Limpar histórico (somente local)
- **Não** substitui relatório oficial do gestor — é apoio operacional

### 5. Configurações mínimas
- Volume do som on/off
- Vibração on/off
- Manter tela ligada (sempre on no MVP)
- Versão do app
- Encerrar sessão / trocar chave

### 6. Segurança operacional
- Não exibir chave completa após ativação
- Bloquear screenshots na tela de resultado (opcional Android)
- Timeout de inatividade (30 min) → volta para tela de chave

---

## Funcionalidades — Fase 2

### 7. Modo offline (fila)
- Validar visualmente formato do QR localmente
- Enfileirar leituras sem rede
- Sincronizar quando internet voltar
- Indicador "N validações pendentes de envio"
- Conflito: se ingresso foi usado online enquanto offline → marcar erro na sync

### 8. Múltiplos portões
- Seleção de portão/área (VIP, Pista, Backstage) se gestor configurar
- Estatísticas por portão no turno

### 9. Validação de inscrição gratuita
- Mesmo scanner para QR de inscrição vitrine
- Marcar inscrição como utilizada no dia do evento

### 10. Modo balança / contagem
- Contador em tempo real: entradas válidas no turno
- Meta opcional (ex.: capacidade do setor)

### 11. Leitura de carteira de créditos (opcional)
- Escanear QR da carteira Rush para check-in de consumo
- Separado de ingresso — só se gestor habilitar no evento

---

## Funcionalidades — Fase 3

### 12. Dispositivo dedicado
- Modo quiosque (guided access / pinned app)
- Parear dispositivo com chave via QR one-time
- Telemetria: bateria, última sync, versão app

### 13. Integração hardware
- Leitor Bluetooth de código de barras
- Tablet em suporte com feedback LED via USB (nicho)

---

## Telas (mapa de navegação)

```
Stack simples (sem tabs na operação):

1. Boas-vindas / Inserir chave
2. Confirmar evento e equipe
3. Scanner (tela principal — default após ativar)
4. Resultado (modal ou overlay 2s → volta ao scanner)
5. Histórico do turno (drawer ou botão secundário)
6. Configurações (drawer)
```

**Fluxo ideal:** abrir app → já na câmera se chave válida em cache → beep → próximo.

---

## APIs e integrações (reaproveitar do web)

- Edge Function: **`validate-ticket`**
  - Modo `verify_key_only` — liberar UI antes de ler ingressos (já existe no backend)
  - Modo validação com `api_key` + `wristband_code` + `validation_type`
- Normalização de código: `normalizeValidatorWristbandCode`, `isDynamicEntryQrCode` (`entry-qr.ts`)
- Tabela: `validation_api_keys`, logs de validação
- **Não usar** Supabase Auth de gestor neste app
- Referência de implementação: `src/pages/TicketValidator.tsx`

### Payload típico de validação
```json
{
  "api_key": "chave-da-equipe",
  "wristband_code": "ABC-123",
  "validation_type": "entry",
  "scanned_via": "app"
}
```

---

## Regras de negócio importantes

1. Chave só valida ingressos do **evento vinculado** (salvo chave multi-evento explícita)
2. Ingresso já usado: segunda leitura retorna erro com horário da primeira
3. Ingresso de outro evento: rejeitar com mensagem clara
4. QR dinâmico: aceitar token dentro da janela de validade
5. Respeitar `show_holder_check` — operador confere documento se exigido
6. Registrar `validated_by` com nome da chave/equipe para auditoria
7. Chave revogada pelo gestor: próxima validação falha com "chave inválida"

---

## UX e requisitos não funcionais

- Tempo de feedback &lt; 800ms em rede 4G
- Funcionar em iOS e Android com câmera traseira
- Botões mínimo 56dp de altura
- Fonte grande no resultado (legível a 1 metro)
- pt-BR
- Acessibilidade: feedback sonoro obrigatório (portaria barulhenta)
- Orientação: preferir retrato; paisagem opcional fase 2

---

## Segurança

- Chave em **Expo Secure Store**, nunca AsyncStorage plain
- Certificate pinning para API de validação (fase 2)
- Sem listagem de todos os ingressos do evento — só validação unitária
- Rate limit por chave (backend)
- Logs de tentativas suspeitas no servidor
- App não armazena base completa de participantes

---

## Relação com outros apps

| Ação | App |
|------|-----|
| Gerar/revogar chave | **EventFest Manager** |
| Cliente compra e vê QR | **EventFest Rush** |
| Operador escaneia na portaria | **EventFest Validator** (este) |
| Relatório de entradas | **EventFest Manager** (leitura) |

---

## Fora de escopo deste app

- Login de gestor / dashboard / relatórios financeiros
- Criar eventos ou ingressos
- Venda de ingressos ou PDV completo
- Editar chaves (apenas consumir)
- Admin Master

---

## Critérios de aceite do MVP

- [ ] Ativa sessão com chave válida do Manager
- [ ] Escaneia QR e mostra sucesso/erro em &lt;1s (rede ok)
- [ ] Som e cor distintos para sucesso vs erro
- [ ] Detecta ingresso já utilizado
- [ ] Histórico local do turno (100 itens)
- [ ] Rejeita chave expirada/revogada
- [ ] Encerrar sessão apaga chave
- [ ] Build iOS e Android com permissão de câmera
- [ ] Testado em dispositivo real na portaria (luz baixa)

---

## Prompt final para a IA

```
Crie o projeto mobile EventFest Validator com Expo + TypeScript,
seguindo todas as especificações do documento PROMPT_EVENTFEST_VALIDATOR.md.
Priorize Fase 1 (MVP): ativação por chave, scanner QR, resultado com som/vibração,
histórico local do turno. Integre com a Edge Function validate-ticket do backend
EventFest existente. NÃO use login Supabase de gestor. UI minimalista, botões grandes,
alto contraste. Uma tela principal de câmera após ativar chave. Referência web:
TicketValidator.tsx e validation_api_keys.
```
