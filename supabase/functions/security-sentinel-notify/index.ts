// Sentinela de seguranca — camada 3 da blindagem.
//
// Roda via pg_cron (diario) e tambem pode ser chamada sob demanda pelo Admin.
// Junta o que o event trigger registrou (bloqueios, fechamentos automaticos) com
// o desvio detectado em relacao a linha de base, e manda um e-mail unico.
// Se nao houver nada, nao envia nada — alerta silencioso quando esta tudo bem
// e o que faz o alerta ser levado a serio quando chega.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { sendViaResend, wrapEventFestEmailLayout } from '../_shared/eventfest-mail.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type Item = {
  id: number;
  quando: string;
  usuario: string;
  comando: string;
  objeto: string;
  veredito: string;
  detalhe: string;
};

const VEREDITO_LABEL: Record<string, string> = {
  bloqueado: 'Bloqueado',
  auto_fechado: 'Fechado automaticamente',
  atencao: 'Atenção',
  permitido: 'Autorizado por janela',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const serviceKey = (Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '').trim();
  if (!serviceKey || !autorizado(req, serviceKey)) {
    return json({ error: 'Não autorizado.' }, 401);
  }

  const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', serviceKey);

  const { data: collected, error: collectError } = await supabase.rpc('security_sentinel_collect');
  if (collectError) {
    console.error('[security-sentinel] security_sentinel_collect:', collectError);
    return json({ error: collectError.message }, 500);
  }

  const itens = (collected?.itens ?? []) as Item[];
  if (itens.length === 0) {
    return json({ ok: true, enviado: false, motivo: 'nenhuma alteracao de seguranca pendente' });
  }

  const emails = await resolveAdminEmails(supabase);
  if (emails.length === 0) {
    console.error('[security-sentinel] nenhum destinatario Admin Master configurado');
    return json({ error: 'Nenhum destinatário configurado.' }, 500);
  }

  const { subject, html } = buildEmail(itens);
  const falhas: string[] = [];

  for (const to of emails) {
    const result = await sendViaResend({ to, subject, html });
    if (!result.ok) {
      console.error('[security-sentinel] falha ao enviar para', to, result.detail);
      falhas.push(to);
    }
  }

  if (falhas.length === emails.length) {
    // Nenhum envio deu certo: nao marcar como alertado, senao o problema
    // desaparece silenciosamente da proxima execucao.
    return json({ error: 'Falha ao enviar para todos os destinatários.' }, 502);
  }

  await supabase.rpc('security_sentinel_mark_alerted', { p_ids: itens.map((i) => i.id) });

  return json({ ok: true, enviado: true, itens: itens.length, destinatarios: emails.length, falhas });
});

function comparacaoSegura(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// O gateway do Supabase aceita qualquer chave valida do projeto — inclusive a
// anon. Quem autoriza de fato e o segredo dedicado, que o cron le do Vault.
// Comparar so com SUPABASE_SERVICE_ROLE_KEY quebra quando o projeto tem chave
// no formato novo e no legado ao mesmo tempo, que foi exatamente o que ocorreu aqui.
function autorizado(req: Request, serviceKey: string): boolean {
  const bearer = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (comparacaoSegura(bearer, serviceKey)) return true;

  const segredo = (Deno.env.get('SECURITY_SENTINEL_SECRET') ?? '').trim();
  const enviado = (req.headers.get('x-security-sentinel-secret') ?? '').trim();
  return comparacaoSegura(enviado, segredo);
}

async function resolveAdminEmails(supabase: ReturnType<typeof createClient>): Promise<string[]> {
  const { data, error } = await supabase.rpc('get_admin_master_notification_emails');
  if (error) {
    console.error('[security-sentinel] get_admin_master_notification_emails:', error);
  }
  const doBanco = Array.isArray(data) ? data.map((e) => String(e).trim().toLowerCase()) : [];
  const extra = (Deno.env.get('SECURITY_ALERT_EMAILS') ?? '')
    .split(/[,;]/)
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return [...new Set([...doBanco, ...extra])].filter(Boolean);
}

function buildEmail(itens: Item[]): { subject: string; html: string } {
  const bloqueados = itens.filter((i) => i.veredito === 'bloqueado').length;

  const linhas = itens
    .map((item) => {
      const cor = item.veredito === 'bloqueado' ? '#f87171'
        : item.veredito === 'atencao' ? '#fbbf24'
        : '#38bdf8';
      return `<tr>
  <td style="padding:8px 10px;border-bottom:1px solid rgba(255,255,255,0.08);font-size:12px;color:#a3a3a3;white-space:nowrap;">${formatarData(item.quando)}</td>
  <td style="padding:8px 10px;border-bottom:1px solid rgba(255,255,255,0.08);font-size:12px;color:${cor};font-weight:700;">${escapeHtml(VEREDITO_LABEL[item.veredito] ?? item.veredito)}</td>
  <td style="padding:8px 10px;border-bottom:1px solid rgba(255,255,255,0.08);font-size:12px;color:#e5e5e5;word-break:break-all;">${escapeHtml(item.objeto)}</td>
  <td style="padding:8px 10px;border-bottom:1px solid rgba(255,255,255,0.08);font-size:12px;color:#a3a3a3;">${escapeHtml(item.detalhe ?? '')}</td>
</tr>`;
    })
    .join('\n');

  const extraHtml = `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;">
  <tr>
    <th align="left" style="padding:8px 10px;font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:#737373;border-bottom:1px solid rgba(234,179,8,0.35);">Quando</th>
    <th align="left" style="padding:8px 10px;font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:#737373;border-bottom:1px solid rgba(234,179,8,0.35);">Situação</th>
    <th align="left" style="padding:8px 10px;font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:#737373;border-bottom:1px solid rgba(234,179,8,0.35);">Objeto</th>
    <th align="left" style="padding:8px 10px;font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:#737373;border-bottom:1px solid rgba(234,179,8,0.35);">Detalhe</th>
  </tr>
  ${linhas}
</table>
<p style="margin:20px 0 0;font-size:13px;line-height:1.6;color:#a3a3a3;">
  "Fechado automaticamente" é a blindagem funcionando: o objeto nasceu aberto e foi trancado sozinho.
  "Bloqueado" é um comando que não chegou a rodar. "Atenção" é desvio em relação à linha de base e pede conferência manual.
</p>`;

  return {
    subject: `EventFest — ${itens.length} alteração(ões) de segurança no banco`,
    html: wrapEventFestEmailLayout({
      title: 'Relatório de segurança do banco',
      intro: bloqueados > 0
        ? `A blindagem <strong style="color:#f87171;">bloqueou ${bloqueados} comando(s)</strong> e registrou outras alterações. Confira abaixo.`
        : 'Foram registradas alterações de estrutura ou permissão no banco desde o último aviso.',
      extraHtml,
      footerNote: 'EventFest · Sentinela de segurança do banco de dados.',
    }),
  };
}

function formatarData(iso: string): string {
  try {
    return new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  } catch {
    return iso;
  }
}

function escapeHtml(value: string): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
