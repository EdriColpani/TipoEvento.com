# Script de Backup do Banco de Dados Supabase
# Uso: .\scripts\backup-database.ps1 [-Method <supabase-cli|pg_dump>] [-BackupDir <caminho>]

param(
    [ValidateSet("supabase-cli", "pg_dump")]
    [string]$Method = "supabase-cli",
    
    [string]$BackupDir = ".\backups",
    
    [switch]$Compress,
    
    [switch]$Help
)

# Exibir ajuda
if ($Help) {
    Write-Host @"
Script de Backup do Banco de Dados Supabase

USO:
    .\scripts\backup-database.ps1 [OPÇÕES]

OPÇÕES:
    -Method <supabase-cli|pg_dump>
        Método de backup a ser usado:
        - supabase-cli: Usa Supabase CLI (requer: supabase CLI instalado e autenticado)
        - pg_dump: Usa pg_dump diretamente (requer: PostgreSQL client instalado)

    -BackupDir <caminho>
        Diretório onde os backups serão salvos (padrão: .\backups)

    -Compress
        Comprimir o backup após criação (cria arquivo .zip)

    -Help
        Exibe esta mensagem de ajuda

EXEMPLOS:
    .\scripts\backup-database.ps1
    .\scripts\backup-database.ps1 -Method pg_dump -Compress
    .\scripts\backup-database.ps1 -BackupDir "C:\Backups\Supabase"

"@
    exit 0
}

# Configurações do projeto
$ProjectRef = "yzwfjyejqvawhooecbem"
$DatabaseName = "postgres"

# Criar diretório de backups se não existir
if (-not (Test-Path $BackupDir)) {
    Write-Host "Criando diretório de backups: $BackupDir" -ForegroundColor Yellow
    New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null
}

# Gerar nome do arquivo com timestamp
$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$backupFile = Join-Path $BackupDir "backup_$timestamp.sql"

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "  BACKUP DO BANCO DE DADOS SUPABASE" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan
Write-Host "Método: $Method" -ForegroundColor White
Write-Host "Destino: $backupFile" -ForegroundColor White
Write-Host ""

