import { createClient } from '@supabase/supabase-js';
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storageKey: 'sb-ayktuzidcoolddlphqia-auth-token',
    storage: window.localStorage,
    persistSession: true,
    detectSessionInUrl: true,
  }
});
(async () => {
  const params = new URLSearchParams(window.location.search);
  const token  = params.get('token');
  if (token) {
    await supabase.auth.setSession({ access_token: token, refresh_token: '' });
    window.history.replaceState({}, '', window.location.pathname);
  }
})();