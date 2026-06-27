# Prompts para aplicativos mobile EventFest

Este diretório contém **3 prompts completos** para criação dos projetos mobile (iOS + Android), um por segmento de usuário.

| Arquivo | App | Público |
|---------|-----|---------|
| [PROMPT_EVENTFEST_MANAGER.md](./PROMPT_EVENTFEST_MANAGER.md) | **EventFest Manager** | Gestor / Promotor |
| [PROMPT_EVENTFEST_RUSH.md](./PROMPT_EVENTFEST_RUSH.md) | **EventFest Rush** | Cliente final |
| [PROMPT_EVENTFEST_VALIDATOR.md](./PROMPT_EVENTFEST_VALIDATOR.md) | **EventFest Validator** | Equipe de portaria |

## Como usar

1. Abra o prompt do app desejado.
2. Copie o conteúdo integral para um novo chat de IA ou brief de desenvolvimento.
3. Crie **um repositório GitHub por app** (ou um monorepo com 3 packages — decisão do time).
4. Reutilize o mesmo backend Supabase e Edge Functions do projeto web `tipoevento`.

## Stack recomendada (comum aos 3)

- **Expo (React Native)** ou **Flutter**
- **Supabase** (auth, Postgres, RPC, Edge Functions)
- **TypeScript**
- Push: Expo Notifications / FCM + APNs
- Repositório: **1 projeto = iOS + Android** (pastas `ios/` e `android/` nativas geradas pelo framework)

## O que NÃO entra nestes apps

- Painel **Admin Master** completo (permanece na web)
- Backup de banco, configurações globais da plataforma
- Edição massiva de planos/comissões da plataforma
