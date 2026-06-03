import { Webhook } from "https://esm.sh/standardwebhooks@1.0.0";
import {
  buildAuthEmail,
  buildAuthVerifyUrl,
  sendViaResend,
  type AuthEmailData,
} from "../_shared/eventfest-mail.ts";

type HookUser = {
  email?: string;
  new_email?: string;
  user_metadata?: { name?: string; full_name?: string };
};

type HookPayload = {
  user: HookUser;
  email_data: AuthEmailData;
};

function getUserDisplayName(user: HookUser): string | undefined {
  return user.user_metadata?.name?.trim() || user.user_metadata?.full_name?.trim() || undefined;
}

async function sendAuthEmail(input: {
  to: string;
  actionType: string;
  confirmationUrl?: string;
  otpCode?: string;
  userName?: string;
}): Promise<Response | null> {
  const content = buildAuthEmail({
    actionType: input.actionType,
    confirmationUrl: input.confirmationUrl,
    otpCode: input.otpCode,
    userName: input.userName,
  });

  if (!content) {
    console.info("[auth-send-email] tipo ignorado:", input.actionType);
    return new Response(JSON.stringify({ skipped: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  const result = await sendViaResend({
    to: input.to,
    subject: content.subject,
    html: content.html,
  });

  if (!result.ok) {
    console.error("[auth-send-email] Resend:", result.status, result.detail);
    return new Response(
      JSON.stringify({ error: { message: result.detail, http_code: result.status ?? 500 } }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  console.info("[auth-send-email] ok →", input.to, input.actionType);
  return null;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("method not allowed", { status: 405 });
  }

  const hookSecretRaw = (Deno.env.get("SEND_EMAIL_HOOK_SECRET") ?? "").trim();
  if (!hookSecretRaw) {
    console.error("[auth-send-email] SEND_EMAIL_HOOK_SECRET ausente");
    return new Response(JSON.stringify({ error: "hook_secret_missing" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = (Deno.env.get("SUPABASE_URL") ?? "").trim();
  if (!supabaseUrl) {
    console.error("[auth-send-email] SUPABASE_URL ausente");
    return new Response(JSON.stringify({ error: "supabase_url_missing" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const payloadText = await req.text();
  const headers = Object.fromEntries(req.headers);
  const hookSecret = hookSecretRaw.replace(/^v1,whsec_/, "");

  let payload: HookPayload;
  try {
    const wh = new Webhook(hookSecret);
    payload = wh.verify(payloadText, headers) as HookPayload;
  } catch (error) {
    console.error("[auth-send-email] webhook verify failed:", error);
    return new Response(JSON.stringify({ error: "invalid_hook_signature" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { user, email_data: emailData } = payload;
  const userName = getUserDisplayName(user);
  const actionType = emailData.email_action_type;

  try {
    if (actionType === "email_change") {
      const hasSecurePair = Boolean(emailData.token_hash_new && user.new_email);

      if (hasSecurePair && user.email) {
        const currentUrl = buildAuthVerifyUrl(supabaseUrl, emailData, {
          tokenHash: emailData.token_hash_new,
          actionType: "email_change",
        });
        const currentResult = await sendAuthEmail({
          to: user.email,
          actionType: "email_change",
          confirmationUrl: currentUrl,
          userName,
        });
        if (currentResult) return currentResult;

        const newUrl = buildAuthVerifyUrl(supabaseUrl, emailData, {
          tokenHash: emailData.token_hash,
          actionType: "email_change",
        });
        const newResult = await sendAuthEmail({
          to: user.new_email!,
          actionType: "email_change_new",
          confirmationUrl: newUrl,
          userName,
        });
        if (newResult) return newResult;
      } else if (user.new_email || user.email) {
        const confirmationUrl = buildAuthVerifyUrl(supabaseUrl, emailData);
        const target = user.new_email || user.email!;
        const singleResult = await sendAuthEmail({
          to: target,
          actionType: "email_change",
          confirmationUrl,
          userName,
        });
        if (singleResult) return singleResult;
      }

      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    const to = user.email;
    if (!to) {
      return new Response(JSON.stringify({ error: "missing_recipient" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const confirmationUrl = buildAuthVerifyUrl(supabaseUrl, emailData);
    const failure = await sendAuthEmail({
      to,
      actionType,
      confirmationUrl: actionType === "reauthentication" ? undefined : confirmationUrl,
      otpCode: emailData.token,
      userName,
    });
    if (failure) return failure;

    return new Response(JSON.stringify({}), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[auth-send-email] unexpected:", error);
    return new Response(JSON.stringify({ error: "unexpected" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
