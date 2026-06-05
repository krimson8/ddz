import { Injectable } from '@nestjs/common';
import { Server } from 'socket.io';
import { RoomManager } from './room.manager';
import { Room, StoneColor, WinReason, WinnerColor } from './types';
import {
  applyMove,
  checkWin,
  emptyBoard,
  isFull,
  randomEmptyCell,
} from './board.utils';
import type { AuthedUser } from '../auth/auth.service';
import { LeaderboardService } from '../leaderboard/leaderboard.service';

const TURN_TIMEOUT_MS = 30_000;
const RECONNECT_GRACE_MS = 30_000;
const START_COUNTDOWN_MS = 3_000;
const RESULT_DELAY_MS = 5_000;

/** Socket.io room name used to broadcast lobby updates to all not-yet-in-a-room sockets. */
export const LOBBY_ROOM = '__lobby';

export interface JoinResult {
  roomCode: string;
  nickname: string;
}

/**
 * Central state machine for the 五子棋 game.
 *
 * Backend-authoritative: every mutation (place stone, timeout auto-move, win
 * detection, turn advance) happens here, then the new state is broadcast. The
 * frontend renders events and sends intents only (SPEC_WUZIQI §1/§6).
 *
 * Identity model:
 *  - Members are identified by uid (Firebase UID). Sockets rotate; uid is stable.
 *  - A uid may belong to at most one room at a time.
 *  - Mid-game disconnects open a 30s reconnect grace window; otherwise splice.
 *  - Empty rooms are killed immediately on last disconnect.
 */
@Injectable()
export class GameService {
  private server!: Server;

  constructor(
    private readonly roomManager: RoomManager,
    private readonly leaderboardService: LeaderboardService,
  ) {}

  setServer(server: Server): void {
    this.server = server;
  }

  // ── Broadcast helpers ───────────────────────────────────────────────────────

  private emitToRoom(room: Room, event: string, payload: object): void {
    room.eventSeq += 1;
    this.server?.to(room.code).emit(event, { ...payload, seq: room.eventSeq });
  }

  private emitToSocket(socketId: string, event: string, payload: object): void {
    if (!socketId) return;
    this.server?.to(socketId).emit(event, payload);
  }

  private serializeMembers(room: Room) {
    return room.members.map((m) => ({
      id: m.uid, // backward-compat with frontend code that keys on `id`
      uid: m.uid,
      nickname: m.nickname,
      avatarUrl: m.avatarUrl,
      role: m.role,
      color: m.color,
      wantToPlay: m.wantToPlay,
      disconnected: m.disconnected,
    }));
  }

  private emitMembersUpdate(room: Room): void {
    const members = this.serializeMembers(room);
    const readyCount = members.filter((m) => m.wantToPlay).length;
    const canVote = room.state === 'waiting';
    this.emitToRoom(room, 'members_update', { members, readyCount, canVote });
  }

  /** The uids of the (up to 2) players this round, in [black, white] order. */
  private playerUids(room: Room): string[] {
    return [room.blackUid, room.whiteUid].filter((u): u is string => !!u);
  }

  /** uid whose turn it currently is (or null when not playing). */
  private currentTurnUid(room: Room): string | null {
    return room.currentColor === 'black' ? room.blackUid : room.whiteUid;
  }

  /** The board snapshot payload (full state). */
  private buildGameStatePayload(room: Room): object {
    return {
      board: room.board,
      moves: room.moves,
      currentColor: room.currentColor,
      currentPlayerEndTime: room.turnEndTime,
      blackUid: room.blackUid,
      whiteUid: room.whiteUid,
      winCounts: room.winCounts,
      phase: 'gameplay',
    };
  }

  // ── Room creation / joining ─────────────────────────────────────────────────

  handleCreateRoom(
    user: AuthedUser,
    socketId: string,
  ): JoinResult | { error: string } {
    if (this.roomManager.getRoomByUid(user.uid)) {
      return { error: '你已在一個房間中，無法建立新房間' };
    }
    if (this.roomManager.roomCount >= 500) {
      return { error: '伺服器已達到最大房間數，請稍後再試' };
    }

    const room = this.roomManager.createRoom(
      user.uid,
      user.nickname,
      user.avatarUrl,
      socketId,
    );

    this.broadcastRoomList();
    return { roomCode: room.code, nickname: user.nickname };
  }

