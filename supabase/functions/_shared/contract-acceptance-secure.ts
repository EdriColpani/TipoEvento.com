import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.46.0";
import { PDFDocument, StandardFonts, rgb } from "https://esm.sh/pdf-lib@1.17.1";
import { sendViaResend, wrapEventFestEmailLayout } from "./eventfest-mail.ts";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-idempotency-key",
};

export const OTP_TTL_MINUTES = 10;
export const RESEND_COOLDOWN_SECONDS = 60;
export const MAX_SENDS_PER_HOUR = 10;
export const PDF_BUCKET = "contract-acceptance-pdfs";

export function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export function clientIp(req: Request): string | null {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return (
    forwarded ||
    req.headers.get("cf-connecting-ip")?.trim() ||
    req.headers.get("x-real-ip")?.trim() ||
    null
  );
}

export function createServiceClient() {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceKey) {
    throw new Error("server_misconfigured");
  }
  return {
    supabaseUrl,
    admin: createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    }),
  };
}

export async function requireUser(admin: SupabaseClient, req: Request) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return { error: json({ ok: false, error: "unauthorized", message: "Faça login novamente." }, 401) };
  }
  const jwt = authHeader.slice(7).trim();
  const { data, error } = await admin.auth.getUser(jwt);
  if (error || !data.user) {
    return { error: json({ ok: false, error: "unauthorized", message: "Sessão inválida." }, 401) };
  }
  return { user: data.user };
}

export function maskEmail(email: string): string {
  const v = email.trim().toLowerCase();
  const at = v.indexOf("@");
  if (at <= 0) return "***";
  const local = v.slice(0, at);
  const domain = v.slice(at + 1);
  if (local.length <= 2) return `${local.slice(0, 1)}***@${domain}`;
  return `${local.slice(0, 2)}***@${domain}`;
}

export function escapeText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function randomOtpCode(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
  return String(n).padStart(6, "0");
}

