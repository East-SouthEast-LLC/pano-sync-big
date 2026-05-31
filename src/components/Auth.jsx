import { useState } from 'react';
import { supabase } from '../lib/supabaseClient';

export default function Auth() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);

  const handleSubmit = async () => {
    setLoading(true);
    setMessage(null);
    setError(null);

    if (isSignUp) {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: fullName,
            company_name: companyName,
          }
        }
      });
      if (error) {
        setError(error.message);
      } else {
        setMessage('Check your email to confirm your account.');
        fetch('https://ayktuzidcoolddlphqia.supabase.co/functions/v1/send-email', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF5a3R1emlkY29vbGRkbHBocWlhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkwMzQ3OTksImV4cCI6MjA5NDYxMDc5OX0.m9Ymo-ZQ1U8QtHoeXwHMwBaowqBiYoeDiuqTCDmfGwo',
          },
          body: JSON.stringify({ type: 'welcome', to: email, data: { name: fullName } }),
        }).catch(() => {});
      }
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setError(error.message);
    }

    setLoading(false);
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-5">
      <div className="w-full max-w-sm border rounded-xl p-6 bg-white shadow-md space-y-4">
        <h1 className="text-2xl font-bold text-[#2D2D31]">panoramap</h1>
        <p className="text-sm text-gray-500">{isSignUp ? 'Create an account' : 'Sign in to continue'}</p>

        {isSignUp && (
          <>
            <input type="text" placeholder="Full Name" value={fullName}
              onChange={e => setFullName(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-pink-300" />

            <input type="text" placeholder="Company Name" value={companyName}
              onChange={e => setCompanyName(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-pink-300" />
          </>
        )}

        <input type="email" placeholder="Email" value={email}
          onChange={e => setEmail(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-pink-300" />

        <input type="password" placeholder="Password" value={password}
          onChange={e => setPassword(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-pink-300" />

        {error && <p className="text-sm text-red-600">{error}</p>}
        {message && <p className="text-sm text-green-600">{message}</p>}

        <button onClick={handleSubmit} disabled={loading}
          className="w-full py-2 rounded-md bg-[#FD366E] text-white text-sm font-medium hover:bg-pink-600 transition-colors disabled:opacity-50">
          {loading ? 'Please wait...' : isSignUp ? 'Sign Up' : 'Sign In'}
        </button>

        <button onClick={() => { setIsSignUp(!isSignUp); setError(null); setMessage(null); }}
          className="w-full text-sm text-gray-500 hover:text-gray-700">
          {isSignUp ? 'Already have an account? Sign in' : "Don't have an account? Sign up"}
        </button>
      </div>
    </div>
  );
}
