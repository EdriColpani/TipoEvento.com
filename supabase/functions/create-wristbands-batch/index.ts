import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // 1. Authentication Check
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Unauthorized: Missing Authorization header' }), { 
      status: 401, 
      headers: corsHeaders 
    });
  }
  
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: authHeader } } }
  );

  // Get user ID from JWT
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized: Invalid token or user not found' }), { 
      status: 401, 
      headers: corsHeaders 
    });
  }
  const userId = user.id;

  try {
    const { event_id, company_id, manager_user_id, base_code, access_type, price, quantity } = await req.json();

    // 2. Input Validation
    if (!event_id || !company_id || !manager_user_id || !base_code || !access_type || price === undefined || quantity === undefined || quantity < 1) {
      return new Response(JSON.stringify({ error: 'Missing or invalid required fields.' }), { 
        status: 400, 
        headers: corsHeaders 
      });
    }
    
    // 3. Security Check: Ensure the user is the manager of the company
    const { data: companyProfile, error: companyProfileError } = await supabase
        .from('companies')
        .select('id')
        .eq('id', company_id)
        .eq('user_id', userId) // Ensure the logged-in user owns this company
        .single();

    if (companyProfileError || !companyProfile) {
        return new Response(JSON.stringify({ error: 'Forbidden: User is not authorized to create wristbands for this company.' }), { 
            status: 403, 
            headers: corsHeaders 
        });
    }

    // 4. Insert the main wristband record
    const wristbandData = {
        event_id: event_id,
        company_id: company_id,
        manager_user_id: manager_user_id,
        code: base_code,
        access_type: access_type,
        status: 'active',
        price: price,
    };

    const { data: insertedWristband, error: insertWristbandError } = await supabase
        .from('wristbands')
        .insert([wristbandData])
        .select('id, code')
        .single();

    if (insertWristbandError) {
        if (insertWristbandError.code === '23505') { // Unique violation (code already exists)
            return new Response(JSON.stringify({ error: "O Código Base informado já está em uso. Tente um código diferente." }), { 
                status: 409, 
                headers: corsHeaders 
            });
        }
        throw insertWristbandError;
    }
    
    const wristbandId = insertedWristband.id;
    const wristbandCode = insertedWristband.code;

    // 5. Batch Insert wristband_analytics records
    const BATCH_SIZE = 100;
    let totalInsertedAnalytics = 0;

    for (let i = 0; i < quantity; i += BATCH_SIZE) {
        const batchToInsert = [];
        const currentBatchSize = Math.min(BATCH_SIZE, quantity - i);

        for (let j = 0; j < currentBatchSize; j++) {
            const seq = i + j + 1;
            const uniqueCode = `${wristbandCode}-${String(seq).padStart(3, '0')}`;
            batchToInsert.push({
                wristband_id: wristbandId,
                event_type: 'creation',
                client_user_id: null,
                code_wristbands: uniqueCode,
                status: 'active',
                sequential_number: seq,
                event_data: {
                    code: uniqueCode,
                    access_type: access_type,
                    price: price,
                    manager_id: manager_user_id,
                    event_id: event_id,
                    initial_status: 'active',
                    sequential_entry: seq,
                },
            });
        }

        const { error: analyticsError } = await supabase
            .from('wristband_analytics')
            .insert(batchToInsert);

        if (analyticsError) {
            console.error(`Warning: Failed to insert analytics batch starting at index ${i}:`, analyticsError);
            // Decide whether to throw an error or continue. For analytics, we might continue.
            // For this case, we'll throw to ensure all records are created or none.
            throw analyticsError; 
        }
        totalInsertedAnalytics += currentBatchSize;
    }

    return new Response(JSON.stringify({ 
        message: `Successfully created wristband "${wristbandCode}" and ${totalInsertedAnalytics} analytics records.`,
        count: totalInsertedAnalytics
    }), { 
        status: 200, 
        headers: corsHeaders 
    });

  } catch (error) {
    console.error('Edge Function Error:', error);
    return new Response(JSON.stringify({ error: error.message || 'Internal Server Error' }), { 
      status: 500, 
      headers: corsHeaders 
    });
  }
});