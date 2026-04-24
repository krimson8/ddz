import { io, Socket } from "socket.io-client";

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    const url = process.env.NEXT_PUBLIC_WS_URL ?? "http://localhost:4896";
    console.log("[socket] creating new socket, url:", url);
    socket = io(url, {
      autoConnect: false,
      transports: ["websocket"],
    });
    socket.on("connect", () => console.log("[socket] connected, id:", socket?.id));
    socket.on("disconnect", (reason) => console.log("[socket] disconnected:", reason));
    socket.on("connect_error", (err) => console.error("[socket] connect_error:", err.message));
  }
  return socket;
}

export function destroySocket(): void {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
