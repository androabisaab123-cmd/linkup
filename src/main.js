import { createClient } from '@supabase/supabase-js';
import './secure.css';

const url = import.meta.env.VITE_SUPABASE_URL?.trim();
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();

if (url && publishableKey) {
  window.linkupSupabase = createClient(url, publishableKey, {
    auth: {
      autoRefreshToken: true,
      detectSessionInUrl: true,
      persistSession: true,
    },
  });
  await import('./secure-app.js');
} else {
  // Keep the existing prototype usable until the owner connects a Supabase project.
  // The demo app prominently identifies its local-only authentication and storage.
  await import('../app.js');
}
