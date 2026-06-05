import { io, Socket } from "socket.io-client";

/**
 * The two games served by the unified frontend. Each has its OWN backend
 * (separate NestJS process / origin), so each gets its own socket singleton.
 */
export type Game = "ddz" | "wuziqi";
export const GAMES: Game[] = ["ddz", "wuziqi"];

/**
 * Per-game WebSocket base URL. Falls back to the local dev ports
 * (DDZ 4896 / wuziqi 4897). Override in prod via env.
 */
function wsUrl(game: Game): string {
  if (game === "ddz") {
    return (
      process.env.NEXT_PUBLIC_DDZ_WS_URL ??
      process.env.NEXT_PUBLIC_WS_URL ?? // legacy single-backend var
      "http://localhost:4896"
    );
  }
  return process.env.NEXT_PUBLIC_WUZIQI_WS_URL ?? "http://localhost:4897";
}

/**
 * Persist socket state on `window` (or `globalThis` on the server) so that
 * Next.js HMR module reloads do not lose the live connection. Without this,
 * editing any file causes lib/socket.ts to re-execute, resetting the module-
 * level singletons, which causes useSocket to construct a fresh socket on the
 * next render and disconnect the user from any room they're in.
 *
 * We keep ONE entry per game so the unified lobby can hold both connections
 * open at once. The window keys are namespaced by game (e.g. __sock_ddz) so the
 * two never clash.
 */
interface SocketEntry {
  socket: Socket | null;
  uid: string | null;
}
interface SocketGlobal {
  __game_sockets?: Partial<Record<Game, SocketEntry>>;
}
const g = (typeof window !== "undefined" ? window : globalThis) as SocketGlobal;

function entry(game: Game): SocketEntry {
  if (!g.__game_sockets) g.__game_sockets = {};
  if (!g.__game_sockets[game]) g.__game_sockets[game] = { socket: null, uid: null };
  return g.__game_sockets[game]!;
}

/**
 * Get the singleton socket for the given Firebase user and game.
 *
 * Important: we key the socket on UID (stable identity), NOT on the ID token.
 * Firebase rotates the ID token internally roughly every hour; we don't want
 * to tear down the live WebSocket every time that happens (it would drop the
 * player from the current game). Auth only matters at handshake time — once
 * connected, the backend has attached the AuthedUser to socket.data.user
 * and the connection stays valid for as long as it's open.
 *
 * Recreation policy (carefully chosen to survive React Strict Mode and HMR):
 *   - Same uid as before → return the existing socket. No-op.
 *   - Null uid while we already have an authed socket → return the existing
 *     socket UNCHANGED. The "no user" state is treated as transient (Firebase
 *     auth resolving, Strict Mode double-render, etc). Real sign-out is
 *     handled via destroySocket()/destroyAllSockets() called explicitly.
 *   - Different non-null uid → tear down + recreate (real user switch).
 *   - First call with no uid → return inert placeholder.
 */
export function getSocket(
  uid: string | null,
  idToken: string | null,
  game: Game = "ddz",
): Socket {
  const e = entry(game);

  // Same uid (including same null) → reuse
  if (e.socket && e.uid === uid) return e.socket;

  // Transient "no user" while we already have a real socket → keep the socket
  if (e.socket && e.uid && !uid) return e.socket;

  // Real user switch (uid → different uid) → tear down old
  if (e.socket && e.uid && uid && e.uid !== uid) {
    e.socket.disconnect();
    e.socket.removeAllListeners();
    e.socket = null;
  }

  // No uid and no existing socket → return inert placeholder so callers don't crash.
  if (!uid || !idToken) {
    e.uid = null;
    e.socket = io("ws://0.0.0.0:1", { autoConnect: false, reconnection: false });
    return e.socket;
  }

  const url = wsUrl(game);
  console.log(`[socket:${game}] creating new authed socket for uid:`, uid);
  const s = io(url, {
    autoConnect: false,
    transports: ["websocket"],
    auth: { token: idToken },
  });
  e.socket = s;
  e.uid = uid;
  s.on("connect", () => console.log(`[socket:${game}] connected, id:`, s.id));
  s.on("disconnect", (reason) => console.log(`[socket:${game}] disconnected:`, reason));
  s.on("connect_error", (err) => console.error(`[socket:${game}] connect_error:`, err.message));
  s.on("auth_error", (data: { message: string }) => {
    console.error(`[socket:${game}] auth_error:`, data.message);
  });
  return s;
}

/** Tear down the live socket for a single game. */
export function destroySocket(game: Game): void {
  const e = entry(game);
  if (e.socket) {
    e.socket.disconnect();
    e.socket.removeAllListeners();
    e.socket = null;
    e.uid = null;
  }
}

/** Explicit sign-out: tear down ALL game sockets. Call from signOutUser flow. */
export function destroyAllSockets(): void {
  for (const game of GAMES) destroySocket(game);
}
