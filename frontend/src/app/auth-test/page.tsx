'use client';

import { useEffect, useState } from 'react';
import { onAuthChange, signInOrCreate, getCurrentIdToken, signOutUser } from '@/lib/auth';
import type { User } from 'firebase/auth';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4896';

interface MeResponse {
  uid: string;
  email: string;
  nickname: string;
  avatarUrl: string | null;
}

export default function AuthTestPage() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('Pa$$w0rd');
  const [sendStatus, setSendStatus] = useState<'idle' | 'sending' | 'error'>('idle');
  const [sendError, setSendError] = useState('');

  const [token, setToken] = useState<string | null>(null);
  const [meResp, setMeResp] = useState<MeResponse | null>(null);
  const [meError, setMeError] = useState('');

  useEffect(() => {
    return onAuthChange((u) => {
      setUser(u);
      setLoading(false);
    });
  }, []);

  async function handleSend() {
    setSendStatus('sending');
    setSendError('');
    try {
      await signInOrCreate(email.trim(), password);
      setSendStatus('idle');
    } catch (err) {
      setSendStatus('error');
      setSendError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleCallMe() {
    setMeError('');
    setMeResp(null);
    const t = await getCurrentIdToken();
    setToken(t);
    if (!t) {
      setMeError('No ID token (not signed in)');
      return;
    }
    try {
      const res = await fetch(`${API_URL}/auth/me`, {
        headers: { Authorization: `Bearer ${t}` },
      });
      if (!res.ok) {
        const body = await res.text();
        setMeError(`HTTP ${res.status}: ${body}`);
        return;
      }
      setMeResp(await res.json());
    } catch (err) {
      setMeError(err instanceof Error ? err.message : String(err));
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-green-900 text-white flex items-center justify-center">
        Loading...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-green-900 p-6 text-white">
      <div className="max-w-md mx-auto flex flex-col gap-6">
        <h1 className="text-2xl font-bold">🔐 Auth Test</h1>

        {!user && (
          <div className="bg-white/10 backdrop-blur rounded-2xl p-6 flex flex-col gap-4">
            <h2 className="text-lg font-semibold">Step 1 — Sign in</h2>
            <input
              type="email"
              placeholder="your@email.com"
              autoComplete="username"
              className="rounded-lg px-4 py-3 bg-white/20 placeholder-white/40 outline-none"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={sendStatus === 'sending'}
            />
            <input
              type="password"
              placeholder="password"
              autoComplete="current-password"
              className="rounded-lg px-4 py-3 bg-white/20 placeholder-white/40 outline-none"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={sendStatus === 'sending'}
            />
            <button
              className="rounded-xl py-3 bg-yellow-400 text-green-900 font-bold disabled:opacity-50"
              onClick={handleSend}
              disabled={sendStatus === 'sending' || !email.includes('@') || !password}
            >
              {sendStatus === 'sending' ? 'Signing in...' : 'Sign in'}
            </button>
            {sendStatus === 'error' && (
              <p className="text-sm text-red-300 break-all">❌ {sendError}</p>
            )}
          </div>
        )}

        {user && (
          <>
            <div className="bg-white/10 backdrop-blur rounded-2xl p-6 flex flex-col gap-2">
              <h2 className="text-lg font-semibold">Step 2 — Signed in</h2>
              <p className="text-sm">
                <span className="text-white/60">uid:</span> {user.uid}
              </p>
              <p className="text-sm">
                <span className="text-white/60">email:</span> {user.email}
              </p>
              <button
                className="mt-2 rounded-xl py-2 bg-white/20 text-sm"
                onClick={signOutUser}
              >
                Sign out
              </button>
            </div>

            <div className="bg-white/10 backdrop-blur rounded-2xl p-6 flex flex-col gap-4">
              <h2 className="text-lg font-semibold">Step 3 — Call GET /auth/me</h2>
              <button
                className="rounded-xl py-3 bg-yellow-400 text-green-900 font-bold"
                onClick={handleCallMe}
              >
                Call backend
              </button>
              {token && (
                <details className="text-xs text-white/60">
                  <summary className="cursor-pointer">ID token (first 40 chars)</summary>
                  <p className="break-all mt-1">{token.slice(0, 40)}...</p>
                </details>
              )}
              {meResp && (
                <div className="bg-green-700/50 rounded-lg p-3 text-sm">
                  <p className="text-green-200 font-bold mb-1">✅ Backend verified you:</p>
                  <pre className="text-xs overflow-x-auto">
                    {JSON.stringify(meResp, null, 2)}
                  </pre>
                </div>
              )}
              {meError && (
                <p className="text-sm text-red-300 break-all">❌ {meError}</p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
