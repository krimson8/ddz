import { getCurrentIdToken } from "./auth";
import type { Game } from "./socket";

/** Per-game REST base URL. DDZ falls back to the legacy single-backend var. */
function apiUrl(game: Game): string {
  if (game === "ddz") {
    return (
      process.env.NEXT_PUBLIC_DDZ_API_URL ??
      process.env.NEXT_PUBLIC_API_URL ??
      "http://localhost:4896"
    );
  }
  return process.env.NEXT_PUBLIC_WUZIQI_API_URL ?? "http://localhost:4897";
}

/**
 * Authenticated fetch wrapper. Attaches the current Firebase ID token as a
 * Bearer header. Throws if the user is not signed in or the response is non-2xx.
 *
 * `game` selects which backend to hit (defaults to DDZ for backward compat).
 */
export async function apiFetch<T = unknown>(
  path: string,
  init: RequestInit = {},
  game: Game = "ddz",
): Promise<T> {
  const token = await getCurrentIdToken();
  if (!token) throw new Error("Not signed in");

  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(`${apiUrl(game)}${path}`, { ...init, headers });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${text || res.statusText}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
