import { createClient } from '@supabase/supabase-js';

export const supabaseUrl =
  import.meta.env.VITE_SUPABASE_URL ?? 'https://yzwfjyejqvawhooecbem.supabase.co';
export const supabaseAnonKey =
  import.meta.env.VITE_SUPABASE_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl6d2ZqeWVqcXZhd2hvb2VjYmVtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM2NjU1MTYsImV4cCI6MjA3OTI0MTUxNn0.6gE4zuVgkFqqjFFCmISzV_M4aVhXygG0IFsW4RP0n5I';

/** Mesmo projeto que a URL (senão Edge Functions → 401). */
try {
  const refFromUrl = new URL(supabaseUrl).hostname.split('.')[0];
  const refFromKey = JSON.parse(atob(supabaseAnonKey.split('.')[1])).ref as string;
  if (refFromUrl !== refFromKey) {
    console.error(
      '[Supabase] VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY são de projetos diferentes → 401 nas Edge Functions. No Dashboard do projeto',
      refFromUrl,
      'copie a anon key em Settings → API e coloque em VITE_SUPABASE_ANON_KEY.',
    );
  }
} catch {
  /* ignore */
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);