# Executar backup baseado no método escolhido
try {
    if ($Method -eq "supabase-cli") {
        Write-Host "Verificando Supabase CLI..." -ForegroundColor Yellow
        
        # Verificar se supabase CLI está instalado
        $supabaseInstalled = Get-Command supabase -ErrorAction SilentlyContinue
        if (-not $supabaseInstalled) {
            Write-Host "ERRO: Supabase CLI não encontrado!" -ForegroundColor Red
            Write-Host "Instale com: npm install -g supabase" -ForegroundColor Yellow
            Write-Host "Ou acesse: https://supabase.com/docs/reference/cli/introduction" -ForegroundColor Yellow
            exit 1
        }
        
        Write-Host "Executando backup via Supabase CLI..." -ForegroundColor Green
        supabase db dump -f $backupFile --project-ref $ProjectRef
        
        if ($LASTEXITCODE -ne 0) {
            throw "Falha ao executar backup via Supabase CLI"
        }
        
    } elseif ($Method -eq "pg_dump") {
        Write-Host "Verificando pg_dump..." -ForegroundColor Yellow
        
        # Verificar se pg_dump está instalado
        $pgDumpInstalled = Get-Command pg_dump -ErrorAction SilentlyContinue
        if (-not $pgDumpInstalled) {
            Write-Host "ERRO: pg_dump não encontrado!" -ForegroundColor Red
            Write-Host "Instale PostgreSQL client tools:" -ForegroundColor Yellow
            Write-Host "  https://www.postgresql.org/download/windows/" -ForegroundColor Yellow
            exit 1
        }
        
        # Solicitar credenciais
        Write-Host "`n========================================" -ForegroundColor Cyan
        Write-Host "  CONFIGURAÇÃO NECESSÁRIA" -ForegroundColor Cyan
        Write-Host "========================================`n" -ForegroundColor Cyan
        
        Write-Host "Para usar pg_dump, você precisa da senha do banco de dados." -ForegroundColor Yellow
        Write-Host ""
        Write-Host "Como obter/resetar a senha:" -ForegroundColor White
        Write-Host "  1. Acesse: https://supabase.com/dashboard" -ForegroundColor Gray
        Write-Host "  2. Vá em Settings > Database" -ForegroundColor Gray
        Write-Host "  3. Role até 'Database Password'" -ForegroundColor Gray
        Write-Host "  4. Clique em 'Reset Database Password'" -ForegroundColor Gray
        Write-Host "  5. COPIE E SALVE A SENHA (você não poderá vê-la novamente!)" -ForegroundColor Red
        Write-Host ""
        Write-Host "Ou copie a Connection String completa em:" -ForegroundColor White
        Write-Host "  Settings > Database > Connection string" -ForegroundColor Gray
        Write-Host ""
        Write-Host "Você pode:" -ForegroundColor White
        Write-Host "  [1] Colar a Connection String completa (recomendado)" -ForegroundColor Gray
        Write-Host "  [2] Digitar as informações manualmente" -ForegroundColor Gray
        Write-Host ""
        $choice = Read-Host "Escolha uma opção (1 ou 2)"
        
        if ($choice -eq "1") {
            # Opção 1: Colar connection string completa
            Write-Host "`nCole a Connection String completa do Supabase Dashboard:" -ForegroundColor Yellow
            Write-Host "(Formato: postgresql://usuario:senha@host:porta/database)" -ForegroundColor Gray
            $connectionString = Read-Host "Connection String"
            
            # Extrair informações da connection string
            if ($connectionString -match 'postgresql://([^:]+):([^@]+)@([^:]+):(\d+)/(.+)') {
                $userName = $matches[1]
                $password = $matches[2]
                $hostName = $matches[3]
                $port = $matches[4]
                $databaseName = $matches[5]
                
                Write-Host "`n✓ Informações extraídas com sucesso!" -ForegroundColor Green
                Write-Host "  Host: $hostName" -ForegroundColor Gray
                Write-Host "  Porta: $port" -ForegroundColor Gray
                Write-Host "  Usuário: $userName" -ForegroundColor Gray
                Write-Host "  Database: $databaseName" -ForegroundColor Gray
                Write-Host ""
            } else {
                Write-Host "ERRO: Connection String inválida!" -ForegroundColor Red
                Write-Host "Formato esperado: postgresql://usuario:senha@host:porta/database" -ForegroundColor Yellow
                exit 1
            }
        } else {
            # Opção 2: Digitar manualmente
            Write-Host ""
            $hostName = Read-Host "Host (ex: aws-1-sa-east-1.pooler.supabase.com)"
            $port = Read-Host "Porta (padrão: 5432)" 
            if ([string]::IsNullOrWhiteSpace($port)) { $port = "5432" }
            
            $userName = Read-Host "Usuário (ex: postgres.yzwfjyejqvawhooecbem)"
            
            $securePassword = Read-Host "Senha" -AsSecureString
            $password = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
                [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
            )
            
            # Usar database padrão se não foi extraído da connection string
            if (-not $databaseName) {
                $databaseName = $DatabaseName
            }
        }
        
        Write-Host "`nExecutando backup via pg_dump..." -ForegroundColor Green
        
        # Configurar variável de ambiente para senha
        $env:PGPASSWORD = $password
        
        # Executar pg_dump
        $dbName = if ($databaseName) { $databaseName } else { $DatabaseName }
        pg_dump -h $hostName -p $port -U $userName -d $dbName -F p -f $backupFile
        
        # Limpar senha da memória
        $password = $null
        $env:PGPASSWORD = $null
        
        if ($LASTEXITCODE -ne 0) {
            throw "Falha ao executar backup via pg_dump"
        }
    }
    
    # Verificar se o arquivo foi criado
    if (-not (Test-Path $backupFile)) {
        throw "Arquivo de backup não foi criado"
    }
    
    $fileSize = (Get-Item $backupFile).Length / 1MB
    Write-Host "`n✓ Backup criado com sucesso!" -ForegroundColor Green
    Write-Host "  Arquivo: $backupFile" -ForegroundColor White
    Write-Host "  Tamanho: $([math]::Round($fileSize, 2)) MB" -ForegroundColor White
    
    # Comprimir se solicitado
    if ($Compress) {
        Write-Host "`nComprimindo backup..." -ForegroundColor Yellow
        $zipFile = "$backupFile.zip"
        Compress-Archive -Path $backupFile -DestinationPath $zipFile -Force
        
        $zipSize = (Get-Item $zipFile).Length / 1MB
        $compressionRatio = [math]::Round((1 - ($zipSize / $fileSize)) * 100, 1)
        
        Write-Host "✓ Backup comprimido!" -ForegroundColor Green
        Write-Host "  Arquivo: $zipFile" -ForegroundColor White
        Write-Host "  Tamanho: $([math]::Round($zipSize, 2)) MB" -ForegroundColor White
        Write-Host "  Compressão: $compressionRatio%" -ForegroundColor White
        
        # Remover arquivo original
        Remove-Item $backupFile
        Write-Host "  Arquivo original removido" -ForegroundColor Gray
    }
    
    Write-Host "`n========================================" -ForegroundColor Cyan
    Write-Host "  BACKUP CONCLUÍDO COM SUCESSO!" -ForegroundColor Green
    Write-Host "========================================`n" -ForegroundColor Cyan
    
} catch {
    Write-Host "`n✗ ERRO ao fazer backup!" -ForegroundColor Red
    Write-Host "  $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "`nVerifique:" -ForegroundColor Yellow
    Write-Host "  - Credenciais estão corretas?" -ForegroundColor Yellow
    Write-Host "  - Conexão com o banco está ativa?" -ForegroundColor Yellow
    Write-Host "  - Ferramentas necessárias estão instaladas?" -ForegroundColor Yellow
    exit 1
}

