import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables');
}

// Public client for client-side operations
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Admin client for server-side operations (with service role key)
export const supabaseAdmin = supabaseServiceRoleKey 
  ? createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    })
  : null;

// Auth configuration
export const authConfig = {
  providers: {
    google: {
      enabled: true,
    },
    apple: {
      enabled: true,
    },
    // Disable all other providers
    email: false,
    phone: false,
    github: false,
    facebook: false,
    twitter: false,
  }
}; 