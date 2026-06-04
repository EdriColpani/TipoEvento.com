/** Remetente padrão EventFest (domínio verificado na Resend). */
export const EVENTFEST_FROM =
  (Deno.env.get("EVENTFEST_FROM_EMAIL") ?? "").trim() ||
  "EventFest <noreply@EventFest.com.br>";

export type ResendSendResult =
  | { ok: true; id?: string }
  | { ok: false; status?: number; detail: string };

export async function sendViaResend(input: {
  to: string;
  subject: string;
  html: string;
  from?: string;
}): Promise<ResendSendResult> {
  const resendKey = (Deno.env.get("RESEND_API_KEY") ?? "").trim();
  if (!resendKey) {
    return { ok: false, detail: "RESEND_API_KEY ausente" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: input.from ?? EVENTFEST_FROM,
        to: input.to.trim(),
        subject: input.subject.trim(),
        html: input.html,
      }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        detail: JSON.stringify(data).slice(0, 500),
      };
    }

    const id = typeof data?.id === "string" ? data.id : undefined;
    return { ok: true, id };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, detail: message };
  } finally {
    clearTimeout(timer);
  }
}

type LayoutOptions = {
  title: string;
  intro: string;
  ctaLabel?: string;
  ctaUrl?: string;
  extraHtml?: string;
  footerNote?: string;
};

