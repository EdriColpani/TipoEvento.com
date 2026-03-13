import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type RequestBody = {
  qrCode: string;
  email: string;
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
    return new Response(
      JSON.stringify({ success: false, error: "Method not allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  try {
    const body = (await req.json()) as RequestBody;
    const { qrCode, email, eventTitle, eventDate, eventTime, eventLocation } = body;

    if (!qrCode || !email) {
      return new Response(
        JSON.stringify({ success: false, error: "qrCode e email são obrigatórios." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabaseService = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    // Verifica se a inscrição existe e lê email_sent_at
    const { data: registration, error: registrationError } = await supabaseService
      .from("event_registrations")
      .select("id, email_sent_at")
      .eq("qr_code", qrCode)
      .maybeSingle();

    if (registrationError) {
      console.error("[send-free-registration-email] registrationError:", registrationError);
      return new Response(
        JSON.stringify({ success: false, error: "Falha ao buscar inscrição." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!registration) {
      return new Response(
        JSON.stringify({ success: false, error: "Inscrição não encontrada para este QR Code." }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Se já foi enviado antes, não reenviar; apenas retorna sucesso idempotente
    if (registration.email_sent_at) {
      return new Response(
        JSON.stringify({ success: true, alreadySent: true }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const resendKey = Deno.env.get("RESEND_API_KEY") ?? "";
    if (!resendKey) {
      console.error("[send-free-registration-email] RESEND_API_KEY não configurada.");
      // Não falha a experiência do usuário na tela; apenas registra erro
      return new Response(
        JSON.stringify({
          success: false,
          error: "Serviço de e-mail não configurado (RESEND_API_KEY ausente).",
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const subject = `Ingresso para o evento ${eventTitle ?? ""}`.trim();
    const dateLine = eventDate ? `Data: <strong>${eventDate}</strong>` : "";
    const timeLine = eventTime ? ` · Horário: <strong>${eventTime}</strong>` : "";
    const locationLine = eventLocation
      ? `<br />Local: <strong>${eventLocation}</strong>`
      : "";

    const html = `
      <div style="font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #111827;">
        <h1 style="font-size: 20px; margin-bottom: 8px;">Inscrição confirmada!</h1>
        <p style="margin: 0 0 12px 0;">
          Sua inscrição no evento <strong>${eventTitle ?? "Evento"}</strong> foi registrada com sucesso.
        </p>
        <p style="margin: 0 0 16px 0; font-size: 14px; color: #4b5563;">
          ${dateLine}${timeLine}${locationLine}
        </p>
        <p style="margin: 0 0 12px 0; font-size: 14px; color: #4b5563;">
          Abaixo está o seu <strong>ingresso digital</strong>. Apresente este QR Code no dia do evento.
        </p>
        <div style="margin: 16px 0; padding: 12px; display: inline-block; background: #ffffff; border-radius: 12px;">
          <img
            src="https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(qrCode)}"
            alt="QR Code do ingresso"
            width="240"
            height="240"
          />
        </div>
        <p style="margin: 0; font-size: 12px; color: #6b7280;">
          Guarde este e-mail. Este mesmo QR Code será usado para validar sua entrada.
        </p>
      </div>
    `;

    const emailResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${resendKey}`,
      },
      body: JSON.stringify({
        from: Deno.env.get("FREE_EVENTS_FROM_EMAIL") ?? "onboarding@resend.dev",
        to: [email],
        subject,
        html,
      }),
    });

    if (!emailResponse.ok) {
      const errorText = await emailResponse.text();
      console.error("[send-free-registration-email] Resend error:", emailResponse.status, errorText);
      return new Response(
        JSON.stringify({ success: false, error: "Falha ao enviar e-mail de ingresso." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Marca email_sent_at
    const { error: updateError } = await supabaseService
      .from("event_registrations")
      .update({ email_sent_at: new Date().toISOString() })
      .eq("qr_code", qrCode);

    if (updateError) {
      console.error("[send-free-registration-email] updateError:", updateError);
    }

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[send-free-registration-email] Unexpected error:", err);
    return new Response(
      JSON.stringify({ success: false, error: "Erro inesperado ao enviar e-mail." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