  handleJoinRoom(
    user: AuthedUser,
    code: string,
    socketId: string,
  ): JoinResult | { error: string } {
    const upperCode = code.toUpperCase().trim();
    if (!/^[A-Z2-9]{6}$/.test(upperCode)) {
      return { error: '無效的房間代碼' };
    }

    const room = this.roomManager.getRoom(upperCode);
    if (!room) {
      return { error: '找不到房間' };
    }

    const existingRoom = this.roomManager.getRoomByUid(user.uid);
    if (existingRoom && existingRoom.code !== upperCode) {
      return { error: '你已在另一個房間中' };
    }
    if (existingRoom && existingRoom.code === upperCode) {
      return { roomCode: upperCode, nickname: user.nickname };
    }

    // Spectators are unlimited; the 2-player cap is enforced at vote/start time.
    const result = this.roomManager.joinRoom(
      upperCode,
      user.uid,
      user.nickname,
      user.avatarUrl,
      socketId,
    );
    if (!result) {
      return { error: '加入房間失敗' };
    }

    this.emitMembersUpdate(room);
    this.broadcastRoomList();

    return { roomCode: upperCode, nickname: user.nickname };
  }

  buildRoomJoinedPayload(uid: string, roomCode: string) {
    const room = this.roomManager.getRoom(roomCode);
    if (!room) return null;

    const members = this.serializeMembers(room);
    const readyCount = members.filter((m) => m.wantToPlay).length;
    const canVote = room.state === 'waiting';

    return {
      roomCode,
      members,
      state: room.state,
      playerUids: this.playerUids(room),
      myUid: uid,
      seq: room.eventSeq,
      winCounts: room.winCounts,
      readyCount,
      canVote,
    };
  }

  // ── Voting ──────────────────────────────────────────────────────────────────

  /**
   * Toggle a member's intent to play. When 2 members have voted, start the game.
   */
  handleVotePlay(socketId: string): void {
    const room = this.roomManager.getRoomBySocketId(socketId);
    if (!room) return;

    if (room.state !== 'waiting' || room.resultPending) {
      this.emitToSocket(socketId, 'room_error', {
        message: '遊戲進行中，無法投票',
      });
      return;
    }

    const member = room.members.find((m) => m.socketId === socketId);
    if (!member) return;

    member.wantToPlay = !member.wantToPlay;

    const voters = room.members.filter((m) => m.wantToPlay);
    if (voters.length >= 2) {
      // Flip the lock inside startGame BEFORE any async hop so a concurrently
      // queued vote can never re-enter.
      this.startGame(room);
      return;
    }

    this.emitMembersUpdate(room);
  }

  // ── Game start ────────────────────────────────────────────────────────────

  /**
   * Lock in the 2 voters, assign black/white randomly, emit vote_closed_start,
   * then after a short countdown deal the empty board and start play.
   */
  private startGame(room: Room): void {
    if (room.state !== 'waiting') return;
    room.state = 'starting';

    const voters = room.members.filter((m) => m.wantToPlay).slice(0, 2);
    const playerUidSet = new Set(voters.map((m) => m.uid));
    for (const m of room.members) {
      m.role = playerUidSet.has(m.uid) ? 'player' : 'spectator';
      m.color = null;
    }

    const players = voters.map((m) => ({ id: m.uid, nickname: m.nickname }));
    const spectators = room.members
      .filter((m) => m.role === 'spectator')
      .map((m) => ({ id: m.uid, nickname: m.nickname }));

    this.emitToRoom(room, 'vote_closed_start', {
      players,
      spectators,
      phase: 'starting',
    });
    this.emitMembersUpdate(room);
    this.broadcastRoomList();

    setTimeout(() => this.beginPlay(room), START_COUNTDOWN_MS);
  }