/** Layout transacional padrão EventFest (fundo escuro + botão dourado). */
export function wrapEventFestEmailLayout(options: LayoutOptions): string {
  const { title, intro, ctaLabel, ctaUrl, extraHtml = "", footerNote } = options;

  const ctaBlock =
    ctaLabel && ctaUrl
      ? `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 24px;">
  <tr>
    <td align="center" style="border-radius:10px;background-color:#eab308;">
      <a href="${escapeHtmlAttr(ctaUrl)}" target="_blank"
         style="display:inline-block;padding:14px 32px;font-size:16px;font-weight:700;color:#000000;text-decoration:none;border-radius:10px;">
        ${escapeHtml(ctaLabel)}
      </a>
    </td>
  </tr>
</table>
<p style="margin:0 0 8px;font-size:13px;line-height:1.5;color:#737373;">
  Se o botão não funcionar, copie e cole este link no navegador:
</p>
<p style="margin:0 0 20px;font-size:12px;line-height:1.5;word-break:break-all;">
  <a href="${escapeHtmlAttr(ctaUrl)}" style="color:#38bdf8;text-decoration:underline;">${escapeHtml(ctaUrl)}</a>
</p>`
      : "";

  const footer =
    footerNote ??
    "Você recebeu este e-mail porque iniciou uma ação na plataforma EventFest.";

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;padding:0;background-color:#0a0a0a;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#0a0a0a;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;">
          <tr>
            <td align="center" style="padding-bottom:24px;">
              <div style="font-size:28px;line-height:1.2;font-weight:700;color:#eab308;">EventFest</div>
              <div style="font-size:12px;color:#737373;margin-top:4px;letter-spacing:0.08em;text-transform:uppercase;">
                Plataforma de eventos premium
              </div>
            </td>
          </tr>
          <tr>
            <td style="background-color:#111111;border:1px solid rgba(234,179,8,0.35);border-radius:16px;padding:32px 28px;">
              <h1 style="margin:0 0 12px;font-size:22px;line-height:1.3;color:#ffffff;font-weight:700;">
                ${escapeHtml(title)}
              </h1>
              <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#a3a3a3;">
                ${intro}
              </p>
              ${ctaBlock}
              ${extraHtml}
            </td>
          </tr>
          <tr>
            <td align="center" style="padding-top:24px;">
              <p style="margin:0 0 6px;font-size:12px;color:#525252;">EventFest · EventFest.com.br</p>
              <p style="margin:0;font-size:11px;color:#404040;">${escapeHtml(footer)}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export type AuthEmailData = {
  token: string;
  token_hash: string;
  redirect_to: string;
  email_action_type: string;
  site_url: string;
  token_new?: string;
  token_hash_new?: string;
};

export function buildAuthVerifyUrl(
  supabaseUrl: string,
  emailData: AuthEmailData,
  overrides?: { tokenHash?: string; actionType?: string; redirectTo?: string },
): string {
  const base = `${supabaseUrl.replace(/\/$/, "")}/auth/v1/verify`;
  const params = new URLSearchParams({
    token: overrides?.tokenHash ?? emailData.token_hash,
    type: overrides?.actionType ?? emailData.email_action_type,
  });
  const redirect = sanitizeAuthRedirectTo(
    overrides?.redirectTo ?? emailData.redirect_to,
    emailData.site_url,
  );
  if (redirect) params.set("redirect_to", redirect);
  return `${base}?${params.toString()}`;
}

/** Evita links de confirmação apontando para localhost quando o cadastro é em produção. */
export function sanitizeAuthRedirectTo(
  redirectTo: string | undefined,
  siteUrl: string | undefined,
): string {
  const productionOrigin = (
    Deno.env.get("SITE_URL") ??
    Deno.env.get("VITE_SITE_URL") ??
    "https://www.eventfest.com.br"
  )
    .trim()
    .replace(/\/$/, "");

  const candidate = (redirectTo?.trim() || siteUrl?.trim() || `${productionOrigin}/login`).replace(
    /\/$/,
    "",
  );

  if (/127\.0\.0\.1|localhost/i.test(candidate)) {
    return `${productionOrigin}/login`;
  }

  if (!candidate.includes("/login") && !candidate.includes("/reset-password")) {
    if (candidate === productionOrigin || candidate.endsWith(".com.br") || candidate.endsWith(".com")) {
      return `${candidate}/login`;
    }
  }

  return candidate;
}

export function buildAuthEmail(input: {
  actionType: string;
  confirmationUrl?: string;
  otpCode?: string;
  userName?: string;
}): { subject: string; html: string } | null {
  const name = input.userName?.trim();
  const greeting = name ? `${name}, ` : "";

  switch (input.actionType) {
    case "signup":
    case "email":
      return {
        subject: "EventFest — Confirme seu cadastro",
        html: wrapEventFestEmailLayout({
          title: "Confirme seu cadastro",
          intro: `${greeting}falta só um passo para ativar sua conta no EventFest. Clique no botão abaixo para confirmar seu e-mail.`,
          ctaLabel: "Confirmar meu e-mail",
          ctaUrl: input.confirmationUrl,
          footerNote:
            "Se você não criou uma conta no EventFest, ignore este e-mail. O link expira em breve por segurança.",
        }),
      };
    case "recovery":
      return {
        subject: "EventFest — Redefinir senha",
        html: wrapEventFestEmailLayout({
          title: "Redefinir sua senha",
          intro: `${greeting}recebemos uma solicitação para alterar a senha da sua conta. Use o botão abaixo para escolher uma nova senha.`,
          ctaLabel: "Redefinir senha",
          ctaUrl: input.confirmationUrl,
          footerNote:
            "Se você não solicitou esta alteração, ignore este e-mail. Sua senha permanece a mesma.",
        }),
      };
    case "magiclink":
      return {
        subject: "EventFest — Link de acesso",
        html: wrapEventFestEmailLayout({
          title: "Seu link de acesso",
          intro: `${greeting}use o botão abaixo para entrar na EventFest. Este link expira em breve e só pode ser usado uma vez.`,
          ctaLabel: "Entrar na EventFest",
          ctaUrl: input.confirmationUrl,
        }),
      };
    case "invite":
      return {
        subject: "EventFest — Você foi convidado",
        html: wrapEventFestEmailLayout({
          title: "Você foi convidado",
          intro: `${greeting}você recebeu um convite para criar sua conta na EventFest. Clique abaixo para aceitar.`,
          ctaLabel: "Aceitar convite",
          ctaUrl: input.confirmationUrl,
        }),
      };
    case "email_change":
    case "email_change_new":
      return {
        subject: "EventFest — Confirmar alteração de e-mail",
        html: wrapEventFestEmailLayout({
          title: "Confirmar alteração de e-mail",
          intro: `${greeting}confirme a alteração do endereço de e-mail da sua conta clicando no botão abaixo.`,
          ctaLabel: "Confirmar e-mail",
          ctaUrl: input.confirmationUrl,
        }),
      };
    case "reauthentication":
      return {
        subject: "EventFest — Código de verificação",
        html: wrapEventFestEmailLayout({
          title: "Código de verificação",
          intro: `${greeting}use o código abaixo para confirmar sua identidade. Ele expira em breve.`,
          extraHtml: `<p style="margin:0;font-size:28px;font-weight:700;letter-spacing:0.2em;color:#eab308;text-align:center;">${escapeHtml(input.otpCode ?? "------")}</p>`,
        }),
      };
    case "password_changed_notification":
      return {
        subject: "EventFest — Senha alterada",
        html: wrapEventFestEmailLayout({
          title: "Senha alterada",
          intro: "A senha da sua conta EventFest foi alterada com sucesso. Se não foi você, entre em contato conosco imediatamente.",
        }),
      };
    case "email_changed_notification":
      return {
        subject: "EventFest — E-mail alterado",
        html: wrapEventFestEmailLayout({
          title: "E-mail alterado",
          intro: "O endereço de e-mail da sua conta EventFest foi alterado. Se não foi você, entre em contato conosco imediatamente.",
        }),
      };
    default:
      return null;
  }
}

export function buildFreeRegistrationEmailHtml(input: {
  eventTitle?: string;
  eventDate?: string;
  eventTime?: string;
  eventLocation?: string;
  qrCode: string;
  wristbandCode?: string;
}): string {
  const title = input.eventTitle ?? "Evento";
  const dateLine = input.eventDate ? `Data: <strong>${escapeHtml(input.eventDate)}</strong>` : "";
  const timeLine = input.eventTime
    ? ` · Horário: <strong>${escapeHtml(input.eventTime)}</strong>`
    : "";
  const locationLine = input.eventLocation
    ? `<br />Local: <strong>${escapeHtml(input.eventLocation)}</strong>`
    : "";

  const codeBlock = input.wristbandCode?.trim()
    ? `<p style="margin:16px 0 0;padding:12px;background:rgba(255,255,255,0.06);border-radius:8px;font-size:14px;color:#d4d4d4;">
  <strong style="color:#fff;">Código do ingresso:</strong>
  <span style="font-family:monospace;font-size:16px;color:#eab308;">${escapeHtml(input.wristbandCode.trim())}</span>
</p>
<p style="margin:8px 0 0;font-size:13px;color:#737373;">Se o QR code não funcionar na entrada, informe este código ao organizador.</p>`
    : "";

  const extraHtml = `<p style="margin:0 0 8px;font-size:15px;color:#ffffff;"><strong>${escapeHtml(title)}</strong></p>
<p style="margin:0 0 16px;font-size:14px;color:#a3a3a3;">${dateLine}${timeLine}${locationLine}</p>
<p style="margin:0 0 16px;font-size:14px;color:#d4d4d4;">
  <strong style="color:#fff;">Apresente este QR Code na entrada</strong> para confirmar sua presença no evento.
</p>
<p style="margin:0;text-align:center;">
  <img src="https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(input.qrCode)}" width="220" height="220" alt="QR Code do ingresso" style="border-radius:12px;border:1px solid rgba(234,179,8,0.35);" />
</p>
${codeBlock}`;

  return wrapEventFestEmailLayout({
    title: "Inscrição confirmada",
    intro: "Sua inscrição gratuita foi registrada com sucesso. Guarde este e-mail — ele é seu comprovante de entrada.",
    extraHtml,
    footerNote: "EventFest · Ingresso gerado automaticamente após inscrição gratuita.",
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeHtmlAttr(value: string): string {
  return escapeHtml(value).replace(/'/g, "&#39;");
}
