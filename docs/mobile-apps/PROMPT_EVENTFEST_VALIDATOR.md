# PROMPT — Criar o app EventFest Validator (do zero)

> **Status:** o app mobile **ainda não existe**. Este documento é o brief para **criar o projeto do zero**.
> **Uso:** copie este documento **integralmente** em um chat/repositório **novo** (não no app Rush/cliente).
> **Repositório a criar:** `eventfest-validator` (1 repo Expo, iOS + Android).
> **App separado:** não misturar com EventFest Rush (cliente/gestor) nem com o painel web.
> **Backend (já existe):** mesmo Supabase do web EventFest (`tipoevento`) — só consumir; não recriar a Edge.
>
> **Referência funcional (web já pronto — o mobile deve ficar igual):**
> - Página: `src/pages/TicketValidator.tsx` — rotas `/validator` e `/validador`
> - Edge Function: `supabase/functions/validate-ticket/index.ts`
> - Normalização QR: `src/constants/entry-qr.ts` (+ `_shared/entry-qr-token.ts` no backend)
> - Chaves geradas no gestor: `src/pages/ManagerValidationKeys.tsx` + Edge `create-validation-key`
> - PWA web: `docs/VALIDADOR_INSTALAR_CELULAR.md` (hoje a portaria usa o site; o app nativo substitui/complementa)

---

## Contexto

Hoje a portaria usa o **validador web** (PWA em `/validator`). Você vai **criar um app nativo novo** (Expo) com **paridade total** dessas rotinas.

O operador de portaria:

1. Digita a **chave de 8 caracteres** gerada pelo gestor.
2. Toca em **Validar** (só a chave — `verify_key_only`).
3. Escolhe **Entrada** ou **Saída**.
4. Digita o código **ou** escaneia o QR do ingresso.
5. Vê resultado (sucesso/erro), ouve som, e o item entra no **histórico local**.

**Não** usa login Supabase de gestor/cliente. Autenticação = API key de validação (`x-api-key`).

---

## Bootstrap do projeto (criar do zero)

1. Criar app Expo (TypeScript, managed workflow).
2. Nome de exibição: **EventFest Validator** (ou “Validador EventFest”).
3. Bundle IDs sugeridos: `com.eventfest.validator` (ajustar conforme conta).
4. Permissões: **câmera** (scanner QR); manter tela ligada durante uso.
5. Variáveis de ambiente:
   - `EXPO_PUBLIC_SUPABASE_URL`
   - `EXPO_PUBLIC_SUPABASE_ANON_KEY`
6. Estrutura mínima sugerida:
   - `src/screens/` — Chave, Validação, Histórico (ou uma tela única como o web)
   - `src/api/validateTicket.ts` — chamadas à Edge
   - `src/utils/entryQr.ts` — copiar lógica de `normalizeValidatorWristbandCode` / `EF1.`
   - `src/storage/` — chave, sessão liberada, som, histórico
   - `src/theme/` — preto + amarelo EventFest
7. EAS Build para iOS e Android.
8. **Não** clonar o monorepo web como app — projeto mobile independente que só chama a API.

---

## Stack técnica

- **Expo (React Native) + TypeScript**
- Câmera QR (ex.: `expo-camera` / `vision-camera` + leitor QR)
- `fetch` HTTP para Edge `validate-ticket` (anon key no header Authorization; chave do operador em `x-api-key`)
- Secure Store / storage local para chave, preferência de som e histórico (equivalente ao `localStorage` / `sessionStorage` do web)
- Som de sucesso/erro (equivalente ao `AudioContext` do web)
- Tema: fundo preto, acento amarelo EventFest, botões grandes

---

## Rotinas do web — espelhar 1:1

### 1. Chave de acesso (8 caracteres)

**UI (igual web)**
- Input centralizado, fonte mono grande, `tracking` largo.
- Aceitar **somente A–Z e 0–9**, forçar **maiúsculas**, `maxLength = 8`.
- Placeholder: `Digite a chave de 8 caracteres (ex: A7K9M2X1)`.
- Botão **Validar** ao lado (desabilitado se `length !== 8` ou enquanto verifica).
- Enter no campo dispara a mesma verificação.
- Textos de ajuda:
  - &lt; 8 chars: “Digite N caractere(s) restante(s)…”
  - = 8 e ainda não verificada: “Toque em **Validar** para liberar entrada/saída…”
  - Verificada: “✓ Chave confirmada · {event_title}. Agora valide os ingressos abaixo.”