  /** After the countdown: reset board, assign colours, broadcast, start timer. */
  private beginPlay(room: Room): void {
    if (room.state !== 'starting') return;

    const players = room.members.filter((m) => m.role === 'player');
    if (players.length !== 2) {
      // Someone left during the countdown — abort cleanly.
      this.resetToWaiting(room);
      return;
    }

    // Random colour assignment (SPEC_WUZIQI §6.1).
    const blackFirst = Math.random() < 0.5;
    const black = blackFirst ? players[0] : players[1];
    const white = blackFirst ? players[1] : players[0];
    black.color = 'black';
    white.color = 'white';

    room.state = 'playing';
    room.board = emptyBoard(room.boardSize);
    room.moves = [];
    room.currentColor = 'black';
    room.blackUid = black.uid;
    room.whiteUid = white.uid;
    room.winnerColor = null;
    room.winReason = null;
    room.drawVotes.clear();

    // Unicast game_start per member so each learns its own colour.
    for (const m of room.members) {
      this.emitToSocket(m.socketId, 'game_start', {
        boardSize: room.boardSize,
        blackUid: room.blackUid,
        whiteUid: room.whiteUid,
        yourColor: m.color, // null for spectators
        currentColor: room.currentColor,
        phase: 'gameplay',
      });
    }

    this.startTurnTimer(room);
    this.emitMembersUpdate(room);
    this.broadcastRoomList();
  }

  // ── Place stone ─────────────────────────────────────────────────────────────

  /**
   * Validate + apply a stone for the player owning `socketId`, then win-check,
   * advance the turn (or end the game), and broadcast. (SPEC_WUZIQI §6.4)
   */
  placeStone(socketId: string, x: number, y: number): void {
    const room = this.roomManager.getRoomBySocketId(socketId);
    if (!room || room.state !== 'playing') {
      this.emitToSocket(socketId, 'invalid_move', { reason: '現在不是對局階段' });
      return;
    }
    const member = room.members.find((m) => m.socketId === socketId);
    if (!member || member.role !== 'player' || !member.color) {
      this.emitToSocket(socketId, 'invalid_move', { reason: '你不是對局玩家' });
      return;
    }
    if (member.color !== room.currentColor) {
      this.emitToSocket(socketId, 'invalid_move', { reason: '還不是你的回合' });
      return;
    }

    this.applyStone(room, member.color, x, y, false);
  }

  /**
   * Low-level: validate coords, apply, win-check, advance/end. Shared by
   * `placeStone` (human) and the timeout auto-move (server). `byTimeout` is
   * threaded through to the move_made broadcast so the UI can annotate it.
   */
  private applyStone(
    room: Room,
    color: StoneColor,
    x: number,
    y: number,
    byTimeout: boolean,
  ): void {
    if (
      !Number.isInteger(x) ||
      !Number.isInteger(y) ||
      x < 0 ||
      y < 0 ||
      x >= room.boardSize ||
      y >= room.boardSize
    ) {
      // Only humans reach here with bad coords; the timeout path always supplies
      // an in-bounds empty cell. Reject without mutating state.
      const sid = this.uidSocket(room, color);
      this.emitToSocket(sid, 'invalid_move', { reason: '無效的座標' });
      return;
    }
    if (!applyMove(room.board, x, y, color)) {
      const sid = this.uidSocket(room, color);
      this.emitToSocket(sid, 'invalid_move', { reason: '該位置已有棋子' });
      return;
    }

    room.moves.push({ color, x, y });
    this.clearTurnTimer(room);

    // A new stone retracts any pending draw offer.
    if (room.drawVotes.size > 0) {
      room.drawVotes.clear();
      this.broadcastDrawVotes(room);
    }

    // Win check centred on the placed stone.
    const winningLine = checkWin(room.board, x, y);
    if (winningLine) {
      this.broadcastMove(room, x, y, color, byTimeout);
      this.handleWin(room, color, 'five', winningLine);
      return;
    }

    if (isFull(room.board)) {
      this.broadcastMove(room, x, y, color, byTimeout);
      this.handleWin(room, 'draw', 'draw', null);
      return;
    }

    // Advance turn, restart timer, broadcast the move.
    room.currentColor = color === 'black' ? 'white' : 'black';
    this.startTurnTimer(room);
    this.broadcastMove(room, x, y, color, byTimeout);
  }

