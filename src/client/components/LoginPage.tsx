import { useState } from 'react';
import { supabase } from '../../lib/supabaseClient.js';

interface LoginPageProps {
  onSuccess: () => void;
}

export default function LoginPage({ onSuccess }: LoginPageProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showAdminSecret, setShowAdminSecret] = useState(false);
  const [adminSecret, setAdminSecret] = useState('');

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { error: err } = await supabase.auth.signInWithPassword({ email, password });
      if (err) {
        setError(err.message);
        return;
      }
      onSuccess();
    } finally {
      setLoading(false);
    }
  };

  const handleAdminSecret = (e: React.FormEvent) => {
    e.preventDefault();
    if (adminSecret) {
      localStorage.setItem('adminSecret', adminSecret);
      onSuccess();
    }
  };

  return (
    <div className="min-h-screen bg-cream flex items-center justify-center p-4">
      <div className="bg-white rounded-lg border border-gray-200 p-6 w-full max-w-sm">
        <form onSubmit={handleSignIn}>
          <h1 className="text-xl font-semibold text-gray-800 mb-4">Sign in</h1>
          <div className="space-y-3">
            <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded text-sm"
              required
            />
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded text-sm"
              required
            />
          </div>
          {error && <p className="text-red-600 text-sm mt-2">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="mt-4 w-full py-2 bg-nakie-teal text-white rounded text-sm font-medium disabled:opacity-50"
          >
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
        </form>
        <div className="mt-4 pt-4 border-t border-gray-100">
          <button
            type="button"
            onClick={() => setShowAdminSecret(!showAdminSecret)}
            className="text-xs text-gray-500 hover:text-gray-700"
          >
            {showAdminSecret ? 'Hide' : 'Or use admin secret'}
          </button>
          {showAdminSecret && (
            <form onSubmit={handleAdminSecret} className="mt-2">
              <input
                type="password"
                placeholder="Admin secret"
                value={adminSecret}
                onChange={(e) => setAdminSecret(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded text-sm"
              />
              <button type="submit" className="mt-2 text-xs text-nakie-teal hover:underline">
                Continue
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