**Persistência (igual web)**
- Salvar chave em storage persistente (`validator_api_key`) ao digitar/confirmar.
- “Liberado” da sessão: equivalente a `sessionStorage` `validator_verified_api_key` — **mesma chave** reabre liberada na mesma sessão do app; **fechar app / limpar sessão** exige Validar de novo.
- Ao mudar a chave (texto diferente), invalidar o estado “liberado”.

**API — verificar só a chave**
```
POST {SUPABASE_URL}/functions/v1/validate-ticket
Headers:
  Content-Type: application/json
  Authorization: Bearer {ANON_KEY}
  apikey: {ANON_KEY}
  x-api-key: {CHAVE_8_CHARS}
Body:
  { "verify_key_only": true }
```

**Resposta sucesso (200)**
```json
{
  "success": true,
  "message": "Chave de acesso válida.",
  "validated_by": "Nome da equipe",
  "event_title": "Título do evento ou null",
  "event_id": "uuid ou null"
}
```

**Falha:** chave inválida, inativa ou expirada → mensagem `error` ou `message`; não liberar UI de ingresso.

Área de validação de ingresso fica **opaca/desabilitada** até `keyVerified === true` (no web: `opacity-45`).

---

### 2. Preferência de som

- Toggle Volume on/off no header da chave (ícone Volume2 / VolumeX).
- Persistir `validator_sound_enabled` (`true` default).
- Sucesso: tom ~800 Hz sine ~0,3s.
- Erro: tom ~400 Hz sawtooth ~0,2s.
- Se áudio indisponível, falhar em silêncio (não quebrar fluxo).

---

### 3. Tipo de validação: Entrada / Saída

- Dois botões exclusivos (igual web):
  - **Entrada** → `validation_type: "entry"` (verde quando ativo)
  - **Saída** → `validation_type: "exit"` (vermelho quando ativo)
- Default: `entry`.
- Desabilitados até chave confirmada.

---

### 4. Código do ingresso (manual)

- Input mono; placeholder: `Código do ingresso ou escaneie o QR`.
- Regras de digitação (igual web):
  - Se começar com `EF1.` (QR dinâmico): **não** forçar `toUpperCase` (case-sensitive).
  - Caso contrário: maiúsculas.
- Submit do formulário chama validação.
- Após **sucesso**, limpar o campo do código.

**Normalização antes de enviar** (copiar `normalizeValidatorWristbandCode`):
1. `trim`
2. Se `startsWith("EF1.")` → manter como está
3. Se for UUID → manter como está
4. Senão → `toUpperCase()`

Prefixo dinâmico: `EF1` (constante `ENTRY_QR_PREFIX`).

---

### 5. Scanner QR (câmera)

- Botão **Escanear QR Code** (azul no web) — só com chave confirmada.
- Preferir câmera traseira (`environment`); fallback frontal (`user`).
- Ao decodificar:
  1. Parar scanner
  2. Normalizar código
  3. Preencher campo
  4. Chamar validação (~300ms depois)
- Botão **Parar** enquanto escaneia.
- Erros de permissão: mensagem pedindo câmera / HTTPS (no mobile: permissão do SO).
- Limpar câmera ao sair da tela.

---

### 6. Validar ingresso (API principal)

```
POST {SUPABASE_URL}/functions/v1/validate-ticket
Headers:
  Content-Type: application/json
  Authorization: Bearer {ANON_KEY}
  apikey: {ANON_KEY}
  x-api-key: {CHAVE_8_CHARS}
Body:
  {
    "wristband_code": "<código normalizado>",
    "validation_type": "entry" | "exit"
  }
```

**Pré-checagens no app (igual web)**
- Sem chave confirmada → “Toque em Validar ao lado da chave…”
- Sem chave / sem código → erro amigável
- Loading `isValidating` no botão (“Validando…”)

**Mapear resposta para `ValidationResult`:**

