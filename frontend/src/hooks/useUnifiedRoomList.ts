"use client";

import { useEffect, useMemo, useState } from "react";
import { useSocket } from "./useSocket";
import type { RoomListEntry } from "./useRoomList";
import { GAMES, type Game } from "@/lib/socket";

/** A room entry tagged with which game (and therefore which backend) it lives on. */
export interface UnifiedRoomEntry extends RoomListEntry {
  game: Game;
}

/**
 * Opens a lobby socket to BOTH game backends at once and merges their room
 * lists into a single, game-tagged stream. This is the heart of the unified
 * lobby: real-time push from each backend (no polling), so a room created in
 * either game shows up here within the same tick the backend broadcasts it.
 *
 * Each game keeps its own socket singleton (see lib/socket.ts), so holding both
 * connections open while in the lobby is cheap and does not interfere with
 * gameplay on either side.
 */
export function useUnifiedRoomList(enabled: boolean): UnifiedRoomEntry[] {
  const ddzSocket = useSocket("ddz");
  const wuziqiSocket = useSocket("wuziqi");

  // One bucket of rooms per game; merged on read.
  const [byGame, setByGame] = useState<Record<Game, RoomListEntry[]>>({
    ddz: [],
    wuziqi: [],
  });

  const sockets = useMemo(
    () => ({ ddz: ddzSocket, wuziqi: wuziqiSocket }),
    [ddzSocket, wuziqiSocket],
  );

  useEffect(() => {
    if (!enabled) return;

    const cleanups: Array<() => void> = [];

    for (const game of GAMES) {
      const socket = sockets[game];

      const onUpdate = (data: { rooms: RoomListEntry[] }) => {
        setByGame((prev) => ({ ...prev, [game]: data.rooms ?? [] }));
      };
      const onConnect = () => socket.emit("list_rooms");

      socket.on("rooms_updated", onUpdate);
      socket.on("connect", onConnect);

      // The wuziqi socket may not be connected yet (the user only ever
      // explicitly connects the active game's socket via useSocket). Connect it
      // now so the lobby can list its rooms.
      if (socket.connected) socket.emit("list_rooms");
      else socket.connect();

      cleanups.push(() => {
        socket.off("rooms_updated", onUpdate);
        socket.off("connect", onConnect);
      });
    }

    return () => cleanups.forEach((fn) => fn());
  }, [enabled, sockets]);

  return useMemo(() => {
    const merged: UnifiedRoomEntry[] = [
      ...byGame.ddz.map((r) => ({ ...r, game: "ddz" as Game })),
      ...byGame.wuziqi.map((r) => ({ ...r, game: "wuziqi" as Game })),
    ];
    // Rooms you're already in float to the top, then waiting rooms, then the rest.
    const rank = (r: UnifiedRoomEntry) =>
      r.myMembership !== "none" ? 0 : r.phase === "waiting" ? 1 : 2;
    return merged.sort((a, b) => rank(a) - rank(b) || a.code.localeCompare(b.code));
  }, [byGame]);
}