  private broadcastMove(
    room: Room,
    x: number,
    y: number,
    color: StoneColor,
    byTimeout: boolean,
  ): void {
    this.emitToRoom(room, 'move_made', {
      x,
      y,
      color,
      nextColor: room.currentColor,
      currentPlayerEndTime: room.turnEndTime,
      moveCount: room.moves.length,
      byTimeout,
      phase: 'gameplay',
    });
  }

  /** Socket id of the player currently playing `color`, or '' if disconnected. */
  private uidSocket(room: Room, color: StoneColor): string {
    const uid = color === 'black' ? room.blackUid : room.whiteUid;
    return room.members.find((m) => m.uid === uid)?.socketId ?? '';
  }

  // ── Resign ──────────────────────────────────────────────────────────────────

  handleResign(socketId: string): void {
    const room = this.roomManager.getRoomBySocketId(socketId);
    if (!room || room.state !== 'playing') return;
    const member = room.members.find((m) => m.socketId === socketId);
    if (!member || member.role !== 'player' || !member.color) return;

    const winner: StoneColor = member.color === 'black' ? 'white' : 'black';
    this.handleWin(room, winner, 'resign', null);
  }

  // ── Draw vote (和局) ──────────────────────────────────────────────────────────
  // Both current players must toggle the draw vote on for the game to end in a
  // draw. Mirrors the DDZ two-peasant surrender vote: a per-player toggle that
  // only fires the outcome once the backend has collected it from both sides.

  handleDrawVote(socketId: string): void {
    const room = this.roomManager.getRoomBySocketId(socketId);
    if (!room || room.state !== 'playing') return;
    const member = room.members.find((m) => m.socketId === socketId);
    if (!member || member.role !== 'player' || !member.color) return;

    // Toggle this player's draw vote.
    if (room.drawVotes.has(member.uid)) {
      room.drawVotes.delete(member.uid);
    } else {
      room.drawVotes.add(member.uid);
    }

    // Agreed only when BOTH current players have voted.
    if (
      room.blackUid &&
      room.whiteUid &&
      room.drawVotes.has(room.blackUid) &&
      room.drawVotes.has(room.whiteUid)
    ) {
      this.handleWin(room, 'draw', 'draw', null);
      return;
    }

    this.broadcastDrawVotes(room);
  }

  /** Tell both clients which players currently want a draw. */
  private broadcastDrawVotes(room: Room): void {
    this.emitToRoom(room, 'draw_vote_update', {
      drawVoters: [...room.drawVotes],
    });
  }

  // ── Turn timer (30s, auto-place random on timeout) ──────────────────────────

  private startTurnTimer(room: Room): void {
    if (room.turnTimer) clearTimeout(room.turnTimer);
    const color = room.currentColor;
    room.turnEndTime = Date.now() + TURN_TIMEOUT_MS;
    room.turnTimer = setTimeout(() => {
      room.turnTimer = null;
      // Guard: only fire if still that colour's turn in a live game.
      if (room.state !== 'playing' || room.currentColor !== color) return;
      const cell = randomEmptyCell(room.board);
      if (!cell) {
        // Board full with no empty cell (shouldn't happen — isFull handled it).
        return;
      }
      this.applyStone(room, color, cell.x, cell.y, true);
    }, TURN_TIMEOUT_MS);
  }

  private clearTurnTimer(room: Room): void {
    if (room.turnTimer) {
      clearTimeout(room.turnTimer);
      room.turnTimer = null;
    }
    room.turnEndTime = 0;
  }

  // ── Win / draw ──────────────────────────────────────────────────────────────

