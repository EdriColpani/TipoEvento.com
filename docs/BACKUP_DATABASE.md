# Guia de Backup do Banco de Dados

Este documento descreve os métodos disponíveis para fazer backup do banco de dados Supabase (PostgreSQL).

## Informações do Projeto

- **Plataforma**: Supabase
- **Banco de Dados**: PostgreSQL
- **URL do Projeto**: `https://yzwfjyejqvawhooecbem.supabase.co`

---

## 🔑 Como Alterar/Obter a Senha do Banco de Dados

Se você precisa trocar a senha do banco de dados ou não sabe qual é a senha atual, siga estes passos:

### Passo a Passo para Alterar a Senha

1. **Acesse o Dashboard do Supabase**
   - Acesse: https://supabase.com/dashboard
   - Faça login com suas credenciais

2. **Navegue até Database Settings**
   - No menu lateral, clique em **Settings** (Configurações)
   - Clique em **Database**

3. **Localize a Seção "Database Password"**
   - Role até encontrar a seção **Database Password**
   - Você verá:
     - A senha atual (oculta com asteriscos)
     - Um botão **Reset Database Password** ou **Change Password**

4. **Alterar a Senha**
   - Clique em **Reset Database Password** ou **Change Password**
   - Uma nova senha será gerada automaticamente
   - **⚠️ IMPORTANTE**: Copie e salve a nova senha imediatamente!
   - Você não poderá ver a senha novamente depois de fechar a janela

5. **Obter a Connection String**
   - Na mesma página, role até a seção **Connection string**
   - Você verá diferentes formatos:
     - **URI**: `postgresql://postgres:[PASSWORD]@[HOST]:5432/postgres`
     - **Connection Pooling**: `postgresql://postgres.yzwfjyejqvawhooecbem:[PASSWORD]@aws-1-sa-east-1.pooler.supabase.com:5432/postgres`
   - A senha já estará incluída na string (mas oculta)
   - Clique no ícone de **copiar** para copiar a string completa

### ⚠️ Atenção Após Alterar a Senha

Após alterar a senha do banco de dados:

1. **Atualize todas as aplicações** que usam essa senha
2. **Atualize variáveis de ambiente** em servidores/produção
3. **Atualize scripts de backup** que usam a senha diretamente
4. **Teste a conexão** antes de fazer o backup

### Dica: Usar Connection String Completa

Se você copiar a **Connection String** completa do dashboard, não precisará digitar a senha manualmente. O formato será:

```
postgresql://postgres.yzwfjyejqvawhooecbem:[SENHA]@aws-1-sa-east-1.pooler.supabase.com:5432/postgres
```

Você pode extrair a senha dessa string ou usar a string completa diretamente em alguns comandos.

---

## Método 1: Backup via Supabase Dashboard (Recomendado para Iniciantes)

### Passo a Passo

1. **Acesse o Dashboard do Supabase**
   - Acesse: https://supabase.com/dashboard
   - Faça login com suas credenciais

2. **Navegue até o Projeto**
   - Selecione o projeto: `yzwfjyejqvawhooecbem`

3. **Acesse Database Settings**
   - No menu lateral, clique em **Settings** (Configurações)
   - Clique em **Database**

4. **Faça o Download do Backup**
   - Role até a seção **Database Backups**
   - Clique em **Download** no backup mais recente
   - Ou clique em **Create backup** para gerar um novo backup manual

**Vantagens:**
- ✅ Interface gráfica simples
- ✅ Não requer instalação de ferramentas
- ✅ Backups automáticos diários disponíveis

**Desvantagens:**
- ❌ Depende do acesso ao dashboard
- ❌ Não permite automação via script

---

## Método 2: Backup via Supabase CLI (Recomendado para Automação)

### Pré-requisitos

1. **Instalar Supabase CLI**
   ```powershell
   # Via npm (se tiver Node.js instalado)
   npm install -g supabase

   # Ou via Scoop (Windows)
   scoop install supabase

   # Ou via Chocolatey
   choco install supabase
   ```

