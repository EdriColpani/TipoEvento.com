import { createClient } from '@supabase/supabase-js';
import { captureAuthUrlCallbackAtBoot } from '@/utils/auth-url-callback';

// Hash do /auth/v1/verify (type=signup) precisa ser lido antes do detectSessionInUrl.
captureAuthUrlCallbackAtBoot();

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
        '[Supabase] Defina VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no .env antes de iniciar o app.',
    );
}

export { supabaseUrl, supabaseAnonKey };

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
