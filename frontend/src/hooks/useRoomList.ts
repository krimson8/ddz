"use client";

import { useEffect, useState } from "react";
import { Socket } from "socket.io-client";

export interface RoomListMember {
  uid: string;
  nickname: string;
  avatarUrl: string | null;
  role: "player" | "spectator";
  isCurrentTurn: boolean;
  isPlayer: boolean;
}

export interface RoomListEntry {
  code: string;
  phase: "waiting" | "bidding" | "playing";
  members: RoomListMember[];
  memberCount: number;
  playerCount: number;
  spectatorCount: number;
  myMembership: "none" | "player" | "spectator";
}

export function useRoomList(socket: Socket, enabled: boolean): RoomListEntry[] {
  const [rooms, setRooms] = useState<RoomListEntry[]>([]);

  useEffect(() => {
    if (!enabled) return;

    function onUpdate(data: { rooms: RoomListEntry[] }) {
      setRooms(data.rooms ?? []);
    }

    socket.on("rooms_updated", onUpdate);

    // Request a fresh list once we're listening.
    if (socket.connected) socket.emit("list_rooms");
    const onConnect = () => socket.emit("list_rooms");
    socket.on("connect", onConnect);

    return () => {
      socket.off("rooms_updated", onUpdate);
      socket.off("connect", onConnect);
    };
  }, [socket, enabled]);

  return rooms;
}