export function randomSalt(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function hashOtp(admin: SupabaseClient, code: string, salt: string) {
  const { data, error } = await admin.rpc("hash_contract_acceptance_otp", {
    p_code: code,
    p_salt: salt,
  });
  if (error || typeof data !== "string") {
    throw new Error(error?.message ?? "Falha ao gerar hash do código.");
  }
  return data;
}

export async function logAudit(
  admin: SupabaseClient,
  input: {
    eventType: string;
    actorUserId?: string | null;
    acceptanceId?: string | null;
    challengeId?: string | null;
    companyId?: string | null;
    contractId?: string | null;
    payload?: Record<string, unknown>;
  },
) {
  await admin.rpc("log_contract_acceptance_audit_event", {
    p_event_type: input.eventType,
    p_actor_user_id: input.actorUserId ?? null,
    p_acceptance_id: input.acceptanceId ?? null,
    p_challenge_id: input.challengeId ?? null,
    p_company_id: input.companyId ?? null,
    p_contract_id: input.contractId ?? null,
    p_payload: input.payload ?? {},
  });
}

export function buildContractOtpEmail(input: {
  code: string;
  userName?: string | null;
  contractTitle?: string | null;
}) {
  const greeting = input.userName?.trim() ? `${input.userName.trim()}, ` : "";
  const titleHint = input.contractTitle?.trim()
    ? ` referente a “${input.contractTitle.trim()}”`
    : "";
  return {
    subject: "EventFest — Código para aceitar o contrato",
    html: wrapEventFestEmailLayout({
      title: "Código de confirmação",
      intro: `${greeting}use o código abaixo para confirmar sua identidade e aceitar o contrato EventFest${titleHint}. O código expira em ${OTP_TTL_MINUTES} minutos.`,
      extraHtml: `<p style="margin:0;font-size:32px;font-weight:700;letter-spacing:0.25em;color:#eab308;text-align:center;">${escapeText(input.code)}</p>
<p style="margin:16px 0 0;font-size:13px;line-height:1.5;color:#a3a3a3;text-align:center;">Não compartilhe este código. A EventFest nunca pede este código por telefone.</p>`,
      footerNote:
        "Você recebeu este e-mail porque iniciou o aceite de um contrato na plataforma EventFest.",
    }),
  };
}

export async function sendContractOtpEmail(input: {
  to: string;
  code: string;
  userName?: string | null;
  contractTitle?: string | null;
}) {
  const mail = buildContractOtpEmail(input);
  return sendViaResend({
    to: input.to,
    subject: mail.subject,
    html: mail.html,
  });
}

type PartySnapshot = Record<string, unknown>;
type CommercialSnapshot = Record<string, unknown>;

export function buildCanonicalDocument(input: {
  contractTitle: string;
  contractVersion: string;
  contractType: string;
  contractContent: string;
  party: PartySnapshot;
  commercial: CommercialSnapshot;
}) {
  const partyLines = [
    `Nome: ${String(input.party.name ?? "—")}`,
    `CPF: ${String(input.party.cpf ?? "—")}`,
    `CNPJ: ${String(input.party.cnpj ?? "—")}`,
    `E-mail: ${String(input.party.email ?? "—")}`,
    `Telefone: ${String(input.party.phone ?? "—")}`,
    `User ID: ${String(input.party.user_id ?? "—")}`,
    `Company ID: ${String(input.party.company_id ?? "—")}`,
  ].join("\n");

  const commercialLines = Object.entries(input.commercial)
    .map(([k, v]) => `${k}: ${v == null || v === "" ? "—" : String(v)}`)
    .join("\n");

  return [
    "CONTRATO EVENTFEST — DOCUMENTO DE ACEITE",
    `Título: ${input.contractTitle}`,
    `Versão: ${input.contractVersion}`,
    `Tipo: ${input.contractType}`,
    "",
    "=== CONTRATANTE ===",
    partyLines,
    "",
    "=== CONDIÇÕES COMERCIAIS (CONGELADAS NO ACEITE) ===",
    commercialLines || "—",
    "",
    "=== TEXTO DO CONTRATO ===",
    input.contractContent.trim(),
  ].join("\n");
}

function wrapPdfLines(text: string, maxChars: number): string[] {
  const lines: string[] = [];
  for (const raw of text.replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.length ? raw : " ";
    if (line.length <= maxChars) {
      lines.push(line);
      continue;
    }
    let rest = line;
    while (rest.length > maxChars) {
      let cut = rest.lastIndexOf(" ", maxChars);
      if (cut < 20) cut = maxChars;
      lines.push(rest.slice(0, cut));
      rest = rest.slice(cut).trimStart();
    }
    if (rest) lines.push(rest);
  }
  return lines;
}

export async function buildAcceptancePdfBytes(input: {
  canonicalText: string;
  evidence: {
    acceptanceId: string;
    documentHash: string;
    acceptedAt: string;
    verificationMethod: string;
    verificationChannel: string;
    contractVersion: string;
    plan?: string | null;
  };
}): Promise<Uint8Array> {
  const evidenceBlock = [
    "",
    "=== EVIDÊNCIAS DO ACEITE ===",
    `ID do aceite: ${input.evidence.acceptanceId}`,
    `Versão do contrato: ${input.evidence.contractVersion}`,
    `Plano: ${input.evidence.plan ?? "—"}`,
    `Data/hora do aceite (UTC): ${input.evidence.acceptedAt}`,
    `Método de autenticação: ${input.evidence.verificationMethod}`,
    `Canal: ${input.evidence.verificationChannel}`,
    `Hash SHA-256 do documento: ${input.evidence.documentHash}`,
  ].join("\n");

  const full = `${input.canonicalText}\n${evidenceBlock}`;
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontSize = 9;
  const margin = 48;
  const pageWidth = 595;
  const pageHeight = 842;
  const maxChars = 95;
  const lineHeight = 12;
  const lines = wrapPdfLines(full, maxChars);

  let page = doc.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;
  for (const line of lines) {
    if (y < margin) {
      page = doc.addPage([pageWidth, pageHeight]);
      y = pageHeight - margin;
    }
    // pdf-lib WinAnsi: remove unsupported chars
    const safe = line.replace(/[^\u0020-\u007E\u00A0-\u00FF]/g, "?");
    page.drawText(safe, {
      x: margin,
      y,
      size: fontSize,
      font,
      color: rgb(0.05, 0.05, 0.05),
    });
    y -= lineHeight;
  }

  return await doc.save();
}

export async function loadPartyAndCommercial(
  admin: SupabaseClient,
  input: {
    userId: string;
    email: string;
    companyId?: string | null;
    billingPlanHint?: string | null;
  },
) {
  const { data: profile } = await admin
    .from("profiles")
    .select("first_name, last_name, cpf")
    .eq("id", input.userId)
    .maybeSingle();

  let company: Record<string, unknown> | null = null;
  if (input.companyId) {
    const { data } = await admin
      .from("companies")
      .select(
        "id, corporate_name, trade_name, cnpj, phone, billing_plan, billing_contract_id, listing_monthly_fee, consumption_license_fee, min_event_tickets",
      )
      .eq("id", input.companyId)
      .maybeSingle();
    company = data;
  }

  const { data: settings } = await admin
    .from("system_billing_settings")
    .select(
      "listing_monthly_default_fee, hybrid_consumption_commission_pct, consumption_license_commission_pct, credit_consumption_commission_pct, consumption_license_default_fee",
    )
    .eq("id", 1)
    .maybeSingle();

  const name = [profile?.first_name, profile?.last_name].filter(Boolean).join(" ").trim();
  const plan = input.billingPlanHint ?? (company?.billing_plan as string | null) ?? null;

  const party: PartySnapshot = {
    user_id: input.userId,
    company_id: input.companyId ?? null,
    name: name || null,
    cpf: profile?.cpf ?? null,
    cnpj: company?.cnpj ?? null,
    email: input.email,
    phone: company?.phone ?? null,
    corporate_name: company?.corporate_name ?? null,
    trade_name: company?.trade_name ?? null,
  };

  const commercial: CommercialSnapshot = {
    billing_plan: plan,
    billing_contract_id: company?.billing_contract_id ?? null,
    listing_monthly_fee: company?.listing_monthly_fee ?? settings?.listing_monthly_default_fee ?? null,
    consumption_license_fee:
      company?.consumption_license_fee ?? settings?.consumption_license_default_fee ?? null,
    min_event_tickets: company?.min_event_tickets ?? null,
    hybrid_consumption_commission_pct: settings?.hybrid_consumption_commission_pct ?? null,
    consumption_license_commission_pct: settings?.consumption_license_commission_pct ?? null,
    credit_consumption_commission_pct: settings?.credit_consumption_commission_pct ?? null,
    snapshot_at: new Date().toISOString(),
  };

  return { party, commercial, profile, company, settings };
}