2. **Fazer Login no Supabase CLI**
   ```powershell
   supabase login
   ```
   - Isso abrirá o navegador para autenticação

3. **Linkar o Projeto Local**
   ```powershell
   supabase link --project-ref yzwfjyejqvawhooecbem
   ```

### Executar o Backup

```powershell
# Backup completo do banco
supabase db dump -f backup_$(Get-Date -Format "yyyyMMdd_HHmmss").sql

# Ou especificando apenas dados (sem schema)
supabase db dump --data-only -f backup_data_$(Get-Date -Format "yyyyMMdd_HHmmss").sql

# Ou apenas schema (sem dados)
supabase db dump --schema-only -f backup_schema_$(Get-Date -Format "yyyyMMdd_HHmmss").sql
```

**Vantagens:**
- ✅ Pode ser automatizado
- ✅ Controle fino sobre o que fazer backup
- ✅ Integra com scripts e CI/CD

**Desvantagens:**
- ❌ Requer instalação do CLI
- ❌ Requer autenticação

---

## Método 3: Backup via pg_dump (Método Direto PostgreSQL)

### Pré-requisitos

1. **Instalar PostgreSQL Client Tools**
   - Baixe e instale PostgreSQL: https://www.postgresql.org/download/windows/
   - Ou instale apenas as ferramentas clientes via: https://www.postgresql.org/download/windows/

2. **Obter String de Conexão e Senha**
   - Acesse o Supabase Dashboard
   - Vá em **Settings** → **Database**
   - Se não souber a senha, veja a seção **"Como Alterar/Obter a Senha do Banco de Dados"** acima
   - Copie a **Connection string** (use a versão "URI" ou "Connection pooling")
   - Formato: `postgresql://postgres:[PASSWORD]@[HOST]:5432/postgres`
   - A senha estará visível na connection string quando você copiar do dashboard

### Executar o Backup

```powershell
# Substitua [PASSWORD] e [HOST] pelos valores reais
$env:PGPASSWORD="[SUA_SENHA]"
pg_dump -h [HOST] -U postgres -d postgres -F c -f "backup_$(Get-Date -Format 'yyyyMMdd_HHmmss').dump"

# Ou em formato SQL (texto)
pg_dump -h [HOST] -U postgres -d postgres -f "backup_$(Get-Date -Format 'yyyyMMdd_HHmmss').sql"
```

**Exemplo com Connection Pooling:**
```powershell
# Para usar connection pooling (recomendado)
$env:PGPASSWORD="[SUA_SENHA]"
pg_dump -h aws-1-sa-east-1.pooler.supabase.com -p 5432 -U postgres.yzwfjyejqvawhooecbem -d postgres -F c -f "backup_$(Get-Date -Format 'yyyyMMdd_HHmmss').dump"
```

**Vantagens:**
- ✅ Método padrão do PostgreSQL
- ✅ Máximo controle sobre o backup
- ✅ Suporta formatos customizados

**Desvantagens:**
- ❌ Requer instalação do PostgreSQL client
- ❌ Requer gerenciamento manual de credenciais

---

## Método 4: Script PowerShell Automatizado

Crie um script para automatizar o processo:

### Criar Script de Backup

Crie o arquivo `scripts/backup-database.ps1`:

```powershell
# Script de Backup do Banco de Dados
# Uso: .\scripts\backup-database.ps1

param(
    [string]$BackupDir = ".\backups",
    [string]$Method = "supabase-cli"  # ou "pg_dump"
)

# Criar diretório de backups se não existir
if (-not (Test-Path $BackupDir)) {
    New-Item -ItemType Directory -Path $BackupDir | Out-Null
}

$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$backupFile = Join-Path $BackupDir "backup_$timestamp.sql"

Write-Host "Iniciando backup do banco de dados..." -ForegroundColor Green

if ($Method -eq "supabase-cli") {
    # Método via Supabase CLI
    supabase db dump -f $backupFile
    if ($LASTEXITCODE -eq 0) {
        Write-Host "Backup concluído: $backupFile" -ForegroundColor Green
    } else {
        Write-Host "Erro ao fazer backup!" -ForegroundColor Red
        exit 1
    }
} elseif ($Method -eq "pg_dump") {
    # Método via pg_dump
    # Configure estas variáveis antes de usar
    $env:PGPASSWORD = "[SUA_SENHA]"
    $host = "aws-1-sa-east-1.pooler.supabase.com"
    $user = "postgres.yzwfjyejqvawhooecbem"
    
    pg_dump -h $host -p 5432 -U $user -d postgres -f $backupFile
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "Backup concluído: $backupFile" -ForegroundColor Green
    } else {
        Write-Host "Erro ao fazer backup!" -ForegroundColor Red
        exit 1
    }
}

# Comprimir o backup (opcional)
Write-Host "Comprimindo backup..." -ForegroundColor Yellow
Compress-Archive -Path $backupFile -DestinationPath "$backupFile.zip" -Force
Remove-Item $backupFile

Write-Host "Backup finalizado e comprimido: $backupFile.zip" -ForegroundColor Green
```

### Usar o Script

```powershell
# Executar o script
.\scripts\backup-database.ps1

# Ou especificar método e diretório
.\scripts\backup-database.ps1 -BackupDir ".\meus-backups" -Method "supabase-cli"
```

---

## Restaurar um Backup

### Via Supabase CLI

```powershell
# Restaurar backup SQL
supabase db reset
psql -h [HOST] -U postgres -d postgres -f backup_20240101_120000.sql
```

### Via pg_restore

```powershell
# Para arquivos .dump (formato customizado)
$env:PGPASSWORD="[SUA_SENHA]"
pg_restore -h [HOST] -U postgres -d postgres -c backup_20240101_120000.dump

# Para arquivos .sql
$env:PGPASSWORD="[SUA_SENHA]"
psql -h [HOST] -U postgres -d postgres -f backup_20240101_120000.sql
```

**⚠️ ATENÇÃO**: Restaurar um backup substitui todos os dados atuais. Use com cuidado!

---

## Boas Práticas

1. **Frequência de Backup**
   - Backups diários para produção
   - Backups antes de migrações importantes
   - Backups antes de alterações estruturais

2. **Armazenamento**
   - Mantenha backups em local seguro e separado
   - Considere armazenamento em nuvem (AWS S3, Google Cloud Storage, etc.)
   - Mantenha múltiplas versões (últimos 7-30 dias)

3. **Teste de Restauração**
   - Teste periodicamente a restauração dos backups
   - Valide a integridade dos dados após restauração

4. **Segurança**
   - Nunca commite credenciais no Git
   - Use variáveis de ambiente para senhas
   - Proteja os arquivos de backup com permissões adequadas

5. **Automação**
   - Configure backups automáticos via cron (Linux) ou Task Scheduler (Windows)
   - Integre com pipelines CI/CD quando apropriado

---

## Troubleshooting

### Erro: "connection refused"
- Verifique se a string de conexão está correta
- Verifique se o IP está na whitelist do Supabase

### Erro: "authentication failed"
- Verifique se a senha está correta
- Verifique se está usando o usuário correto (postgres)

### Erro: "pg_dump: command not found"
- Instale o PostgreSQL client tools
- Adicione o PostgreSQL bin ao PATH do sistema

### Backup muito grande
- Use compressão: `pg_dump ... | gzip > backup.sql.gz`
- Considere fazer backup apenas de tabelas específicas
- Use formato customizado (-F c) que é mais eficiente

---

## Referências

- [Documentação Supabase - Backups](https://supabase.com/docs/guides/platform/backups)
- [Documentação PostgreSQL - pg_dump](https://www.postgresql.org/docs/current/app-pgdump.html)
- [Supabase CLI Documentation](https://supabase.com/docs/reference/cli/introduction)