| Campo | Tipo | Uso |
|-------|------|-----|
| `success` | boolean | Verde / vermelho |
| `message` / `error` | string | Texto principal |
| `error_code` | string? | Mensagens amigáveis |
| `wristband_code` | string | Código |
| `validation_type` | string | entry/exit |
| `validated_at` | ISO string | Histórico |
| `validated_by` | string | Nome da chave/equipe |
| `holder_name` | string\|null | Titular |
| `holder_email_hint` | string\|null | E-mail mascarado |
| `holder_cpf_hint` | string\|null | CPF mascarado |
| `show_holder_check` | boolean | Exibir bloco “confira documento” |
| `access_type` | string\|null | Tipo de acesso (VIP, etc.) |
| `scanned_via` | `'app' \| 'printed' \| null` | Origem do QR |
| `inscription_confirmed` | boolean? | Inscrição gratuita confirmada |

Se faltar `id` / `validated_at` / `validated_by`, gerar localmente (como o web).

**Mensagens amigáveis por `error_code` (igual web):**

| `error_code` | Mensagem |
|--------------|----------|
| `qr_expired` | QR expirado — cliente deve abrir o ingresso no app novamente. |
| `qr_revoked` | QR revogado — cliente deve abrir o ingresso no app novamente. |
| `qr_owner_mismatch` | QR não é do titular — peça ao comprador abrir o ingresso na própria conta do app. |
| `qr_invalid` | QR inválido ou adulterado. |
| `qr_malformed` | QR inválido. |
| `digital_only` | Evento só aceita QR do aplicativo do cliente. |
| `subscription_lapsed` | Assinatura do evento vencida. O gestor deve renovar a mensalidade no painel. |

**Feedback**
- Sucesso: toast/alerta verde + som sucesso + limpar código
- Erro: toast/alerta vermelho + som erro
- Sempre gravar no histórico local (sucesso e erro, inclusive erro de rede)

---

### 7. Card de resultado (último)

Exibir após cada tentativa (igual web):
- Ícone ✓ / ✗
- Mensagem
- Código do ingresso
- Tipo (Entrada/Saída)
- Horário formatado pt-BR
- Se `show_holder_check` e houver titular: nome, hints de e-mail/CPF, tipo de acesso, `scanned_via` (app vs impresso)
- Cores: sucesso verde; falha vermelho

---

### 8. Histórico local do turno

**Storage:** chave `validator_history` (JSON), máximo **100** itens (mais recente primeiro).

**Cada item = `ValidationResult` completo.**

**UI**
- Lista com busca por código ou mensagem
- Filtros: `all` | `today` | `week` | `success` | `error`
- Item: horário, código, mensagem, sucesso/erro
- Botão **Limpar histórico** com confirmação (“Tem certeza…?”)
- Histórico é **só operacional local** — não substitui relatório do gestor (`validation_logs` no servidor)

---

### 9. Regras de negócio que o backend já aplica (app só exibe)

O app **não** reimplementa a lógica; só chama a Edge. Conhecer para UX:

1. Chave vinculada a `event_id` (ou null = escopo conforme backend) — só ingressos daquele evento.
2. Compra paga (`purchase` / equivalentes): entrada só com status `active`; após entrada vira `used`; segunda entrada → “já utilizado”.
3. Inscrição gratuita (`free_registration`): na entrada bem-sucedida confirma `event_registrations.confirmed`.
4. Saída (`exit`): regras distintas (ingresso já usado / liberado).
5. QR dinâmico `EF1.…`: token com TTL; expirado/revogado/dono errado → `error_code` acima.
6. Evento `allow_printed_tickets = false` → pode rejeitar código impresso (`digital_only`).
7. Assinatura listing vencida → `subscription_lapsed`.
8. Titular: se `validator_show_holder` do evento permitir, retorna nome/hints.
9. Movimentações em `wristband_movements` + logs em `validation_logs` (servidor).
10. Debounce servidor: mesma movimentação &lt; 1s não duplica.

---

### 10. O que o gestor faz (fora deste app — só referência)

No **Manager** (`/manager/validation-keys`):
- Criar chave (nome equipe, evento, validade)
- Ver chave **uma vez** (copiar / WhatsApp)
- Ativar/desativar, editar, ver logs (`validation_logs`)
- Equipe usa **este** Validator com a chave de 8 chars