  private handleWin(
    room: Room,
    winnerColor: WinnerColor,
    winReason: WinReason,
    winningLine: { x: number; y: number }[] | null,
  ): void {
    this.clearTurnTimer(room);
    room.drawVotes.clear();
    room.winnerColor = winnerColor;
    room.winReason = winReason;

    const blackMember = room.members.find((m) => m.uid === room.blackUid);
    const whiteMember = room.members.find((m) => m.uid === room.whiteUid);

    let winnerUid: string | null = null;
    if (winnerColor === 'black') winnerUid = room.blackUid;
    else if (winnerColor === 'white') winnerUid = room.whiteUid;

    if (winnerUid) {
      room.winCounts[winnerUid] = (room.winCounts[winnerUid] ?? 0) + 1;
    }

    // Persist (fire-and-forget; service logs its own errors).
    if (blackMember && whiteMember && room.blackUid && room.whiteUid) {
      void this.leaderboardService.recordResult(
        winnerColor,
        winReason,
        [
          {
            uid: room.blackUid,
            color: 'black',
            won: winnerColor === 'black',
          },
          {
            uid: room.whiteUid,
            color: 'white',
            won: winnerColor === 'white',
          },
        ],
        [...room.moves],
        room.boardSize,
      );
    }

    room.resultPending = true;

    this.emitToRoom(room, 'game_over', {
      winnerColor,
      winReason,
      winnerUid,
      winningLine,
      winCounts: room.winCounts,
      phase: 'result',
    });

    // Tear down round state but keep the board visible until return_to_lobby.
    for (const m of room.members) {
      m.role = 'spectator';
      m.color = null;
      m.wantToPlay = false;
      m.disconnected = false;
    }
    if (room.reconnect) {
      clearTimeout(room.reconnect.timer);
      room.reconnect = null;
    }
    room.state = 'waiting';

    setTimeout(() => {
      room.resultPending = false;
      // Clear the board for the next round.
      room.board = emptyBoard(room.boardSize);
      room.moves = [];
      room.currentColor = 'black';
      room.blackUid = null;
      room.whiteUid = null;
      room.winnerColor = null;
      room.winReason = null;
      room.drawVotes.clear();
      this.emitToRoom(room, 'return_to_lobby', { phase: 'lobby' });
      this.emitMembersUpdate(room);
      this.broadcastRoomList();
    }, RESULT_DELAY_MS);
  }

  // ── Disconnect / leave ──────────────────────────────────────────────────────

  handleLeaveRoom(socketId: string): void {
    this.removeSocketFromRoom(socketId);
  }

  handleDisconnect(socketId: string): void {
    const room = this.roomManager.getRoomBySocketId(socketId);
    if (!room) return;
    const member = room.members.find((m) => m.socketId === socketId);
    if (!member) return;

    const isPlayerMidGame =
      room.state === 'playing' && this.playerUids(room).includes(member.uid);

    if (isPlayerMidGame) {
      this.beginReconnectGrace(room, member.uid);
      return;
    }

    this.removeSocketFromRoom(socketId);
  }

  reattachSocketToRoom(uid: string, newSocketId: string): string | null {
    const room = this.roomManager.getRoomByUid(uid);
    if (!room) return null;
    const member = room.members.find((m) => m.uid === uid);
    if (!member) return null;

    member.socketId = newSocketId;

    if (room.reconnect && room.reconnect.uid === uid) {
      clearTimeout(room.reconnect.timer);
      room.reconnect = null;
      member.disconnected = false;

      // Resume the turn timer if it's this player's turn (or anyone's — we
      // paused it on disconnect regardless).
      if (room.state === 'playing') {
        this.startTurnTimer(room);
      }

      this.emitToRoom(room, 'player_reconnected', {
        uid,
        nickname: member.nickname,
        playerUids: this.playerUids(room),
      });
      this.emitMembersUpdate(room);
      this.emitFullStateToSocket(newSocketId, room.code);
      this.broadcastRoomList();
      return room.code;
    }

    this.emitFullStateToSocket(newSocketId, room.code);
    return room.code;
  }

