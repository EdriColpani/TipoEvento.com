# Smoke test: chave + ingresso cortesia (UUID do wristband_analytics)
# Uso:
#   .\scripts\smoke-validate-complimentary.ps1 -ApiKey ABCD1234 -AnalyticsId 8a533842-7d21-4302-bd3f-98e2b2a183f7
#   .\scripts\smoke-validate-complimentary.ps1 -ApiKey ABCD1234 -Code "BA43F45F4-000001"
#
# Precisa da anon key publica do projeto (EXPO_PUBLIC_SUPABASE_ANON_KEY / VITE).

param(
  [Parameter(Mandatory = $true)][string]$ApiKey,
  [string]$AnalyticsId = "",
  [string]$Code = "",
  [string]$ProjectUrl = "https://lzsjxepcsgwsnpsjzpcm.supabase.co",
  [string]$AnonKey = ""
)

$ErrorActionPreference = "Stop"

if (-not $AnonKey) {
  $envFile = Join-Path (Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)) ".env"
  if (Test-Path $envFile) {
    $line = Get-Content $envFile | Where-Object { $_ -match "^(VITE_SUPABASE_ANON_KEY|EXPO_PUBLIC_SUPABASE_ANON_KEY)=" } | Select-Object -First 1
    if ($line) {
      $AnonKey = ($line -split "=", 2)[1].Trim().Trim('"').Trim("'")
    }
  }
}

if (-not $AnonKey) {
  throw "Informe -AnonKey ou coloque VITE_SUPABASE_ANON_KEY / EXPO_PUBLIC_SUPABASE_ANON_KEY no .env do tipoevento."
}

$wristband = if ($Code) { $Code.Trim() } elseif ($AnalyticsId) { $AnalyticsId.Trim() } else {
  throw "Informe -AnalyticsId (UUID) ou -Code (ex: BA43F45F4-000001)."
}

$headers = @{
  "Content-Type"  = "application/json"
  "Authorization" = "Bearer $AnonKey"
  "apikey"        = $AnonKey
  "x-api-key"     = $ApiKey.Trim()
}

$fn = "$ProjectUrl/functions/v1/validate-ticket"

Write-Host "==> 1) verify_key_only" -ForegroundColor Cyan
$sw = [System.Diagnostics.Stopwatch]::StartNew()
try {
  $verify = Invoke-RestMethod -Method Post -Uri $fn -Headers $headers -Body (@{ verify_key_only = $true } | ConvertTo-Json) -TimeoutSec 40
  $sw.Stop()
  Write-Host ("OK em {0} ms" -f $sw.ElapsedMilliseconds) -ForegroundColor Green
  $verify | ConvertTo-Json -Depth 6
} catch {
  $sw.Stop()
  Write-Host ("FALHOU em {0} ms: {1}" -f $sw.ElapsedMilliseconds, $_.Exception.Message) -ForegroundColor Red
  if ($_.ErrorDetails.Message) { Write-Host $_.ErrorDetails.Message }
  exit 1
}

Write-Host "`n==> 2) validacao auto do ingresso: $wristband" -ForegroundColor Cyan
$sw = [System.Diagnostics.Stopwatch]::StartNew()
$body = @{
  wristband_code  = $wristband
  validation_type = "auto"
} | ConvertTo-Json
try {
  $result = Invoke-RestMethod -Method Post -Uri $fn -Headers $headers -Body $body -TimeoutSec 40
  $sw.Stop()
  Write-Host ("OK em {0} ms" -f $sw.ElapsedMilliseconds) -ForegroundColor Green
  $result | ConvertTo-Json -Depth 6
} catch {
  $sw.Stop()
  Write-Host ("FALHOU em {0} ms: {1}" -f $sw.ElapsedMilliseconds, $_.Exception.Message) -ForegroundColor Red
  if ($_.ErrorDetails.Message) { Write-Host $_.ErrorDetails.Message -ForegroundColor Yellow }
  # Tenta ler corpo HTTP 4xx
  try {
    $resp = $_.Exception.Response
    if ($resp) {
      $reader = New-Object System.IO.StreamReader($resp.GetResponseStream())
      $reader.BaseStream.Position = 0
      Write-Host $reader.ReadToEnd() -ForegroundColor Yellow
    }
  } catch {}
  exit 1
}

Write-Host "`nSe success=true e message com Entrada/cortesia: backend OK. Se o app ainda falha, e rede/Expo Go ou chave de outro evento." -ForegroundColor Cyan
