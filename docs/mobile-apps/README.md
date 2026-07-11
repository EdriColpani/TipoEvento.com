# Prompts para aplicativos mobile EventFest

Este diretório contém prompts para os projetos mobile (iOS + Android).

| Arquivo | Uso | Público |
|---------|-----|---------|
| [PROMPT_EVENTFEST_RUSH_GESTOR_INTEGRATION.md](./PROMPT_EVENTFEST_RUSH_GESTOR_INTEGRATION.md) | **Preferencial** — integrar Modo Gestor no app do cliente já existente (app único) | Cliente + Gestor |
| [PROMPT_EVENTFEST_RUSH.md](./PROMPT_EVENTFEST_RUSH.md) | App cliente (baseline) | Cliente final |
| [PROMPT_EVENTFEST_MANAGER.md](./PROMPT_EVENTFEST_MANAGER.md) | Histórico — app gestor separado (substituído pela integração acima) | Gestor / Promotor |
| [PROMPT_EVENTFEST_VALIDATOR.md](./PROMPT_EVENTFEST_VALIDATOR.md) | **Criar do zero** o app de portaria (paridade com `/validator` web) | Equipe de validação |

## Como usar

1. **App único (recomendado agora):** abra `PROMPT_EVENTFEST_RUSH_GESTOR_INTEGRATION.md`, copie o conteúdo (ou o bloco “Prompt final”) no chat do repositório mobile do cliente.
2. **Validador:** use `PROMPT_EVENTFEST_VALIDATOR.md` em repositório separado.
3. Reutilize o mesmo backend Supabase e Edge Functions do projeto web `tipoevento`.

## Stack recomendada

- **Expo (React Native)** + **TypeScript**
- **Supabase** (auth, Postgres, RPC, Edge Functions)
- Push: Expo Notifications / FCM + APNs
- React Query + React Navigation

## O que NÃO entra nos apps mobile

- Painel **Admin Master** completo (permanece na web)
- Backup de banco, configurações globais da plataforma
- Edição massiva de planos/comissões da plataforma