  private beginReconnectGrace(room: Room, uid: string): void {
    const member = room.members.find((m) => m.uid === uid);
    if (!member) return;

    if (room.reconnect && room.reconnect.uid !== uid) {
      clearTimeout(room.reconnect.timer);
      room.reconnect = null;
    }
    if (room.reconnect && room.reconnect.uid === uid) {
      clearTimeout(room.reconnect.timer);
    }

    member.disconnected = true;
    member.socketId = '';

    // Pause the turn timer during grace so we don't auto-move on an absent player.
    this.clearTurnTimer(room);

    const endTime = Date.now() + RECONNECT_GRACE_MS;
    const timer = setTimeout(() => {
      if (room.reconnect?.uid !== uid) return;
      room.reconnect = null;
      const idx = room.members.findIndex((m) => m.uid === uid);
      if (idx !== -1) room.members.splice(idx, 1);
      if (room.members.length === 0) {
        this.roomManager.deleteRoom(room.code);
        this.broadcastRoomList();
        return;
      }
      // Grace expired mid-game → the absent player loses by disconnect.
      if (room.state === 'playing' && member.color) {
        const winner: StoneColor = member.color === 'black' ? 'white' : 'black';
        this.handleWin(room, winner, 'disconnect', null);
      } else {
        this.resetToWaiting(room);
      }
      this.broadcastRoomList();
    }, RECONNECT_GRACE_MS);

    room.reconnect = { uid, endTime, timer };

    this.emitToRoom(room, 'player_disconnected', {
      uid,
      nickname: member.nickname,
      endTime,
      timeoutMs: RECONNECT_GRACE_MS,
    });
    this.emitMembersUpdate(room);
    this.broadcastRoomList();
  }

  private removeSocketFromRoom(socketId: string): void {
    const room = this.roomManager.getRoomBySocketId(socketId);
    if (!room) return;

    const removed = this.roomManager.removeSocket(socketId);
    if (!removed) return;

    const { member, wasPlayer } = removed;

    if (room.reconnect?.uid === member.uid) {
      clearTimeout(room.reconnect.timer);
      room.reconnect = null;
    }

    if (room.members.length === 0) {
      this.roomManager.deleteRoom(room.code);
      this.broadcastRoomList();
      return;
    }

    // Explicit leave mid-game forfeits immediately (the leaver loses).
    if (wasPlayer && room.state === 'playing' && member.color) {
      const winner: StoneColor = member.color === 'black' ? 'white' : 'black';
      this.handleWin(room, winner, 'resign', null);
    } else if (wasPlayer && room.state === 'starting') {
      this.resetToWaiting(room);
    } else {
      this.emitMembersUpdate(room);
    }
    this.broadcastRoomList();
  }

  /** Abort a live/starting game with no result (e.g. start aborted). */
  private resetToWaiting(room: Room): void {
    if (room.reconnect) {
      clearTimeout(room.reconnect.timer);
      room.reconnect = null;
    }
    this.clearTurnTimer(room);

    for (const m of room.members) {
      m.role = 'spectator';
      m.color = null;
      m.wantToPlay = false;
      m.disconnected = false;
    }

    room.state = 'waiting';
    room.board = emptyBoard(room.boardSize);
    room.moves = [];
    room.currentColor = 'black';
    room.blackUid = null;
    room.whiteUid = null;
    room.winnerColor = null;
    room.winReason = null;

    this.emitToRoom(room, 'game_aborted', { phase: 'lobby' });
    this.emitMembersUpdate(room);
    this.broadcastRoomList();
  }

  // ── Emoji reactions ──────────────────────────────────────────────────────────

  handleReactEmoji(socketId: string, emoji: string): void {
    const room = this.roomManager.getRoomBySocketId(socketId);
    if (!room) return;
    const member = room.members.find((m) => m.socketId === socketId);
    if (!member) return;

    this.emitToRoom(room, 'emoji_reaction', {
      senderUid: member.uid,
      senderNickname: member.nickname,
      role: member.role,
      emoji,
    });
  }

  // ── Sync request / full-state snapshot ──────────────────────────────────────

