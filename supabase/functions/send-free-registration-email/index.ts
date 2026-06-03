import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.46.0";
import {
  buildFreeRegistrationEmailHtml,
  sendViaResend,
} from "../_shared/eventfest-mail.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const json200 = (obj: Record<string, unknown>) =>
  new Response(JSON.stringify(obj), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

type RequestBody = {
  qrCode?: string;
  wristbandCode?: string;
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

    const { qrCode, wristbandCode, email, eventTitle, eventDate, eventTime, eventLocation } =
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

    const toEmail = email.trim();
    const subject = `EventFest — Ingresso · ${eventTitle ?? "Evento"}`.trim();
    const html = buildFreeRegistrationEmailHtml({
      eventTitle,
      eventDate,
      eventTime,
      eventLocation,
      qrCode,
      wristbandCode,
    });

    const sendResult = await sendViaResend({ to: toEmail, subject, html });
    if (!sendResult.ok) {
      console.error(
        "[send-free-registration-email] Resend:",
        sendResult.status,
        sendResult.detail,
      );
      return json200({
        success: false,
        error: "resend_rejected",
        status: sendResult.status,
        detail: sendResult.detail,
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
