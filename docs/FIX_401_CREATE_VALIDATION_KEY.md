# 401 ao criar chave de validação

## Causa

O **gateway** do Supabase devolve **401** no `POST` quando a função está com **Verify JWT = ON** e o JWT não passa na validação do edge (ou o body chega sem Bearer).

## Obrigatório no Dashboard

1. **Supabase** → **Edge Functions** → **`create-validation-key`**
2. Aba **Details** (ou **Settings**)
3. Desligar **Verify JWT** / **Enforce JWT** (nome pode variar)
4. Salvar

Sem isso, o **POST continua 401** antes de rodar o código Deno.

## Deploy

```bash
supabase functions deploy create-validation-key --no-verify-jwt
```

(`--no-verify-jwt` alinha o deploy local com “sem JWT no gateway”.)

## Depois do deploy

- Publicar de novo o front (ou hard refresh).
- A função no repo agora responde **sempre HTTP 200** + `{ success, error }` para o app não quebrar no invoke — mas o **401 do gateway** só some com **Verify JWT OFF** no painel.
