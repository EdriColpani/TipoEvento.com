import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};

// Initialize Supabase client with Service Role Key for secure backend operations
const supabaseService = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
);

// Função para gerar hash da API key (usando SHA-256 nativo do Deno)
async function hashApiKey(apiKey: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(apiKey);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hashBuffer))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

// Função para gerar chave aleatória (8 caracteres alfanuméricos: A-Z, 0-9)
function generateApiKey(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const randomBytes = new Uint8Array(8);
    crypto.getRandomValues(randomBytes);
    
    let apiKey = '';
    for (let i = 0; i < 8; i++) {
        apiKey += chars[randomBytes[i] % chars.length];
    }
    
    return apiKey;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // 1. Autenticação - verificar se o usuário está autenticado
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ 
        success: false,
        error: 'Não autorizado: Token de autenticação não fornecido.' 
      }), { 
        status: 401, 
        headers: corsHeaders 
      });
    }

    const supabaseAnon = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: userError } = await supabaseAnon.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ 
        success: false,
        error: 'Não autorizado: Token inválido ou usuário não encontrado.' 
      }), { 
        status: 401, 
        headers: corsHeaders 
      });
    }

    // 2. Obter dados da requisição
    const body = await req.json();
    const { name, event_id, expires_at, created_by } = body;

    // 3. Validações
    if (!name || !name.trim()) {
      return new Response(JSON.stringify({ 
        success: false,
        error: 'Nome do colaborador é obrigatório.' 
      }), { 
        status: 400, 
        headers: corsHeaders 
      });
    }

    if (!event_id) {
      return new Response(JSON.stringify({ 
        success: false,
        error: 'É obrigatório selecionar um evento.' 
      }), { 
        status: 400, 
        headers: corsHeaders 
      });
    }

    if (!expires_at) {
      return new Response(JSON.stringify({ 
        success: false,
        error: 'Data de expiração é obrigatória.' 
      }), { 
        status: 400, 
        headers: corsHeaders 
      });
    }

    if (created_by !== user.id) {
      return new Response(JSON.stringify({ 
        success: false,
        error: 'ID do criador não corresponde ao usuário autenticado.' 
      }), { 
        status: 403, 
        headers: corsHeaders 
      });
    }

    // 4. Verificar se o evento existe e pertence à empresa do usuário
    const { data: eventData, error: eventError } = await supabaseService
      .from('events')
      .select('id, company_id')
      .eq('id', event_id)
      .single();

    if (eventError || !eventData) {
      return new Response(JSON.stringify({ 
        success: false,
        error: 'Evento não encontrado.' 
      }), { 
        status: 404, 
        headers: corsHeaders 
      });
    }

    // Verificar se o usuário tem acesso a este evento (via company)
    const { data: userCompany, error: companyError } = await supabaseService
      .from('user_companies')
      .select('company_id')
      .eq('user_id', user.id)
      .eq('is_primary', true)
      .single();

    if (companyError || !userCompany || userCompany.company_id !== eventData.company_id) {
      // Verificar se é admin master
      const { data: profile } = await supabaseService
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single();

      if (profile?.role !== 'admin_master') {
        return new Response(JSON.stringify({ 
          success: false,
          error: 'Você não tem permissão para criar chaves para este evento.' 
        }), { 
          status: 403, 
          headers: corsHeaders 
        });
      }
    }

    // 5. Gerar chave aleatória
    let apiKey: string;
    let apiKeyHash: string;
    let attempts = 0;
    const maxAttempts = 5;

    do {
      apiKey = generateApiKey();
      apiKeyHash = await hashApiKey(apiKey);

      // Verificar se já existe uma chave com o mesmo hash
      const { data: existingKey } = await supabaseService
        .from('validation_api_keys')
        .select('id')
        .eq('api_key_hash', apiKeyHash)
        .single();

      if (!existingKey) {
        break; // Chave única encontrada
      }

      attempts++;
      if (attempts >= maxAttempts) {
        return new Response(JSON.stringify({ 
          success: false,
          error: 'Erro ao gerar chave única. Tente novamente.' 
        }), { 
          status: 500, 
          headers: corsHeaders 
        });
      }
    } while (attempts < maxAttempts);

    // 6. Inserir chave no banco de dados
    const { data: insertedKey, error: insertError } = await supabaseService
      .from('validation_api_keys')
      .insert({
        name: name.trim(),
        api_key: apiKey, // Guardar temporariamente para mostrar ao usuário
        api_key_hash: apiKeyHash,
        event_id: event_id,
        is_active: true,
        expires_at: expires_at,
        created_by: created_by,
      })
      .select('id, name, event_id, is_active, expires_at, created_at')
      .single();

    if (insertError || !insertedKey) {
      console.error('[create-validation-key] Erro ao inserir chave:', insertError);
      return new Response(JSON.stringify({ 
        success: false,
        error: 'Erro ao criar chave de acesso. Tente novamente.' 
      }), { 
        status: 500, 
        headers: corsHeaders 
      });
    }

    // 7. Retornar chave em texto plano (apenas uma vez)
    return new Response(JSON.stringify({ 
      success: true,
      key: {
        id: insertedKey.id,
        name: insertedKey.name,
        api_key: apiKey, // Chave em texto plano - mostrar apenas uma vez
        event_id: insertedKey.event_id,
        is_active: insertedKey.is_active,
        expires_at: insertedKey.expires_at,
        created_at: insertedKey.created_at,
      }
    }), { 
      status: 200, 
      headers: corsHeaders 
    });

  } catch (error) {
    console.error('[create-validation-key] Erro inesperado:', error);
    return new Response(JSON.stringify({ 
      success: false,
      error: 'Erro inesperado ao criar chave de acesso.' 
    }), { 
      status: 500, 
      headers: corsHeaders 
    });
  }
});

