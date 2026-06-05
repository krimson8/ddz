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
import { AuthService, AuthedUser } from '../auth/auth.service';
import type { AuthedSocket } from '../auth/ws-auth.guard';

// The 15 reaction texts. MUST stay in sync with the frontend EMOJI_SOUNDS map
// in hooks/useSoundEffects.ts (SPEC_WUZIQI §10a).
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

// Accept a comma-separated CORS_ORIGIN so the unified DDZ frontend (:3000 dev /
// DDZ domain prod) can open a lobby socket here alongside the legacy wuziqi
// frontend (:3001). Mirrors the list logic in main.ts.
const WS_CORS_ORIGINS = (
  process.env.CORS_ORIGIN ?? 'http://localhost:3000,http://localhost:3001'
)
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

@WebSocketGateway({
  cors: {
    origin: WS_CORS_ORIGINS,
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
      socket.disconnect();
      return;
    }
    this.logger.log(
      `WS connected: socket=${socket.id} uid=${user.uid} email=${user.email}`,
    );

    // Reattach to an existing room (reconnect during the 30s grace window).
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

  // ── place_stone ──────────────────────────────────────────────────────────────
  // Replaces DDZ play_cards / pass / bid. Validation of game legality is
  // backend-authoritative (state machine, step 4); here we only sanitize the
  // payload to integer coordinates.

  @SubscribeMessage('place_stone')
  handlePlaceStone(
    @ConnectedSocket() socket: Socket,
    @MessageBody() payload: unknown,
  ): void {
    if (this.isRateLimited(socket.id)) {
      this.rejectRateLimit(socket);
      return;
    }

    const p = asRecord(payload);
    const x = p?.x;
    const y = p?.y;
    if (
      typeof x !== 'number' ||
      typeof y !== 'number' ||
      !Number.isInteger(x) ||
      !Number.isInteger(y)
    ) {
      socket.emit('invalid_move', { reason: '無效的座標' });
      return;
    }

    this.gameService.placeStone(socket.id, x, y);
  }

  // ── resign ───────────────────────────────────────────────────────────────────
  // Replaces DDZ surrender.

  @SubscribeMessage('resign')
  handleResign(@ConnectedSocket() socket: Socket): void {
    if (this.isRateLimited(socket.id)) {
      this.rejectRateLimit(socket);
      return;
    }
    this.gameService.handleResign(socket.id);
  }

  // ── vote_draw (和局) ───────────────────────────────────────────────────────────
  // Per-player draw toggle; the game ends in a draw only once both players vote.

  @SubscribeMessage('vote_draw')
  handleVoteDraw(@ConnectedSocket() socket: Socket): void {
    if (this.isRateLimited(socket.id)) {
      this.rejectRateLimit(socket);
      return;
    }
    this.gameService.handleDrawVote(socket.id);
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
    socket.emit('left_room');
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
