import { io, Socket } from "socket.io-client";

/**
 * Persist socket state on `window` (or `globalThis` on the server) so that
 * Next.js HMR module reloads do not lose the live connection. Without this,
 * editing any file causes lib/socket.ts to re-execute, resetting the module-
 * level singletons, which causes useSocket to construct a fresh socket on the
 * next render and disconnect the user from any room they're in.
 *
 * Ported verbatim from the DDZ frontend (SPEC_WUZIQI §4/§14 — do NOT alter the
 * recreation policy). The only change is the window key: __ddz_socket →
 * __wuziqi_socket, so the two apps never clash if ever served from one origin.
 */
interface SocketGlobal {
  __wuziqi_socket?: Socket | null;
  __wuziqi_uid?: string | null;
}
const g = (typeof window !== "undefined" ? window : globalThis) as SocketGlobal;

/**
 * Get the singleton socket for the given Firebase user.
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
 *     handled via destroySocket() called explicitly.
 *   - Different non-null uid → tear down + recreate (real user switch).
 *   - First call with no uid → return inert placeholder.
 */
export function getSocket(uid: string | null, idToken: string | null): Socket {
  // Same uid (including same null) → reuse
  if (g.__wuziqi_socket && g.__wuziqi_uid === uid) return g.__wuziqi_socket;

  // Transient "no user" while we already have a real socket → keep the socket
  if (g.__wuziqi_socket && g.__wuziqi_uid && !uid) return g.__wuziqi_socket;

  // Real user switch (uid → different uid) → tear down old
  if (g.__wuziqi_socket && g.__wuziqi_uid && uid && g.__wuziqi_uid !== uid) {
    g.__wuziqi_socket.disconnect();
    g.__wuziqi_socket.removeAllListeners();
    g.__wuziqi_socket = null;
  }

  // No uid and no existing socket → return inert placeholder so callers don't crash.
  if (!uid || !idToken) {
    g.__wuziqi_uid = null;
    g.__wuziqi_socket = io("ws://0.0.0.0:1", { autoConnect: false, reconnection: false });
    return g.__wuziqi_socket;
  }

  const url = process.env.NEXT_PUBLIC_WS_URL ?? "http://localhost:4897";
  console.log("[socket] creating new authed socket for uid:", uid);
  const s = io(url, {
    autoConnect: false,
    transports: ["websocket"],
    auth: { token: idToken },
  });
  g.__wuziqi_socket = s;
  g.__wuziqi_uid = uid;
  s.on("connect", () => console.log("[socket] connected, id:", s.id));
  s.on("disconnect", (reason) => console.log("[socket] disconnected:", reason));
  s.on("connect_error", (err) => console.error("[socket] connect_error:", err.message));
  s.on("auth_error", (data: { message: string }) => {
    console.error("[socket] auth_error:", data.message);
  });
  return s;
}

/** Explicit sign-out: tear down the live socket. Call from signOutUser flow. */
export function destroySocket(): void {
  if (g.__wuziqi_socket) {
    g.__wuziqi_socket.disconnect();
    g.__wuziqi_socket.removeAllListeners();
    g.__wuziqi_socket = null;
    g.__wuziqi_uid = null;
  }
}
