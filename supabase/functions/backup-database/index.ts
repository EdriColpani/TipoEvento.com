import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Max-Age": "86400",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ success: false, error: "Não autorizado." }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseAnon = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: userError } = await supabaseAnon.auth.getUser();
    if (userError || !user) {
      return new Response(
        JSON.stringify({ success: false, error: "Não autorizado." }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseService = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const { data: profile } = await supabaseService
      .from("profiles")
      .select("tipo_usuario_id")
      .eq("id", user.id)
      .single();

    if (!profile || profile.tipo_usuario_id !== 1) {
      return new Response(
        JSON.stringify({ success: false, error: "Acesso negado. Apenas Administrador Global." }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: ddl, error: ddlError } = await supabaseService.rpc("get_public_schema_ddl");
    if (ddlError) {
      console.error("[backup-database] get_public_schema_ddl error:", ddlError);
      return new Response(
        JSON.stringify({ success: false, error: "Erro ao gerar DDL do esquema." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: tableNames, error: tablesError } = await supabaseService.rpc("get_public_table_names");
    if (tablesError) {
      console.error("[backup-database] get_public_table_names error:", tablesError);
      return new Response(
        JSON.stringify({ success: false, error: "Erro ao listar tabelas." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const tables: string[] = Array.isArray(tableNames) ? tableNames : (tableNames ? [tableNames] : []);
    let dataSection = "\n-- Dados\n\n";

    for (const tableName of tables) {
      const { data: rows, error: selectError } = await supabaseService
        .from(tableName)
        .select("*");

      if (selectError) {
        dataSection += `-- Erro ao ler tabela ${tableName}: ${selectError.message}\n`;
        continue;
      }
      if (!rows || rows.length === 0) {
        dataSection += `-- Tabela public.${tableName}: sem dados\n`;
        continue;
      }

      const cols = Object.keys(rows[0]);
      const colList = cols.map((c) => `"${c}"`).join(", ");

      for (const row of rows) {
        const vals = cols.map((col) => toSqlLiteral((row as Record<string, unknown>)[col]));
        dataSection += `INSERT INTO public."${tableName}" (${colList}) VALUES (${vals.join(", ")});\n`;
      }
      dataSection += "\n";
    }

    const fullSql = (ddl ?? "") + dataSection;
    const now = new Date();
    const ts =
      now.getFullYear() +
      String(now.getMonth() + 1).padStart(2, "0") +
      String(now.getDate()).padStart(2, "0") +
      "_" +
      String(now.getHours()).padStart(2, "0") +
      String(now.getMinutes()).padStart(2, "0") +
      String(now.getSeconds()).padStart(2, "0");
    const filename = `backup_${ts}.sql`;

    return new Response(fullSql, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/sql",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    console.error("[backup-database] unexpected error:", err);
    return new Response(
      JSON.stringify({ success: false, error: "Erro inesperado ao gerar backup." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

function toSqlLiteral(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number" && !Number.isNaN(v)) return String(v);
  if (typeof v === "object") return "'" + escapeSqlString(JSON.stringify(v)) + "'";
  return "'" + escapeSqlString(String(v)) + "'";
}

function escapeSqlString(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/'/g, "''");
}