  /**
   * Re-emit the full room state to a single socket. Used on join, on reconnect
   * reattach, and after a client detects a seq gap.
   */
  emitFullStateToSocket(socketId: string, roomCode: string): void {
    const room = this.roomManager.getRoom(roomCode);
    if (!room) return;
    const member = room.members.find((m) => m.socketId === socketId);
    if (!member) return;

    const members = this.serializeMembers(room);
    const readyCount = members.filter((m) => m.wantToPlay).length;
    const canVote = room.state === 'waiting';
    const phase = room.state === 'playing' ? 'gameplay' : 'lobby';

    this.emitToSocket(socketId, 'room_joined', {
      roomCode,
      members,
      state: room.state,
      playerUids: this.playerUids(room),
      myUid: member.uid,
      seq: room.eventSeq,
      winCounts: room.winCounts,
      phase,
      readyCount,
      canVote,
    });

    if (room.state === 'playing') {
      // Tell the returning client its colour, then the full board snapshot.
      this.emitToSocket(socketId, 'game_start', {
        boardSize: room.boardSize,
        blackUid: room.blackUid,
        whiteUid: room.whiteUid,
        yourColor: member.color,
        currentColor: room.currentColor,
        phase: 'gameplay',
        reconnect: true,
      });
      this.emitToSocket(socketId, 'game_state', this.buildGameStatePayload(room));
    }
  }

  // ── External hooks ──────────────────────────────────────────────────────────

  refreshUserInRoom(
    uid: string,
    patch: { nickname?: string; avatarUrl?: string | null },
  ): void {
    if (this.server) {
      for (const socket of this.server.sockets.sockets.values()) {
        const u = (socket as unknown as { data: { user?: AuthedUser } }).data
          .user;
        if (u?.uid !== uid) continue;
        if (patch.nickname !== undefined) u.nickname = patch.nickname;
        if (patch.avatarUrl !== undefined) u.avatarUrl = patch.avatarUrl;
      }
    }

    const room = this.roomManager.getRoomByUid(uid);
    if (!room) return;
    const member = room.members.find((m) => m.uid === uid);
    if (!member) return;

    let changed = false;
    if (patch.nickname !== undefined && patch.nickname !== member.nickname) {
      member.nickname = patch.nickname;
      changed = true;
    }
    if (patch.avatarUrl !== undefined && patch.avatarUrl !== member.avatarUrl) {
      member.avatarUrl = patch.avatarUrl;
      changed = true;
    }
    if (!changed) return;

    this.emitMembersUpdate(room);
    this.broadcastRoomList();
  }

  // ── Lobby room list ─────────────────────────────────────────────────────────

  buildRoomList(uid: string | null) {
    return this.roomManager.allRooms().map((room) => {
      const phase: 'waiting' | 'playing' =
        room.state === 'playing' ? 'playing' : 'waiting';

      const playerUids = this.playerUids(room);
      const playerUidSet = new Set(playerUids);
      const currentTurnUid = this.currentTurnUid(room);

      const members = room.members.map((m) => ({
        uid: m.uid,
        nickname: m.nickname,
        avatarUrl: m.avatarUrl,
        role: m.role,
        isCurrentTurn: phase === 'playing' && m.uid === currentTurnUid,
        isPlayer: playerUidSet.has(m.uid),
      }));

      const myMembership: 'none' | 'player' | 'spectator' = !uid
        ? 'none'
        : playerUidSet.has(uid)
          ? 'player'
          : room.members.some((m) => m.uid === uid)
            ? 'spectator'
            : 'none';

      return {
        code: room.code,
        phase,
        members,
        memberCount: room.members.length,
        playerCount: members.filter((m) => m.isPlayer).length,
        spectatorCount: members.filter((m) => !m.isPlayer).length,
        myMembership,
      };
    });
  }

  broadcastRoomList(): void {
    if (!this.server) return;
    const sockets = this.server.sockets.adapter.rooms.get(LOBBY_ROOM);
    if (!sockets) return;
    for (const socketId of sockets) {
      const socket = this.server.sockets.sockets.get(socketId);
      if (!socket) continue;
      const uid =
        (socket as unknown as { data: { user?: { uid: string } } }).data.user
          ?.uid ?? null;
      socket.emit('rooms_updated', { rooms: this.buildRoomList(uid) });
    }
  }

  emitRoomListToSocket(socketId: string, uid: string | null): void {
    this.server?.to(socketId).emit('rooms_updated', {
      rooms: this.buildRoomList(uid),
    });
  }

  get roomCount(): number {
    return this.roomManager.roomCount;
  }
}
