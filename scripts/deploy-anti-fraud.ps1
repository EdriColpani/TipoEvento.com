# Deploy operacional — Anti-fraude (migrations + edge functions + build front)
# Uso (PowerShell, na raiz do repo):
#   .\scripts\deploy-anti-fraud.ps1
# Requer: supabase CLI logado (`supabase login`) e projeto linkado (`supabase link`).

$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)

Write-Host '==> 1/3 Migrations (supabase db push)' -ForegroundColor Cyan
supabase db push
if ($LASTEXITCODE -ne 0) {
    Write-Host 'Falha em db push. Verifique login/link do Supabase.' -ForegroundColor Red
    exit 1
}

Write-Host '==> 2/3 Edge functions' -ForegroundColor Cyan
$functions = @(
    'run-ticket-inactivity-monthly-job',
    'run-ticket-inactivity-auto-deactivate-job',
    'create-ticket-inactivity-checkout',
    'mercadopago-webhook'
)
foreach ($fn in $functions) {
    Write-Host "Deploy: $fn"
    supabase functions deploy $fn
    if ($LASTEXITCODE -ne 0) { exit 1 }
}

Write-Host '==> 3/3 Build front (dist/)' -ForegroundColor Cyan
npm run build
if ($LASTEXITCODE -ne 0) { exit 1 }

Write-Host ''
Write-Host 'Deploy local concluido.' -ForegroundColor Green
Write-Host 'Proximos passos manuais:'
Write-Host '  - Publicar pasta dist/ no host (Vercel/Netlify/servidor)'
Write-Host '  - Admin > Preços e comissões > Inatividade > Verificar deploy'
Write-Host '  - Homologar docs/CHECKLIST_TESTES_ANTI_FRAUDE.md (secoes A-E)'
Write-Host '  - Secrets: RESEND_API_KEY, SITE_URL, credenciais MP'
