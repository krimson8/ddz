"use client";

import { useEffect, useRef } from "react";
import { Socket } from "socket.io-client";
import { getSocket } from "@/lib/socket";

export function useSocket(): Socket {
  const socketRef = useRef<Socket>(getSocket());

  useEffect(() => {
    const s = socketRef.current;
    console.log("[useSocket] connected?", s.connected, "id:", s.id);
    if (!s.connected) {
      console.log("[useSocket] calling connect()");
      s.connect();
    }
    return () => {
      // Don't disconnect on unmount — connection is shared across the app.
      // Cleanup is handled explicitly via destroySocket() on page unload.
    };
  }, []);

  return socketRef.current;
}
