import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Member, Room } from './types';

/**
 * RoomManager — pure in-memory data store.
 * Owns the Map<string, Room> and all CRUD operations.
 * Does NOT emit events or own timers; that responsibility belongs to GameService.
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
   * Returns the newly created Room, including the reconnectToken assigned to the creator.
   */
  createRoom(
    nickname: string,
    socketId: string,
  ): { room: Room; reconnectToken: string } {
    const code = this.generateCode();
    const reconnectToken = randomUUID();

    const member: Member = {
      id: socketId,
      nickname,
      reconnectToken,
      role: 'spectator',
      hand: [],
      wantToPlay: false,
    };

    const room: Room = {
      code,
      members: [member],
      state: 'waiting',
      eventSeq: 0,
      playerIds: [],
      deck: [],
      landlordCards: [],
      landlordIndex: -1,
      currentTurn: 0,
      currentBid: 0,
      currentBidder: -1,
      passCount: 0,
      lastPlay: null,
      lastPlayedBy: -1,
      playHistory: [],
      turnEndTime: 0,
      bidPassCount: 0,
      bidYesVoters: [],
      firstBidder: 0,
      bidTimer: null,
      bidVotedIndices: [],
      turnTimer: null,
      idleTimeout: null,
      reconnectTimers: new Map(),
      winCounts: {},
    };

    this.rooms.set(code, room);
    return { room, reconnectToken };
  }

  // ── Join ─────────────────────────────────────────────────────────────────────

  /**
   * Add a member to an existing room.
   * Deduplicates the nickname within the room (appends a numeric suffix if taken).
   * Returns the Room + the new Member (with assigned reconnectToken), or null if
   * the room code doesn't exist.
   */
  joinRoom(
    code: string,
    nickname: string,
    socketId: string,
  ): { room: Room; member: Member; reconnectToken: string } | null {
    const room = this.rooms.get(code);
    if (!room) return null;

    // Deduplicate nickname within this room
    const takenNicknames = new Set(room.members.map((m) => m.nickname));
    let finalNickname = nickname;
    if (takenNicknames.has(nickname)) {
      let suffix = 2;
      while (takenNicknames.has(`${nickname}${suffix}`)) suffix++;
      finalNickname = `${nickname}${suffix}`;
    }

    const reconnectToken = randomUUID();
    const member: Member = {
      id: socketId,
      nickname: finalNickname,
      reconnectToken,
      role: 'spectator',
      hand: [],
      wantToPlay: false,
    };

    room.members.push(member);
    return { room, member, reconnectToken };
  }

  // ── Remove ───────────────────────────────────────────────────────────────────

  /**
   * Remove a socket from whichever room it currently belongs to.
   * Returns { room, member, wasPlayer } on success, or null if the socket
   * wasn't found in any room.
   *
   * Note: callers (GameService) decide whether to immediately splice or keep
   * the member for a reconnect window; this method always splices for simplicity.
   * GameService re-inserts the member when granting a reconnect window.
   */
  removeSocket(socketId: string): {
    room: Room;
    member: Member;
    wasPlayer: boolean;
  } | null {
    for (const room of this.rooms.values()) {
      const idx = room.members.findIndex((m) => m.id === socketId);
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
      if (room.members.some((m) => m.id === socketId)) return room;
    }
    return undefined;
  }

  /**
   * Find a room + member by reconnect token + room code.
   * The member's socket ID will be stale at this point — the caller is
   * responsible for updating it after successful reconnection.
   */
  findByReconnectToken(
    token: string,
    code: string,
  ): { room: Room; member: Member } | null {
    const room = this.rooms.get(code);
    if (!room) return null;
    const member = room.members.find((m) => m.reconnectToken === token);
    return member ? { room, member } : null;
  }

  // ── Delete ───────────────────────────────────────────────────────────────────

  /**
   * Permanently remove a room. Clears all pending timers before deletion.
   */
  deleteRoom(code: string): void {
    const room = this.rooms.get(code);
    if (!room) return;
    if (room.idleTimeout) clearTimeout(room.idleTimeout);
    room.reconnectTimers.forEach((t) => clearTimeout(t));
    this.rooms.delete(code);
  }

  // ── Stats ────────────────────────────────────────────────────────────────────

  get roomCount(): number {
    return this.rooms.size;
  }
}
