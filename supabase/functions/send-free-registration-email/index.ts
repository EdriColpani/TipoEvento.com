import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.46.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

/** Remetente fixo: domínio eventofest.com.br (verificado na Resend). Sem secret de e-mail. */
const RESEND_FROM = "EventoFest <noreply@eventofest.com.br>";

const json200 = (obj: Record<string, unknown>) =>
  new Response(JSON.stringify(obj), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

type RequestBody = {
  qrCode?: string;
  email?: string;
  eventTitle?: string;
  eventDate?: string;
  eventTime?: string;
  eventLocation?: string;
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json200({ success: false, error: "method_not_allowed" });
  }

  try {
    let body: RequestBody = {};
    try {
      body = (await req.json()) as RequestBody;
    } catch {
      return json200({ success: false, error: "invalid_json" });
    }

    const { qrCode, email, eventTitle, eventDate, eventTime, eventLocation } =
      body;
    if (!qrCode || !email) {
      return json200({ success: false, error: "missing_qr_or_email" });
    }

    const url = Deno.env.get("SUPABASE_URL") ?? "";
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!url || !key) {
      console.error(
        "[send-free-registration-email] SUPABASE_URL ou SERVICE_ROLE ausente",
      );
      return json200({ success: false, error: "server_misconfigured" });
    }

    const supabaseService = createClient(url, key, {
      auth: { persistSession: false },
    });

    const { data: registration, error: registrationError } =
      await supabaseService
        .from("event_registrations")
        .select("id, email_sent_at")
        .eq("qr_code", qrCode)
        .maybeSingle();

    if (registrationError) {
      console.error("[send-free-registration-email] db:", registrationError);
      return json200({
        success: false,
        error: "db_read",
        detail: registrationError.message,
      });
    }

    if (!registration) {
      return json200({ success: false, error: "registration_not_found" });
    }

    if (registration.email_sent_at) {
      return json200({ success: true, alreadySent: true });
    }

    const resendKey = (Deno.env.get("RESEND_API_KEY") ?? "").trim();
    if (!resendKey) {
      console.error("[send-free-registration-email] RESEND_API_KEY ausente");
      return json200({ success: false, error: "no_resend_key" });
    }

    const toEmail = email.trim();
    const subject = `Ingresso — ${eventTitle ?? "Evento"}`.trim();
    const dateLine = eventDate ? `Data: <strong>${eventDate}</strong>` : "";
    const timeLine = eventTime
      ? ` · Horário: <strong>${eventTime}</strong>`
      : "";
    const locationLine = eventLocation
      ? `<br />Local: <strong>${eventLocation}</strong>`
      : "";

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>
<div style="font-family:Arial,sans-serif;color:#111;max-width:600px;margin:0 auto;padding:20px">
  <h1 style="font-size:18px">Inscrição confirmada</h1>
  <p><strong>${eventTitle ?? "Evento"}</strong></p>
  <p style="color:#555;font-size:14px">${dateLine}${timeLine}${locationLine}</p>
  <p style="font-size:14px">Apresente este QR no dia do evento.</p>
  <p><img src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(qrCode)}" width="200" height="200" alt="QR" /></p>
  <p style="font-size:12px;color:#666">EventoFest · eventofest.com.br</p>
</div></body></html>`;

    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 20000);

    let emailResponse: Response;
    try {
      emailResponse = await fetch("https://api.resend.com/emails", {
        method: "POST",
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${resendKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: RESEND_FROM,
          to: toEmail,
          subject,
          html,
        }),
      });
    } catch (e) {
      clearTimeout(t);
      console.error("[send-free-registration-email] fetch Resend:", e);
      return json200({ success: false, error: "resend_timeout_or_network" });
    }
    clearTimeout(t);

    const resendData = await emailResponse.json().catch(() => ({}));

    if (!emailResponse.ok) {
      console.error(
        "[send-free-registration-email] Resend:",
        emailResponse.status,
        resendData,
      );
      return json200({
        success: false,
        error: "resend_rejected",
        status: emailResponse.status,
        detail: JSON.stringify(resendData).slice(0, 500),
      });
    }

    const { error: updateError } = await supabaseService
      .from("event_registrations")
      .update({ email_sent_at: new Date().toISOString() })
      .eq("qr_code", qrCode);

    if (updateError) {
      console.error("[send-free-registration-email] update:", updateError);
    }

    console.info("[send-free-registration-email] ok →", toEmail);
    return json200({ success: true });
  } catch (err) {
    console.error("[send-free-registration-email] catch:", err);
    return json200({ success: false, error: "unexpected" });
  }
});
