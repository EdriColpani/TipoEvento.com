# Deploy das Edge Functions da portaria (entrada/saída + QR dinâmico / cortesia)
# Uso (PowerShell, na pasta do tipoevento):
#   .\scripts\deploy-validator-gate.ps1
#   .\scripts\deploy-validator-gate.ps1 -ProjectRef lzsjxepcsgwsnpsjzpcm
#
# Pré-requisitos:
#   1) Supabase CLI instalado: https://supabase.com/docs/guides/cli
#   2) Login: supabase login
#   3) Estar em c:\V3\tipoevento (ou ajuste $Root)

param(
  [string]$ProjectRef = "lzsjxepcsgwsnpsjzpcm",
  [switch]$SkipIssueEntryToken
)

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

Write-Host "==> Pasta: $Root" -ForegroundColor Cyan
Write-Host "==> Projeto: $ProjectRef" -ForegroundColor Cyan

if (-not (Get-Command supabase -ErrorAction SilentlyContinue)) {
  Write-Host "Supabase CLI nao encontrado no PATH." -ForegroundColor Red
  Write-Host "Instale com:  scoop install supabase   OU   npm i -g supabase" -ForegroundColor Yellow
  Write-Host "Depois: supabase login" -ForegroundColor Yellow
  exit 1
}

Write-Host "`n==> Versao CLI:" -ForegroundColor Cyan
supabase --version

$validateLocal = Join-Path $Root "supabase\functions\validate-ticket\index.ts"
$issueLocal = Join-Path $Root "supabase\functions\issue-entry-token\index.ts"

if (-not (Test-Path $validateLocal)) {
  throw "Arquivo nao encontrado: $validateLocal"
}
if (-not (Select-String -Path $validateLocal -Pattern "complimentary_redemption" -Quiet)) {
  throw "validate-ticket local NAO contem complimentary_redemption. Atualize o arquivo antes do deploy."
}
if (-not (Select-String -Path $validateLocal -Pattern "isGateCycleEventType" -Quiet)) {
  throw "validate-ticket local NAO contem isGateCycleEventType."
}

Write-Host "`n==> Deploy validate-ticket (verify_jwt=true)..." -ForegroundColor Cyan
supabase functions deploy validate-ticket --project-ref $ProjectRef

if (-not $SkipIssueEntryToken) {
  if (-not (Test-Path $issueLocal)) {
    throw "Arquivo nao encontrado: $issueLocal"
  }
  if (-not (Select-String -Path $issueLocal -Pattern "complimentary_redemption" -Quiet)) {
    throw "issue-entry-token local NAO contem complimentary_redemption."
  }
  Write-Host "`n==> Deploy issue-entry-token (verify_jwt=true)..." -ForegroundColor Cyan
  supabase functions deploy issue-entry-token --project-ref $ProjectRef
}

Write-Host "`n==> Conferir funcoes no projeto:" -ForegroundColor Cyan
supabase functions list --project-ref $ProjectRef

Write-Host "`nPronto. Teste no app:" -ForegroundColor Green
Write-Host "  1) Abra o ingresso cortesia de novo (QR fresco)"
Write-Host "  2) No validador, use a chave de PORTARIA do MESMO evento"
Write-Host "  3) Escaneie o QR"
Write-Host "`nSmoke test opcional:"
Write-Host "  .\scripts\smoke-validate-complimentary.ps1 -ApiKey SUA_CHAVE_8 -AnalyticsId 8a533842-7d21-4302-bd3f-98e2b2a183f7"
