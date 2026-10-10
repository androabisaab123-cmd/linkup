import { createClient } from '@supabase/supabase-js';
import './secure.css';

const url = import.meta.env.VITE_SUPABASE_URL?.trim();
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
const hasPlaceholderConfig = Boolean(
  /YOUR_PROJECT_REF|\.invalid(?:[/:]|$)/i.test(url || '') ||
  /REPLACE_WITH|preview_only/i.test(publishableKey || '')
);

if (url && publishableKey && !hasPlaceholderConfig) {
  window.linkupSupabase = createClient(url, publishableKey, {
    auth: {
      autoRefreshToken: true,
      detectSessionInUrl: true,
      persistSession: true,
    },
  });
  await import('./secure-app.js');
} else if (import.meta.env.DEV && !url && !publishableKey) {
  // Demo mode is deliberately limited to local development.
  await import('../app.js');
} else {
  const app = document.getElementById('app');
  const missing = [
    !url && 'VITE_SUPABASE_URL',
    !publishableKey && 'VITE_SUPABASE_PUBLISHABLE_KEY',
  ].filter(Boolean);
  const detail = hasPlaceholderConfig
    ? 'The Supabase values are still examples. Replace them with the Project URL and publishable key from your own Supabase project.'
    : `This production site does not use demo accounts. Add the missing Supabase environment variable${missing.length === 1 ? '' : 's'} in the hosting project, then redeploy.`;
  app.innerHTML = `<main class="s-center s-config-error"><div class="s-brand"><span class="brand-mark">↗</span> LINKUP</div><h1>LINKUP needs its account service configured.</h1><p>${detail}</p>${missing.length ? `<ul>${missing.map((name) => `<li><code>${name}</code></li>`).join('')}</ul>` : ''}<p>For local setup, replace the example values in <code>.env.local</code>. For Vercel, add the real values as project environment variables and redeploy.</p></main>`;
}
