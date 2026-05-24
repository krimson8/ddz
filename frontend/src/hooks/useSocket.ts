"use client";

import { useEffect, useState } from "react";
import { Socket } from "socket.io-client";
import { getSocket } from "@/lib/socket";
import { onAuthChange } from "@/lib/auth";

interface AuthCreds {
  uid: string;
  token: string;
}

/**
 * Returns a socket bound to the current Firebase user. The socket is keyed by
 * uid (stable) — Firebase's internal token refreshes do NOT recreate the
 * socket, since the backend only verifies the token at handshake time.
 *
 * The socket is only torn down when the user actually signs out or switches.
 */
export function useSocket(): Socket {
  const [creds, setCreds] = useState<AuthCreds | null>(null);

  useEffect(() => {
    return onAuthChange(async (user) => {
      if (!user) {
        setCreds(null);
        return;
      }
      try {
        const token = await user.getIdToken();
        setCreds((prev) => {
          // Only update if the uid changed; ignore token-only refreshes so we
          // don't trigger a getSocket re-evaluation for the same identity.
          if (prev && prev.uid === user.uid) return prev;
          return { uid: user.uid, token };
        });
      } catch (err) {
        console.error("[useSocket] getIdToken failed:", err);
        setCreds(null);
      }
    });
  }, []);

  const socket = getSocket(creds?.uid ?? null, creds?.token ?? null);

  useEffect(() => {
    if (!creds) return;
    if (!socket.connected) socket.connect();
  }, [socket, creds]);

  return socket;
}
