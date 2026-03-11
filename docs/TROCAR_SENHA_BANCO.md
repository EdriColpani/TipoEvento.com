# 🔑 Como Trocar a Senha do Banco de Dados

Guia rápido para alterar a senha do banco de dados Supabase.

## Passo a Passo Rápido

### 1. Acesse o Dashboard
- Vá para: https://supabase.com/dashboard
- Faça login

### 2. Selecione o Projeto
- Clique no projeto: `yzwfjyejqvawhooecbem`

### 3. Vá para Database Settings
- Menu lateral → **Settings** (⚙️ Configurações)
- Clique em **Database**

### 4. Localize "Database Password"
- Role a página até encontrar a seção **Database Password**
- Você verá a senha atual (oculta) e um botão para resetar

### 5. Clique em "Reset Database Password"
- ⚠️ **ATENÇÃO**: Uma nova senha será gerada automaticamente
- **COPIE E SALVE A SENHA IMEDIATAMENTE**
- Você não poderá ver a senha novamente depois!

### 6. Copie a Connection String
- Na mesma página, role até **Connection string**
- Clique no botão de **copiar** (ícone de clipboard)
- A connection string já inclui a senha (mas ela aparece oculta na interface)

## 📋 O Que Fazer Depois

Após alterar a senha, você precisa atualizar:

1. ✅ **Scripts de backup** que usam a senha
2. ✅ **Variáveis de ambiente** em produção
3. ✅ **Aplicações** que conectam diretamente ao banco
4. ✅ **Ferramentas de desenvolvimento** (DBeaver, pgAdmin, etc.)

## 🔍 Como Extrair a Senha da Connection String

Se você copiou a Connection String completa, ela tem este formato:

```
postgresql://postgres.yzwfjyejqvawhooecbem:[SENHA_AQUI]@aws-1-sa-east-1.pooler.supabase.com:5432/postgres
```

A senha está entre `:` e `@`. Exemplo:
- `postgresql://postgres.yzwfjyejqvawhooecbem:**minhasenha123**@aws-1-sa-east-1...`

## 💡 Dica: Usar Connection String no Script

Se você usar o script `backup-database.ps1` com o método `pg_dump`, o script pedirá a senha interativamente. Você pode:

1. **Digitar manualmente** quando o script pedir
2. **Copiar da Connection String** do dashboard
3. **Usar o método Supabase CLI** (não precisa da senha do banco)

## ⚠️ Importante

- **Nunca commite a senha** no Git
- **Use variáveis de ambiente** para armazenar senhas
- **Mantenha a senha segura** e compartilhe apenas com pessoas autorizadas
- **Teste a conexão** após alterar a senha antes de fazer backup

## 🆘 Problemas Comuns

### "Esqueci a senha que acabei de criar"
- Infelizmente, você precisará resetar novamente
- O Supabase não permite ver senhas antigas por segurança

### "Não consigo conectar após trocar a senha"
- Verifique se copiou a senha corretamente (sem espaços)
- Verifique se atualizou todas as aplicações/configurações
- Teste a connection string diretamente no dashboard primeiro

### "Onde está o botão Reset Database Password?"
- Certifique-se de estar na página **Settings → Database**
- Role a página para baixo, a seção pode estar mais abaixo
- Verifique se você tem permissões de administrador no projeto

