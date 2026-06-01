# Alinha supabase_migrations.schema_migrations com o banco remoto.
#
# Modo 1 (recomendado após diagnostic): marcar um intervalo como já aplicado
#   .\align-migrations-repair.ps1 -FromVersion 20260316000004 -ToVersion 20260630160000
#
# Modo 2: marcar UMA migration (quando db push falhou com "already exists")
#   .\align-migrations-repair.ps1 -SingleVersion 20260316000004
#
# Depois: supabase db push --linked --yes

param(
    [string]$FromVersion = '',
    [string]$ToVersion = '',
    [string]$SingleVersion = ''
)

$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent | Split-Path -Parent)

$migrationsDir = Join-Path $PSScriptRoot '..\migrations'
$files = Get-ChildItem $migrationsDir -Filter '*.sql' |
    Where-Object { $_.Name -match '^(\d{14})_' } |
    Sort-Object Name

$versions = @($files | ForEach-Object {
    if ($_.Name -match '^(\d{14})_') { $Matches[1] }
})

if ($SingleVersion) {
    $toRepair = @($SingleVersion)
} elseif ($FromVersion -and $ToVersion) {
    $toRepair = $versions | Where-Object { $_ -ge $FromVersion -and $_ -le $ToVersion }
} else {
    Write-Host 'Informe -SingleVersion ou -FromVersion e -ToVersion.' -ForegroundColor Yellow
    exit 1
}

Write-Host "Marcando $($toRepair.Count) migration(s) como applied no remoto..." -ForegroundColor Cyan

foreach ($v in $toRepair) {
    Write-Host "  repair applied $v"
    supabase migration repair --status applied $v --linked --yes
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Falha em $v" -ForegroundColor Red
        exit $LASTEXITCODE
    }
}

Write-Host ''
Write-Host 'Concluído. Próximo passo:' -ForegroundColor Green
Write-Host '  supabase db push --linked --yes'
