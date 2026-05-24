"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/hooks/useAuth";
import { useProfile } from "@/hooks/useProfile";
import { resizeAvatarToDataUrl } from "@/lib/avatar";
import { GameHistory } from "@/components/GameHistory";

function Avatar({
  nickname,
  avatarUrl,
  size = 480,
}: {
  nickname: string;
  avatarUrl: string | null;
  size?: number;
}) {
  if (avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={avatarUrl}
        alt={nickname}
        className="rounded-full object-cover bg-white/10"
        style={{ width: size, height: size }}
      />
    );
  }
  const initial = nickname.slice(0, 1).toUpperCase();
  return (
    <div
      className="rounded-full bg-yellow-400 text-green-900 font-bold flex items-center justify-center"
      style={{ width: size, height: size, fontSize: size * 0.5 }}
    >
      {initial}
    </div>
  );
}

function StatCell({ label, value, accent }: { label: string; value: number | string; accent?: string }) {
  return (
    <div className="bg-white/5 rounded-lg p-3 flex flex-col items-center gap-1">
      <span className="text-white/50 text-xs uppercase tracking-wider">{label}</span>
      <span className={`text-2xl font-bold ${accent ?? "text-white"}`}>{value}</span>
    </div>
  );
}

export default function ProfilePage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { me, stats, loading, error, updateNickname, updateAvatar } = useProfile();

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [authLoading, user, router]);

  async function handleAvatarFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // reset so same file can be picked again
    if (!file || !user) return;
    setAvatarError(null);
    setUploading(true);
    try {
      const dataUrl = await resizeAvatarToDataUrl(file);
      await updateAvatar(dataUrl);
    } catch (err) {
      setAvatarError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  }

  async function handleRemoveAvatar() {
    if (!me?.avatarUrl) return;
    setAvatarError(null);
    setUploading(true);
    try {
      await updateAvatar(null);
    } catch (err) {
      setAvatarError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  }

  function startEdit() {
    if (!me) return;
    setDraft(me.nickname);
    setSaveError(null);
    setEditing(true);
  }

  async function saveEdit() {
    const next = draft.trim();
    if (!next || next === me?.nickname) {
      setEditing(false);
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      await updateNickname(next);
      setEditing(false);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-green-900 text-white flex items-center justify-center">
        Loading...
      </div>
    );
  }

  if (!user || !me) {
    return (
      <div className="min-h-screen bg-green-900 text-white flex items-center justify-center">
        Not signed in
      </div>
    );
  }

  const winRatePct = stats && stats.games > 0 ? Math.round(stats.winRate * 100) : 0;

  return (
    <div className="min-h-screen bg-green-900 text-white p-4">
      <div className="max-w-2xl mx-auto flex flex-col gap-6">
        <div className="flex items-center justify-between pt-2">
          <Link href="/" className="text-white/60 hover:text-white text-sm">
            ← 返回大廳
          </Link>
        </div>

        {/* Header */}
        <div className="bg-white/10 backdrop-blur rounded-2xl p-6 flex flex-col items-center gap-4">
          <div className="relative">
            <Avatar nickname={me.nickname} avatarUrl={me.avatarUrl} />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              title="更換頭像"
              className="absolute bottom-2 right-2 w-16 h-16 rounded-full bg-yellow-400 text-green-900 text-2xl font-bold flex items-center justify-center hover:bg-yellow-300 disabled:opacity-50 shadow-lg"
            >
              {uploading ? "…" : "📷"}
            </button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleAvatarFile}
          />
          {me.avatarUrl && !uploading && (
            <button
              onClick={handleRemoveAvatar}
              className="text-white/50 hover:text-white text-xs underline"
            >
              移除頭像
            </button>
          )}
          {avatarError && (
            <p className="text-red-300 text-xs text-center break-all">{avatarError}</p>
          )}

          {!editing ? (
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold">{me.nickname}</h1>
              <button
                onClick={startEdit}
                className="text-white/50 hover:text-white text-sm"
                title="編輯暱稱"
              >
                ✏️
              </button>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 w-full max-w-xs">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                maxLength={20}
                autoFocus
                disabled={saving}
                className="rounded-lg px-4 py-2 bg-white/20 text-white text-center text-xl outline-none focus:ring-2 focus:ring-yellow-400 w-full"
                onKeyDown={(e) => {
                  if (e.key === "Enter") void saveEdit();
                  if (e.key === "Escape") setEditing(false);
                }}
              />
              <div className="flex gap-2">
                <button
                  onClick={saveEdit}
                  disabled={saving || !draft.trim()}
                  className="rounded-lg px-4 py-1.5 bg-yellow-400 text-green-900 font-bold text-sm disabled:opacity-50"
                >
                  {saving ? "儲存中..." : "儲存"}
                </button>
                <button
                  onClick={() => setEditing(false)}
                  disabled={saving}
                  className="rounded-lg px-4 py-1.5 bg-white/20 text-white text-sm"
                >
                  取消
                </button>
              </div>
              {saveError && (
                <p className="text-red-300 text-xs text-center break-all">{saveError}</p>
              )}
            </div>
          )}

          <p className="text-white/50 text-sm">{me.email}</p>
        </div>

        {/* Stats */}
        <div className="bg-white/10 backdrop-blur rounded-2xl p-6 flex flex-col gap-4">
          <h2 className="text-sm uppercase tracking-wider text-white/60">戰績</h2>

          {error && <p className="text-red-300 text-sm">{error}</p>}

          {stats ? (
            <>
              <div className="grid grid-cols-2 gap-2">
                <StatCell label="總勝" value={stats.totalWins} accent="text-yellow-400" />
                <StatCell label="場次" value={stats.games} />
                <StatCell label="地主勝" value={stats.landlordWins} accent="text-red-300" />
                <StatCell label="農民勝" value={stats.farmerWins} accent="text-green-300" />
              </div>
              <div className="bg-white/5 rounded-lg p-3 flex justify-between items-center">
                <span className="text-white/60 text-sm">勝率</span>
                <span className="text-xl font-bold text-yellow-400">{winRatePct}%</span>
              </div>
            </>
          ) : (
            <p className="text-white/40 text-sm text-center py-4">尚無比賽記錄</p>
          )}
        </div>

        {/* Game history */}
        <GameHistory />
      </div>
    </div>
  );
}
