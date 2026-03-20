import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabaseClient.js';
import LoginPage from './LoginPage';
import App from '../App';

export default function AuthGuard() {
  const [session, setSession] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      setLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
    });
    return () => subscription.unsubscribe();
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-cream flex items-center justify-center">
        <span className="text-gray-500 text-sm">Loading...</span>
      </div>
    );
  }

  const hasAdminSecret = typeof localStorage !== 'undefined' && !!localStorage.getItem('adminSecret');
  if (session || hasAdminSecret) {
    return <App />;
  }

  return (
    <LoginPage
      onSuccess={() => supabase.auth.getSession().then(({ data: { session: s } }) => setSession(s))}
    />
  );
}
