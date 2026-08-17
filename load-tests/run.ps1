# Carrega env.local.ps1 e dispara o k6 com -e (Windows nao herda $env no __ENV se so rodar k6 run).
# Uso (na raiz do repo):
#   powershell -ExecutionPolicy Bypass -File .\load-tests\run.ps1 availability.js

param(
  [Parameter(Position = 0)]
  [string]$Script = "availability.js"
)

$ErrorActionPreference = "Stop"
$here = $PSScriptRoot
$envFile = Join-Path $here "env.local.ps1"

if (-not (Test-Path $envFile)) {
  Write-Host "Falta $envFile. Copie env.local.ps1.example, preencha e salve." -ForegroundColor Red
  exit 1
}

. $envFile

$missing = @()
foreach ($n in @("SUPABASE_URL", "SUPABASE_ANON_KEY", "EVENT_ID")) {
  $v = [Environment]::GetEnvironmentVariable($n, "Process")
  if ([string]::IsNullOrWhiteSpace($v)) { $missing += $n }
}
if ($missing.Count -gt 0) {
  Write-Host "Variaveis vazias em env.local.ps1: $($missing -join ', ')" -ForegroundColor Red
  exit 1
}

function Test-Jwt3Parts([string]$token) {
  if ([string]::IsNullOrWhiteSpace($token)) { return $false }
  return ($token.Trim().Split('.').Count -eq 3)
}

function Get-JwtExpUnix([string]$token) {
  $parts = $token.Trim().Split('.')
  if ($parts.Count -ne 3) { return 0 }
  $payload = $parts[1].Replace('-', '+').Replace('_', '/')
  switch ($payload.Length % 4) {
    2 { $payload += '==' }
    3 { $payload += '=' }
  }
  try {
    $json = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($payload))
    return [int64]($json | ConvertFrom-Json).exp
  } catch {
    return 0
  }
}

function Get-FreshAccessToken {
  $url = ([Environment]::GetEnvironmentVariable("SUPABASE_URL", "Process")).TrimEnd("/")
  $anon = [Environment]::GetEnvironmentVariable("SUPABASE_ANON_KEY", "Process")
  $email = [Environment]::GetEnvironmentVariable("LOADTEST_EMAIL", "Process")
  $pass = [Environment]::GetEnvironmentVariable("LOADTEST_PASSWORD", "Process")
  if ([string]::IsNullOrWhiteSpace($email) -or [string]::IsNullOrWhiteSpace($pass)) {
    return $null
  }
  $endpoint = "$url/auth/v1/token?grant_type=password"
  try {
    $resp = Invoke-RestMethod -Method Post -Uri $endpoint -Headers @{
      apikey = $anon
      Authorization = "Bearer $anon"
    } -ContentType "application/json" -Body (@{ email = $email; password = $pass } | ConvertTo-Json)
  } catch {
    Write-Host "Falha no login LOADTEST_EMAIL/PASSWORD. Confira e-mail e senha do cliente de teste." -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
  }
  if (-not $resp.access_token) {
    Write-Host "Login sem access_token." -ForegroundColor Red
    exit 1
  }
  return [string]$resp.access_token
}

$needsUserJwt = $Script -match "checkout|credit-spend|credit-consumption|verify-integrity"
if ($needsUserJwt) {
  $fresh = Get-FreshAccessToken
  if ($fresh) {
    [Environment]::SetEnvironmentVariable("AUTH_TOKEN", $fresh, "Process")
    [Environment]::SetEnvironmentVariable("AUTH_TOKENS", $fresh, "Process")
    Write-Host "JWT renovado via login (LOADTEST_EMAIL)." -ForegroundColor Green
  }

  $auth = [Environment]::GetEnvironmentVariable("AUTH_TOKEN", "Process")
  $pool = [Environment]::GetEnvironmentVariable("AUTH_TOKENS", "Process")
  if (-not (Test-Jwt3Parts $auth)) {
    $firstGood = $null
    if (-not [string]::IsNullOrWhiteSpace($pool)) {
      $firstGood = $pool.Split(",") | ForEach-Object { $_.Trim() } | Where-Object { Test-Jwt3Parts $_ } | Select-Object -First 1
    }
    if ($firstGood) {
      [Environment]::SetEnvironmentVariable("AUTH_TOKEN", $firstGood, "Process")
      $auth = $firstGood
      Write-Host "AUTH_TOKEN estava incompleto; usando o JWT de AUTH_TOKENS." -ForegroundColor Yellow
    }
  }

  $auth = [Environment]::GetEnvironmentVariable("AUTH_TOKEN", "Process")
  $ok = (Test-Jwt3Parts $auth)
  $now = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
  $exp = if ($ok) { Get-JwtExpUnix $auth } else { 0 }
  if (-not $ok) {
    Write-Host "AUTH_TOKEN/AUTH_TOKENS invalido: JWT precisa ter 3 partes." -ForegroundColor Red
    Write-Host "Preencha LOADTEST_EMAIL e LOADTEST_PASSWORD no env.local.ps1 (conta cliente)." -ForegroundColor Yellow
    exit 1
  }
  if ($exp -gt 0 -and $exp -lt ($now + 60)) {
    Write-Host "JWT expirado. Preencha LOADTEST_EMAIL e LOADTEST_PASSWORD no env.local.ps1 para renovar sozinho." -ForegroundColor Red
    exit 1
  }
}

$scriptPath = if ([IO.Path]::IsPathRooted($Script)) { $Script } else { Join-Path $here $Script }
if (-not (Test-Path $scriptPath)) {
  Write-Host "Script nao encontrado: $scriptPath" -ForegroundColor Red
  exit 1
}

$names = @(
  "SUPABASE_URL", "SUPABASE_ANON_KEY", "AUTH_TOKEN", "AUTH_TOKENS",
  "EVENT_ID", "WRISTBAND_ID", "UNIT_PRICE", "STRESS_VUS", "STRESS_DURATION",
  "VALIDATION_API_KEY", "CONSUMPTION_API_KEY", "WRISTBAND_CODES",
  "DELIVERY_TOKENS", "ESTABLISHMENT_ID", "PRODUCT_ID", "SLEEP_SECONDS",
  "VALIDATION_TYPE", "DELIVERY_ACTION", "PRODUCT_QTY", "WRISTBAND_CODE"
)

$k6Args = @("run", "--include-system-env-vars")
foreach ($n in $names) {
  $v = [Environment]::GetEnvironmentVariable($n, "Process")
  if (-not [string]::IsNullOrWhiteSpace($v)) {
    $k6Args += "-e"
    $k6Args += "${n}=$v"
  }
}
$k6Args += $scriptPath

Write-Host "Rodando k6 $Script com env.local.ps1" -ForegroundColor Cyan
& k6 @k6Args
exit $LASTEXITCODE