O app Validator **não** cria/edita chaves.

---

## Telas (mapa — igual fluxo web)

```
1. Header “Validador de Ingressos”
2. Card Chave de Acesso (+ toggle som)
3. Card Validar Ingresso (bloqueado até chave OK)
     - Entrada | Saída
     - Campo código
     - Validar ingresso | Escanear QR
     - Preview câmera quando escaneando
4. Card último resultado
5. Card Histórico (busca + filtros + limpar)
```

Fluxo feliz: chave → Validar → Entrada → Escanear → resultado → próximo.

---

## Configuração do app

Variáveis (iguais ao web):
- `EXPO_PUBLIC_SUPABASE_URL` / equivalente = `VITE_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY` = publishable/anon key

**Nunca** embutir `service_role`.

---

## UX / NFR (como o web + mobile)

- pt-BR
- Tema escuro + amarelo
- Botões grandes (mín. ~44–56pt)
- Resultado legível à distância
- Sem spinner infinito: timeout de rede (~15s) + mensagem
- Manter tela ligada durante operação (recomendado no mobile)
- Permissão de câmera pedida só ao escanear

---

## Segurança

- Chave em Secure Store (não logar em analytics)
- Não listar ingressos do evento — só validação unitária
- Não usar Auth de gestor
- Após ativar, não precisar exibir a chave completa o tempo todo (opcional mascarar; web mostra no input)

---

## Fora de escopo (não está no validador web hoje)

- Login de gestor / dashboard / financeiro
- Criar eventos, lotes, chaves
- PDV / carteira de créditos / consumo
- Modo offline com fila (não existe no web atual — não priorizar no MVP)
- Multi-portão configurável
- Hardware Bluetooth dedicado

Se for fase futura, documentar à parte — **MVP = paridade com `TicketValidator.tsx`**.

---

## Critérios de aceite (paridade web)

- [ ] Chave 8 chars A–Z0–9, maiúsculas, max 8
- [ ] `verify_key_only` libera UI e mostra `event_title`
- [ ] Sem chave confirmada, validação/scan bloqueados
- [ ] Entrada e Saída enviam `validation_type` correto
- [ ] Manual + câmera QR com normalização `EF1.` / UUID / UPPER
- [ ] Sucesso limpa código + som; erro mantém feedback + som
- [ ] `error_code` mapeado para as 7 mensagens amigáveis
- [ ] Resultado mostra titular quando `show_holder_check`
- [ ] Histórico local 100 itens, filtros all/today/week/success/error, busca, limpar
- [ ] Preferência de som persistida
- [ ] Chave persistida; “liberado” só na sessão atual
- [ ] Build iOS/Android com câmera; testado em luz baixa

---

## Prompt final para a IA

```
O app mobile EventFest Validator AINDA NÃO EXISTE. Crie o projeto DO ZERO
(Expo + TypeScript + EAS), repositório novo eventfest-validator.

Paridade TOTAL com o validador WEB já existente no EventFest (tipoevento):
- src/pages/TicketValidator.tsx (/validator, /validador)
- supabase/functions/validate-ticket/index.ts
- src/constants/entry-qr.ts
- docs/mobile-apps/PROMPT_EVENTFEST_VALIDATOR.md (este documento completo)

Passos:
1) Scaffold Expo (TS), tema preto + amarelo, permissão de câmera
2) Env: SUPABASE_URL + ANON_KEY (nunca service_role)
3) Implementar TODAS as rotinas do web:
   - Chave 8 chars + Validar (verify_key_only) + event_title
   - Persistência chave + sessão “liberada”
   - Toggle som sucesso/erro
   - Entrada/Saída (entry|exit)
   - Código manual + scanner QR
   - POST validate-ticket (Bearer anon + x-api-key)
   - ValidationResult + error_code amigáveis
   - Card resultado (titular, access_type, scanned_via)
   - Histórico local 100 itens (filtros + limpar)
4) Build iOS e Android via EAS

NÃO use login Supabase de gestor.
NÃO misture com o app Rush/cliente.
NÃO invente offline/PDV/créditos no MVP.
UI: botões grandes, pt-BR, uma mão na portaria.
```
