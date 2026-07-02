import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.46.0";
import {
  buildAuthEmail,
  buildPartnerOwnerInviteEmail,
  sanitizeAuthRedirectTo,
  sendViaResend,
} from "./eventfest-mail.ts";

const PASSWORD_SETUP_REQUIRED_KEY = "password_setup_required";
const INVITED_PARTNER_OWNER_KEY = "invited_partner_owner";

export function getAuthRedirect(redirectPath?: string): string {
  const productionOrigin = (
    Deno.env.get("SITE_URL") ??
    Deno.env.get("VITE_SITE_URL") ??
    "https://www.eventfest.com.br"
  )
    .trim()
    .replace(/\/$/, "");
  const path =
    typeof redirectPath === "string" && redirectPath.startsWith("/")
      ? redirectPath
      : "/login";
  return sanitizeAuthRedirectTo(`${productionOrigin}${path}`, Deno.env.get("SITE_URL"));
}

/** Corrige redirect_to dentro do action_link gerado pelo Auth (ex.: localhost). */
export function fixActionLinkRedirect(actionLink: string, redirectTo: string): string {
  try {
    const url = new URL(actionLink);
    url.searchParams.set("redirect_to", redirectTo);
    return url.toString();
  } catch {
    return actionLink;
  }
}

export function translateGenerateLinkError(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes("already") && lower.includes("confirmed")) {
    return "Este e-mail já foi confirmado. Faça login para continuar.";
  }
  if (lower.includes("not found") || lower.includes("user not found")) {
    return "Não encontramos cadastro com este e-mail.";
  }
  if (lower.includes("rate") || lower.includes("too many")) {
    return "Aguarde alguns minutos antes de solicitar outro e-mail.";
  }
  return "Não foi possível gerar o link. Tente novamente.";
}

export function translateCreateUserError(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes("already") && (lower.includes("registered") || lower.includes("exists"))) {
    return "Já existe uma conta com este e-mail.";
  }
  if (lower.includes("password") && lower.includes("6")) {
    return "A senha deve ter no mínimo 6 caracteres.";
  }
  if (lower.includes("invalid") && lower.includes("email")) {
    return "E-mail inválido.";
  }
  return "Não foi possível criar a conta. Tente novamente.";
}

type LinkType = "signup" | "recovery";

export async function sendAuthLinkViaResend(
  admin: SupabaseClient,
  input: {
    email: string;
    linkType: LinkType;
    redirectPath?: string;
    userName?: string;
  },
): Promise<{ ok: true } | { ok: false; message: string; error?: string }> {
  const redirectTo = getAuthRedirect(input.redirectPath);
  const actionType = input.linkType === "recovery" ? "recovery" : "signup";

  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: input.linkType,
    email: input.email,
    options: { redirectTo },
  });

  if (linkError) {
    console.error(`[auth-resend] generateLink ${input.linkType}:`, linkError.message);
    return {
      ok: false,
      error: "generate_link_failed",
      message: translateGenerateLinkError(linkError.message),
    };
  }

  const rawActionLink = linkData?.properties?.action_link;
  if (!rawActionLink) {
    return {
      ok: false,
      error: "no_action_link",
      message: "Não foi possível gerar o link de confirmação.",
    };
  }

  const confirmationUrl = fixActionLinkRedirect(rawActionLink, redirectTo);
  const userName =
    input.userName?.trim() ||
    (linkData.user?.user_metadata as { name?: string } | undefined)?.name?.trim() ||
    undefined;

  const content = buildAuthEmail({
    actionType,
    confirmationUrl,
    userName,
  });

  if (!content) {
    return { ok: false, error: "template_missing", message: "Template de e-mail indisponível." };
  }

  const sendResult = await sendViaResend({
    to: input.email,
    subject: content.subject,
    html: content.html,
  });

  if (!sendResult.ok) {
    console.error("[auth-resend] Resend:", sendResult.status, sendResult.detail);
    return {
      ok: false,
      error: "resend_rejected",
      message: "Falha ao enviar e-mail. Verifique a configuração da Resend.",
    };
  }

  console.info(`[auth-resend] ok → ${input.email} (${input.linkType})`);
  return { ok: true };
}

