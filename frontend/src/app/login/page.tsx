"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { signInOrCreate } from "@/lib/auth";
import { useAuth } from "@/hooks/useAuth";

export default function LoginPage() {
  const router = useRouter();
  const { user, loading } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "error">("idle");
  const [errMsg, setErrMsg] = useState("");

  useEffect(() => {
    if (!loading && user) {
      router.replace("/");
    }
  }, [loading, user, router]);

  async function handleSubmit() {
    if (!email.includes("@") || !password) return;
    setStatus("submitting");
    setErrMsg("");
    try {
      await signInOrCreate(email.trim(), password);
      // useAuth listener will pick up the new user and redirect via the effect above.
    } catch (err) {
      setStatus("error");
      setErrMsg(err instanceof Error ? err.message : String(err));
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
    <div className="min-h-screen bg-green-900 flex items-center justify-center p-4">
      <div className="bg-white/10 backdrop-blur rounded-2xl p-8 w-full max-w-sm flex flex-col gap-5">
        <h1 className="text-4xl font-bold text-white text-center tracking-wide">🀄 鬥地主</h1>

        <p className="text-white/70 text-sm text-center">
          只有受邀的 email 可以登入
        </p>

        <div className="flex flex-col gap-1">
          <label className="text-white/70 text-xs">Email</label>
          <input
            type="email"
            placeholder="your@email.com"
            autoComplete="username"
            className="rounded-lg px-4 py-3 bg-white/20 text-white placeholder-white/40 outline-none focus:ring-2 focus:ring-yellow-400"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
            disabled={status === "submitting"}
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-white/70 text-xs">密碼</label>
          <input
            type="password"
            placeholder="密碼"
            autoComplete="current-password"
            className="rounded-lg px-4 py-3 bg-white/20 text-white placeholder-white/40 outline-none focus:ring-2 focus:ring-yellow-400"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
            disabled={status === "submitting"}
          />
        </div>

        <button
          onClick={handleSubmit}
          disabled={status === "submitting" || !email.includes("@") || !password}
          className="rounded-xl py-3 text-lg font-bold bg-yellow-400 hover:bg-yellow-300 disabled:opacity-50 disabled:cursor-not-allowed text-green-900 transition-colors"
        >
          {status === "submitting" ? "登入中..." : "登入"}
        </button>

        {status === "error" && (
          <p className="text-red-300 text-sm text-center break-all">❌ {errMsg}</p>
        )}

        <p className="text-white/40 text-xs text-center">
          首次登入會自動建立帳號
        </p>
      </div>
    </div>
  );
}
