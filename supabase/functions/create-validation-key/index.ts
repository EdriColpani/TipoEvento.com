import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};

/** Sempre 200 → invoke não estoura FunctionsHttpError; erros vêm em success: false */
const json200 = (obj: Record<string, unknown>) =>
  new Response(JSON.stringify(obj), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const supabaseService = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
);

async function hashApiKey(apiKey: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(apiKey);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function generateApiKey(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const randomBytes = new Uint8Array(8);
  crypto.getRandomValues(randomBytes);
  let apiKey = "";
  for (let i = 0; i < 8; i++) {
    apiKey += chars[randomBytes[i]! % chars.length];
  }
  return apiKey;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json200({ success: false, error: "method_not_allowed" });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json200({
        success: false,
        error:
          "Sem token de sessão. Desligue Verify JWT na função no Dashboard (Edge Functions → create-validation-key → Details) e faça login de novo.",
        hint: "gateway_or_session",
      });
    }
    const jwt = authHeader.slice(7).trim();
    const { data: userData, error: userError } =
      await supabaseService.auth.getUser(jwt);
    const user = userData?.user;
    if (userError || !user) {
      console.error("[create-validation-key] getUser:", userError?.message);
      return json200({
        success: false,
        error:
          "Sessão inválida. Atualize a página ou entre de novo no gestor.",
      });
    }

    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return json200({ success: false, error: "invalid_json" });
    }

    const name = String(body.name ?? "").trim();
    const event_id = body.event_id as string;
    const expires_at = body.expires_at as string;
    const created_by = body.created_by as string;

    if (!name) {
      return json200({ success: false, error: "Nome do colaborador é obrigatório." });
    }
    if (!event_id) {
      return json200({ success: false, error: "É obrigatório selecionar um evento." });
    }
    if (!expires_at) {
      return json200({
        success: false,
        error: "Data de expiração é obrigatória.",
      });
    }
    if (created_by !== user.id) {
      return json200({
        success: false,
        error: "ID do criador não corresponde ao usuário autenticado.",
      });
    }

    const { data: eventData, error: eventError } = await supabaseService
      .from("events")
      .select("id, company_id")
      .eq("id", event_id)
      .single();

    if (eventError || !eventData) {
      return json200({ success: false, error: "Evento não encontrado." });
    }

    const { data: userCompany, error: companyError } = await supabaseService
      .from("user_companies")
      .select("company_id")
      .eq("user_id", user.id)
      .eq("is_primary", true)
      .single();

    if (
      companyError ||
      !userCompany ||
      userCompany.company_id !== eventData.company_id
    ) {
      const { data: profile } = await supabaseService
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .single();

      if (profile?.role !== "admin_master") {
        return json200({
          success: false,
          error: "Você não tem permissão para criar chaves para este evento.",
        });
      }
    }

    let apiKey: string;
    let apiKeyHash: string;
    let attempts = 0;
    const maxAttempts = 5;

    do {
      apiKey = generateApiKey();
      apiKeyHash = await hashApiKey(apiKey);
      const { data: existingKey } = await supabaseService
        .from("validation_api_keys")
        .select("id")
        .eq("api_key_hash", apiKeyHash)
        .maybeSingle();
      if (!existingKey) break;
      attempts++;
      if (attempts >= maxAttempts) {
        return json200({
          success: false,
          error: "Erro ao gerar chave única. Tente novamente.",
        });
      }
    } while (attempts < maxAttempts);

    const { data: insertedKey, error: insertError } = await supabaseService
      .from("validation_api_keys")
      .insert({
        name: name,
        api_key: apiKey,
        api_key_hash: apiKeyHash,
        event_id: event_id,
        is_active: true,
        expires_at: expires_at,
        created_by: created_by,
      })
      .select("id, name, event_id, is_active, expires_at, created_at")
      .single();

    if (insertError || !insertedKey) {
      console.error("[create-validation-key] insert:", insertError);
      return json200({
        success: false,
        error: "Erro ao criar chave de acesso. Tente novamente.",
      });
    }

    return json200({
      success: true,
      key: {
        id: insertedKey.id,
        name: insertedKey.name,
        api_key: apiKey,
        event_id: insertedKey.event_id,
        is_active: insertedKey.is_active,
        expires_at: insertedKey.expires_at,
        created_at: insertedKey.created_at,
      },
    });
  } catch (e) {
    console.error("[create-validation-key]", e);
    return json200({ success: false, error: "Erro inesperado ao criar chave." });
  }
});