export async function registerUserAndSendConfirmation(
  admin: SupabaseClient,
  input: {
    email: string;
    password: string;
    redirectPath?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<{ ok: true } | { ok: false; message: string; error?: string }> {
  const email = input.email.trim().toLowerCase();
  const metadata = input.metadata ?? {};

  const { error: createError } = await admin.auth.admin.createUser({
    email,
    password: input.password,
    email_confirm: false,
    user_metadata: metadata,
  });

  if (createError) {
    const lower = createError.message.toLowerCase();
    const alreadyExists =
      lower.includes("already") &&
      (lower.includes("registered") || lower.includes("exists") || lower.includes("duplicate"));

    if (alreadyExists) {
      return sendAuthLinkViaResend(admin, {
        email,
        linkType: "signup",
        redirectPath: input.redirectPath,
        userName: typeof metadata.name === "string" ? metadata.name : undefined,
      });
    }

    console.error("[auth-resend] createUser:", createError.message);
    return {
      ok: false,
      error: "create_user_failed",
      message: translateCreateUserError(createError.message),
    };
  }

  return sendAuthLinkViaResend(admin, {
    email,
    linkType: "signup",
    redirectPath: input.redirectPath,
    userName: typeof metadata.name === "string" ? metadata.name : undefined,
  });
}

function isExistingUserLinkError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    (lower.includes("already") &&
      (lower.includes("registered") || lower.includes("exists") || lower.includes("confirmed"))) ||
    lower.includes("user already") ||
    lower.includes("email address has already been registered")
  );
}

async function markPartnerPasswordSetupRequired(
  admin: SupabaseClient,
  input: { userId?: string; existingMetadata?: Record<string, unknown> },
): Promise<void> {
  const userId = input.userId;
  if (!userId) return;

  const { data: userData } = await admin.auth.admin.getUserById(userId);
  const meta = {
    ...((userData?.user?.user_metadata ?? {}) as Record<string, unknown>),
    ...(input.existingMetadata ?? {}),
    [PASSWORD_SETUP_REQUIRED_KEY]: true,
    [INVITED_PARTNER_OWNER_KEY]: true,
  };

  await admin.auth.admin.updateUserById(userId, { user_metadata: meta });
}

/** Convite obrigatório ao gestor dono de empresa parceira (criar senha ou link de acesso). */
export async function invitePartnerOwnerViaResend(
  admin: SupabaseClient,
  input: {
    email: string;
    companyName: string;
    redirectPath?: string;
  },
): Promise<
  | { ok: true; mode: "invite" | "recovery" }
  | { ok: false; message: string; error?: string }
> {
  const email = input.email.trim().toLowerCase();
  const companyName = input.companyName.trim() || "Empresa parceira";
  const passwordRedirectPath = input.redirectPath ?? "/reset-password";

  async function sendPartnerPasswordLink(
    linkType: "invite" | "recovery",
  ): Promise<{ ok: true; mode: typeof linkType } | { ok: false; message: string }> {
    const redirectTo = getAuthRedirect(passwordRedirectPath);

    const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
      type: linkType,
      email,
      options: {
        redirectTo,
        data: {
          [INVITED_PARTNER_OWNER_KEY]: true,
          [PASSWORD_SETUP_REQUIRED_KEY]: true,
        },
      },
    });

    if (linkError) {
      return { ok: false, message: linkError.message };
    }

    const rawActionLink = linkData?.properties?.action_link;
    if (!rawActionLink) {
      return { ok: false, message: "no_action_link" };
    }

    await markPartnerPasswordSetupRequired(admin, {
      userId: linkData.user?.id,
      existingMetadata: { [INVITED_PARTNER_OWNER_KEY]: true },
    });

    const actionUrl = fixActionLinkRedirect(rawActionLink, redirectTo);
    const content = buildPartnerOwnerInviteEmail({
      companyName,
      actionUrl,
      isNewAccount: true,
    });

    const sendResult = await sendViaResend({
      to: email,
      subject: content.subject,
      html: content.html,
    });

    if (!sendResult.ok) {
      console.error("[invite-partner-owner] Resend:", sendResult.detail);
      return {
        ok: false,
        message: "Falha ao enviar e-mail. Verifique a configuração da Resend.",
      };
    }

    console.info(`[invite-partner-owner] ok → ${email} (${linkType})`);
    return { ok: true, mode: linkType };
  }

  const inviteResult = await sendPartnerPasswordLink("invite");
  if (inviteResult.ok) {
    return { ok: true, mode: inviteResult.mode };
  }

  if (isExistingUserLinkError(inviteResult.message)) {
    const recoveryResult = await sendPartnerPasswordLink("recovery");
    if (recoveryResult.ok) {
      return { ok: true, mode: recoveryResult.mode };
    }
    return {
      ok: false,
      error: "recovery_failed",
      message: translateGenerateLinkError(recoveryResult.message),
    };
  }

  return {
    ok: false,
    error: "invite_failed",
    message: translateGenerateLinkError(inviteResult.message),
  };
}
