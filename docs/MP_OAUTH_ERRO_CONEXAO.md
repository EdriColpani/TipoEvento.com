# Erro MP: "Não foi possível conectar o aplicativo à sua conta"

Essa mensagem aparece **na tela do Mercado Pago** (antes de voltar ao EventFest). O Supabase já abriu a URL de autorização; o MP recusou o vínculo.

## Checklist (ordem)

### 1. Application ID correto (`MP_OAUTH_CLIENT_ID`)

No painel [Developers → sua app → Detalhes](https://www.mercadopago.com.br/developers/panel/app):

- Use o **Número da aplicação** / **Application ID** (só dígitos, ex.: `1234567890123`).
- **Não** use:
  - Public Key (`APP_USR-…`)
  - Access Token de produção/teste
  - Credencial de checkout

Se colocou `APP_USR-…`, o MP mostra exatamente esse erro genérico.

### 2. Redirect URL idêntica nos dois lugares

**No MP** (Detalhes da aplicação → **Redirect URLs**):

```
https://lzsjxepcsgwsnpsjzpcm.supabase.co/functions/v1/mp-oauth-callback
```

**No Supabase** (`MP_OAUTH_REDIRECT_URI`): **o mesmo texto**, caractere por caractere:

- `https` (não `http`)
- sem barra no final
- sem espaços
- projeto Supabase correto (`lzsjxepcsgwsnpsjzpcm`)

### 3. Tipo de aplicação: Marketplace

Ao criar a app, modelo **Marketplace** (split / vendedores). App só de "pagamento próprio" não vincula conta de gestor.

### 4. PKCE alinhado com o painel MP

Em **Detalhes da aplicação → Editar**:

| No painel MP | No Supabase |
|--------------|-------------|
| PKCE **habilitado** | não definir `MP_OAUTH_USE_PKCE` ou `true` (padrão) |
| PKCE **desabilitado** | `MP_OAUTH_USE_PKCE=false` |

```powershell
supabase secrets set MP_OAUTH_USE_PKCE=false --project-ref lzsjxepcsgwsnpsjzpcm
supabase functions deploy mp-oauth-start mp-oauth-callback --project-ref lzsjxepcsgwsnpsjzpcm
```

### 5. Conta que faz login no MP

O gestor deve autorizar com a **conta Mercado Pago da empresa** que receberá ingressos (vendedor), não a conta EventFest integradora.

### 6. Produção vs teste

- App em **produção** → login com conta MP de produção do gestor.
- Teste com usuários de teste do MP → app/credenciais de teste.

## Conferir a URL gerada

No navegador, ao clicar Conectar, a barra de endereço deve parecer com:

```
https://auth.mercadopago.com/authorization?client_id=NUMERO&response_type=code&platform_id=mp&state=...&redirect_uri=https%3A%2F%2Flzsjxepcsgwsnpsjzpcm.supabase.co%2Ffunctions%2Fv1%2Fmp-oauth-callback&code_challenge=...
```

- `client_id` = só números
- `redirect_uri` decodificado = URL do callback acima

## Alternativa imediata

**Ingressos MP → token manual** (Access Token da conta do gestor), se o marketplace já estiver vinculado no painel MP — sem OAuth.

## Referência

- [OAuth — criação e PKCE](https://www.mercadopago.com.br/developers/pt/docs/security/oauth/creation)
- [Detalhes da aplicação / Redirect URL](https://www.mercadopago.com.br/developers/pt/docs/your-integrations/application-details)
