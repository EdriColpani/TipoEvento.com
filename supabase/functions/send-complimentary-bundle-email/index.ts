import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.46.0";
import {
  buildComplimentaryBundleEmailHtml,
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
  bundleId?: string;
  email?: string;
  recipientName?: string;
  eventTitle?: string;
  batchName?: string;
  quantity?: number;
  bundleUrl?: string;
  expiresAt?: string;
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

    const {
      bundleId,
      email,
      recipientName,
      eventTitle,
      batchName,
      quantity,
      bundleUrl,
      expiresAt,
    } = body;

    if (!bundleId || !email || !bundleUrl || !recipientName || !eventTitle) {
      return json200({ success: false, error: "missing_fields" });
    }

    const url = Deno.env.get("SUPABASE_URL") ?? "";
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!url || !key) {
      return json200({ success: false, error: "server_misconfigured" });
    }

    const supabaseService = createClient(url, key, {
      auth: { persistSession: false },
    });

    const { data: bundle, error: bundleError } = await supabaseService
      .from("complimentary_bundles")
      .select("id, email_sent_at, status")
      .eq("id", bundleId)
      .maybeSingle();

    if (bundleError || !bundle) {
      return json200({ success: false, error: "bundle_not_found" });
    }

    if (bundle.email_sent_at) {
      return json200({ success: true, already_sent: true });
    }

    const expiresLabel = expiresAt
      ? new Date(expiresAt).toLocaleDateString("pt-BR")
      : undefined;

    const html = buildComplimentaryBundleEmailHtml({
      recipientName,
      eventTitle,
      batchName: batchName ?? "Cortesia",
      quantity: Number(quantity ?? 1),
      bundleUrl,
      expiresAt: expiresLabel,
    });

    const sendResult = await sendViaResend({
      to: email,
      subject: `EventFest — Cortesia: ${eventTitle}`,
      html,
    });

    if (!sendResult.ok) {
      console.error("[send-complimentary-bundle-email]", sendResult.detail);
      return json200({ success: false, error: "send_failed", detail: sendResult.detail });
    }

    await supabaseService.rpc("mark_complimentary_bundle_email_sent", {
      p_bundle_id: bundleId,
    });

    return json200({ success: true, resend_id: sendResult.id ?? null });
  } catch (err) {
    console.error("[send-complimentary-bundle-email]", err);
    return json200({
      success: false,
      error: "unexpected",
      detail: err instanceof Error ? err.message : String(err),
    });
  }
});
