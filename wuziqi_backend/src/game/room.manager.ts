import { Injectable } from '@nestjs/common';
import { Member, Room } from './types';

const BOARD_SIZE = 15;

/** Build a fresh empty boardSize×boardSize grid (all 0). */
function freshBoard(size: number): (0 | 1 | 2)[][] {
  return Array.from({ length: size }, () =>
    Array.from({ length: size }, () => 0 as 0 | 1 | 2),
  );
}

/**
 * RoomManager — pure in-memory data store.
 * Owns the Map<string, Room> and all CRUD operations.
 * Does NOT emit events or own timers; that responsibility belongs to GameService.
 *
 * Identity model:
 *   - Members are identified by `uid` (Firebase UID). socketId rotates per connection.
 *   - One uid may exist in at most ONE room at a time (enforced by callers via findByUid).
 *   - On disconnect mid-game, the member is kept during the reconnect grace window
 *     (GameService); otherwise spliced immediately.
 *   - Empty rooms are deleted immediately by the caller (GameService).
 *
 * Player cap: 五子棋 has 2 players + unlimited spectators. The cap is enforced by
 * GameService at vote/start time (the manager stores all members uniformly).
 */
@Injectable()
export class RoomManager {
  private readonly rooms = new Map<string, Room>();

  // ── Code generation ─────────────────────────────────────────────────────────

  /**
   * Generate a unique 6-character alphanumeric room code.
   * Excludes ambiguous characters (0, 1, I, O) to improve legibility.
   * Collision-checked against the current room map.
   */
  private generateCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code: string;
    do {
      code = Array.from({ length: 6 }, () =>
        chars[Math.floor(Math.random() * chars.length)],
      ).join('');
    } while (this.rooms.has(code));
    return code;
  }

  // ── Create ───────────────────────────────────────────────────────────────────

  /**
   * Create a new room. The creator is added as the first member (spectator).
   * Caller is responsible for rejecting if uid is already in another room.
   */
  createRoom(
    uid: string,
    nickname: string,
    avatarUrl: string | null,
    socketId: string,
  ): Room {
    const code = this.generateCode();

    const member: Member = {
      uid,
      socketId,
      nickname,
      avatarUrl,
      role: 'spectator',
      color: null,
      wantToPlay: false,
      disconnected: false,
    };

    const room: Room = {
      code,
      members: [member],
      state: 'waiting',
      eventSeq: 0,
      boardSize: BOARD_SIZE,
      board: freshBoard(BOARD_SIZE),
      moves: [],
      currentColor: 'black',
      blackUid: null,
      whiteUid: null,
      turnEndTime: 0,
      turnTimer: null,
      winnerColor: null,
      winReason: null,
      drawVotes: new Set<string>(),
      winCounts: {},
      resultPending: false,
      reconnect: null,
    };

    this.rooms.set(code, room);
    return room;
  }

  // ── Join ─────────────────────────────────────────────────────────────────────

  /**
   * Add a member to an existing room as a spectator.
   * Returns null if the room doesn't exist.
   * Caller must ensure the uid is not already in any room before calling.
   */
  joinRoom(
    code: string,
    uid: string,
    nickname: string,
    avatarUrl: string | null,
    socketId: string,
  ): { room: Room; member: Member } | null {
    const room = this.rooms.get(code);
    if (!room) return null;

    const member: Member = {
      uid,
      socketId,
      nickname,
      avatarUrl,
      role: 'spectator',
      color: null,
      wantToPlay: false,
      disconnected: false,
    };

    room.members.push(member);
    return { room, member };
  }

  // ── Remove ───────────────────────────────────────────────────────────────────

  /**
   * Remove a socket from whichever room it currently belongs to.
   * Returns { room, member, wasPlayer } on success, or null if the socket
   * wasn't found in any room.
   *
   * Splices immediately — no reconnect grace window (that lives in GameService).
   */
  removeSocket(socketId: string): {
    room: Room;
    member: Member;
    wasPlayer: boolean;
  } | null {
    for (const room of this.rooms.values()) {
      const idx = room.members.findIndex((m) => m.socketId === socketId);
      if (idx === -1) continue;

      const member = room.members[idx];
      const wasPlayer = member.role === 'player';
      room.members.splice(idx, 1);
      return { room, member, wasPlayer };
    }
    return null;
  }

  // ── Lookups ──────────────────────────────────────────────────────────────────

  getRoom(code: string): Room | undefined {
    return this.rooms.get(code);
  }

  getRoomBySocketId(socketId: string): Room | undefined {
    for (const room of this.rooms.values()) {
      if (room.members.some((m) => m.socketId === socketId)) return room;
    }
    return undefined;
  }

  /** Find the room (if any) that the given uid is currently a member of. */
  getRoomByUid(uid: string): Room | undefined {
    for (const room of this.rooms.values()) {
      if (room.members.some((m) => m.uid === uid)) return room;
    }
    return undefined;
  }

  getMemberByUid(roomCode: string, uid: string): Member | undefined {
    return this.rooms.get(roomCode)?.members.find((m) => m.uid === uid);
  }

  // ── Delete ───────────────────────────────────────────────────────────────────

  /**
   * Permanently remove a room. Clears all pending timers before deletion.
   */
  deleteRoom(code: string): void {
    const room = this.rooms.get(code);
    if (!room) return;
    if (room.turnTimer) clearTimeout(room.turnTimer);
    if (room.reconnect) clearTimeout(room.reconnect.timer);
    this.rooms.delete(code);
  }

  // ── Iteration (for lobby room list) ─────────────────────────────────────────

  allRooms(): Room[] {
    return Array.from(this.rooms.values());
  }

  // ── Stats ────────────────────────────────────────────────────────────────────

  get roomCount(): number {
    return this.rooms.size;
  }
}
