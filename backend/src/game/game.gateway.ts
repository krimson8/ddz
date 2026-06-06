import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { GameService, LOBBY_ROOM } from './game.service';
import { Card } from './types';
import { AuthService, AuthedUser } from '../auth/auth.service';
import type { AuthedSocket } from '../auth/ws-auth.guard';

const ALLOWED_REACTIONS = new Set([
  '🖕',
  '🤏',
  '🤌',
  '我操',
  'EZ',
  'GG',
  '玩不了啦',
  '小兒科',
  '你會玩的嗎',
  '小癟三',
  '不用看了',
  '窩妖驗牌',
  '牌沒有問題',
  '在我者離',
  '給我搽皮鞋',
]);
const VALID_SUITS = new Set<string>([
  'spade',
  'heart',
  'diamond',
  'club',
  'joker',
]);

@WebSocketGateway({
  cors: {
    origin: process.env.CORS_ORIGIN ?? 'http://localhost:3000',
    credentials: true,
  },
})
export class GameGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(GameGateway.name);

  @WebSocketServer()
  server!: Server;

  private readonly eventWindows = new Map<
    string,
    { count: number; windowStart: number }
  >();

  private readonly emojiTimestamps = new Map<string, number>();

  constructor(
    private readonly gameService: GameService,
    private readonly authService: AuthService,
  ) {}

  afterInit(server: Server): void {
    this.gameService.setServer(server);

    // Authenticate via connection-level middleware: this runs BEFORE the socket
    // joins the connection pool, so no message handlers can fire until the
    // token is verified and socket.data.user is attached. Without this guard,
    // fast client-side emits (e.g. list_rooms) can race past handleConnection
    // and hit handlers with no user attached.
    server.use(async (socket, next) => {
      const token = (socket.handshake.auth as { token?: string } | undefined)
        ?.token;
      if (!token) {
        next(new Error('未登入'));
        return;
      }
      try {
        const user = await this.authService.authenticate(token);
        (socket as AuthedSocket).data.user = user;
        next();
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Auth failed';
        this.logger.warn(`WS auth rejected (socket=${socket.id}): ${msg}`);
        next(new Error('驗證失敗'));
      }
    });
  }

  /**
   * Called only after the auth middleware has accepted the connection.
   * socket.data.user is guaranteed to be set here.
   */
  async handleConnection(socket: AuthedSocket): Promise<void> {
    const user = socket.data.user;
    if (!user) {
      // Defensive: should never happen because middleware rejects unauthed sockets.
      socket.disconnect();
      return;
    }
    this.logger.log(
      `WS connected: socket=${socket.id} uid=${user.uid} email=${user.email}`,
    );

    // Reattach to an existing room (e.g. reconnect during the 30s grace window
    // after a transient disconnect). The service rebinds the new socketId,
    // cancels any pending abort timer, and emits a snapshot back to us.
    const reattachedRoom = this.gameService.reattachSocketToRoom(
      user.uid,
      socket.id,
    );
    if (reattachedRoom) {
      await socket.join(reattachedRoom);
      return;
    }

    await socket.join(LOBBY_ROOM);
    this.gameService.emitRoomListToSocket(socket.id, user.uid);
  }

  handleDisconnect(socket: Socket): void {
    this.gameService.handleDisconnect(socket.id);
    this.eventWindows.delete(socket.id);
    this.emojiTimestamps.delete(socket.id);
  }

  // ── Rate-limit helpers ───────────────────────────────────────────────────────

  private isRateLimited(socketId: string): boolean {
    const now = Date.now();
    const entry = this.eventWindows.get(socketId);
    if (!entry) {
      this.eventWindows.set(socketId, { count: 1, windowStart: now });
      return false;
    }
    if (now - entry.windowStart > 1_000) {
      entry.count = 1;
      entry.windowStart = now;
      return false;
    }
    entry.count++;
    return entry.count > 10;
  }

  private rejectRateLimit(socket: Socket): void {
    socket.emit('room_error', { message: '訊息頻率過高，請稍後再試' });
  }

  /** Get the authenticated user attached at connection time. */
  private user(socket: Socket): AuthedUser | null {
    const u = (socket as AuthedSocket).data.user;
    if (!u) {
      socket.emit('auth_error', { message: '未登入' });
      socket.disconnect();
      return null;
    }
    return u;
  }

  // ── create_room ──────────────────────────────────────────────────────────────

  @SubscribeMessage('create_room')
  handleCreateRoom(@ConnectedSocket() socket: Socket): void {
    if (this.isRateLimited(socket.id)) {
      this.rejectRateLimit(socket);
      return;
    }
    const user = this.user(socket);
    if (!user) return;

    const result = this.gameService.handleCreateRoom(user, socket.id);
    if ('error' in result) {
      socket.emit('room_error', { message: result.error });
      return;
    }

    void socket.join(result.roomCode);
    void socket.leave(LOBBY_ROOM);

    socket.emit('room_created', { roomCode: result.roomCode });

    const joined = this.gameService.buildRoomJoinedPayload(
      user.uid,
      result.roomCode,
    );
    if (joined) {
      socket.emit('room_joined', { ...joined, nickname: result.nickname });
    }
  }

  // ── join_room ────────────────────────────────────────────────────────────────

  @SubscribeMessage('join_room')
  handleJoinRoom(
    @ConnectedSocket() socket: Socket,
    @MessageBody() payload: unknown,
  ): void {
    if (this.isRateLimited(socket.id)) {
      this.rejectRateLimit(socket);
      return;
    }
    const user = this.user(socket);
    if (!user) return;

    const roomCode = extractString(payload, 'code');
    const result = this.gameService.handleJoinRoom(user, roomCode, socket.id);

    if ('error' in result) {
      socket.emit('room_error', { message: result.error });
      return;
    }

    void socket.join(result.roomCode);
    void socket.leave(LOBBY_ROOM);

    const joined = this.gameService.buildRoomJoinedPayload(
      user.uid,
      result.roomCode,
    );
    if (joined) {
      socket.emit('room_joined', { ...joined, nickname: result.nickname });
    }
  }

  // ── list_rooms ───────────────────────────────────────────────────────────────

  @SubscribeMessage('list_rooms')
  handleListRooms(@ConnectedSocket() socket: Socket): void {
    if (this.isRateLimited(socket.id)) {
      this.rejectRateLimit(socket);
      return;
    }
    const user = this.user(socket);
    if (!user) return;
    this.gameService.emitRoomListToSocket(socket.id, user.uid);
  }

  // ── vote_play ────────────────────────────────────────────────────────────────

  @SubscribeMessage('vote_play')
  handleVotePlay(@ConnectedSocket() socket: Socket): void {
    if (this.isRateLimited(socket.id)) {
      this.rejectRateLimit(socket);
      return;
    }
    this.gameService.handleVotePlay(socket.id);
  }

  // ── bid ──────────────────────────────────────────────────────────────────────

  @SubscribeMessage('bid')
  handleBid(
    @ConnectedSocket() socket: Socket,
    @MessageBody() payload: unknown,
  ): void {
    if (this.isRateLimited(socket.id)) {
      this.rejectRateLimit(socket);
      return;
    }

    const p = asRecord(payload);
    const rawValue = p?.value;
    if (rawValue !== 0 && rawValue !== 1) {
      socket.emit('room_error', { message: '無效的投票值' });
      return;
    }

    this.gameService.handleBid(socket.id, rawValue as 0 | 1);
  }

  // ── role_pick (抽地主 role-card draw) ──────────────────────────────────────────

  @SubscribeMessage('role_pick')
  handleRolePick(
    @ConnectedSocket() socket: Socket,
    @MessageBody() payload: unknown,
  ): void {
    if (this.isRateLimited(socket.id)) {
      this.rejectRateLimit(socket);
      return;
    }

    const p = asRecord(payload);
    const slot = p?.slotIndex;
    if (typeof slot !== 'number' || !Number.isInteger(slot) || slot < 0 || slot > 2) {
      socket.emit('room_error', { message: '無效的牌位' });
      return;
    }

    this.gameService.handleRolePick(socket.id, slot);
  }

  // ── play_cards ───────────────────────────────────────────────────────────────

  @SubscribeMessage('play_cards')
  handlePlayCards(
    @ConnectedSocket() socket: Socket,
    @MessageBody() payload: unknown,
  ): void {
    if (this.isRateLimited(socket.id)) {
      this.rejectRateLimit(socket);
      return;
    }

    const p = asRecord(payload);
    const rawCards = p?.cards;

    if (
      !Array.isArray(rawCards) ||
      rawCards.length === 0 ||
      rawCards.length > 20
    ) {
      socket.emit('invalid_play', { reason: '無效的牌組' });
      return;
    }

    const cards: Card[] = [];
    for (const c of rawCards) {
      const card = asRecord(c);
      if (!card) {
        socket.emit('invalid_play', { reason: '無效的牌' });
        return;
      }

      const { suit, rank } = card;
      if (
        typeof suit !== 'string' ||
        !VALID_SUITS.has(suit) ||
        typeof rank !== 'number' ||
        !Number.isInteger(rank) ||
        rank < 3 ||
        rank > 17
      ) {
        socket.emit('invalid_play', { reason: '無效的牌' });
        return;
      }

      cards.push({ suit: suit as Card['suit'], rank });
    }

    this.gameService.handlePlayCards(socket.id, cards);
  }

  // ── pass ─────────────────────────────────────────────────────────────────────

  @SubscribeMessage('pass')
  handlePass(@ConnectedSocket() socket: Socket): void {
    if (this.isRateLimited(socket.id)) {
      this.rejectRateLimit(socket);
      return;
    }
    this.gameService.handlePass(socket.id);
  }

  // ── surrender ────────────────────────────────────────────────────────────────

  @SubscribeMessage('surrender')
  handleSurrender(@ConnectedSocket() socket: Socket): void {
    if (this.isRateLimited(socket.id)) {
      this.rejectRateLimit(socket);
      return;
    }
    this.gameService.handleSurrender(socket.id);
  }

  // ── react_emoji ───────────────────────────────────────────────────────────────

  @SubscribeMessage('react_emoji')
  handleReactEmoji(
    @ConnectedSocket() socket: Socket,
    @MessageBody() payload: unknown,
  ): void {
    if (this.isRateLimited(socket.id)) {
      this.rejectRateLimit(socket);
      return;
    }

    const emoji = extractString(payload, 'emoji');
    if (!ALLOWED_REACTIONS.has(emoji)) {
      socket.emit('room_error', { message: '無效的反應' });
      return;
    }

    const now = Date.now();
    const last = this.emojiTimestamps.get(socket.id) ?? 0;
    if (now - last < 500) return;
    this.emojiTimestamps.set(socket.id, now);

    this.gameService.handleReactEmoji(socket.id, emoji);
  }

  // ── sync_request ─────────────────────────────────────────────────────────────

  @SubscribeMessage('sync_request')
  handleSyncRequest(
    @ConnectedSocket() socket: Socket,
    @MessageBody() payload: unknown,
  ): void {
    const roomCode = extractString(payload, 'roomCode');
    if (!roomCode) return;
    this.gameService.emitFullStateToSocket(socket.id, roomCode.toUpperCase());
  }

  // ── leave_room ────────────────────────────────────────────────────────────────

  @SubscribeMessage('leave_room')
  async handleLeaveRoom(@ConnectedSocket() socket: Socket): Promise<void> {
    const roomCode = this.getGameRoomCode(socket);
    this.gameService.handleLeaveRoom(socket.id);
    if (roomCode) void socket.leave(roomCode);
    // Notify the leaving socket first so it can reset UI before receiving the room list.
    socket.emit('left_room');
    // Re-subscribe to lobby broadcasts and send fresh list.
    await socket.join(LOBBY_ROOM);
    const user = (socket as AuthedSocket).data.user;
    this.gameService.emitRoomListToSocket(socket.id, user?.uid ?? null);
  }

  private getGameRoomCode(socket: Socket): string {
    for (const r of socket.rooms) {
      if (r !== socket.id) return r;
    }
    return '';
  }
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function extractString(payload: unknown, key: string): string {
  const p = asRecord(payload);
  return typeof p?.[key] === 'string' ? (p[key] as string) : '';
}
