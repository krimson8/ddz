# 鬥地主 (Dou Di Zhu) — Specification

A web-based multiplayer 鬥地主 (Fight the Landlord) card game for 3 players, with account-based identity, persistent stats, and an invite-only allowlist. All UI text is in **Traditional Chinese (繁體中文)**.

Repo: `c:\Programming\ddz` (Windows). Monorepo with `backend/` (NestJS) and `frontend/` (Next.js).

---

## 1. Architecture

```
┌─────────────────┐    WebSocket (Socket.IO) + REST    ┌──────────────────────┐
│   Frontend       │ ◄────────────────────────────────► │   Backend             │
│   Next.js 16     │                                    │   NestJS 11           │
│   Vercel         │                                    │   Railway             │
│                  │                                    │   In-memory rooms     │
│   Firebase Auth  │                                    │   Firebase Admin SDK  │
│   (browser SDK)  │                                    │                       │
└─────────────────┘                                    │   Drizzle ORM         │
                                                       │   ┌─────────────────┐ │
                                                       │   │ Postgres        │ │
                                                       │   │ (Railway addon) │ │
                                                       │   └─────────────────┘ │
                                                       └──────────────────────┘
                                                                  │
                                                       ┌──────────────────────┐
                                                       │   Firebase Auth       │
                                                       │   (email + password)  │
                                                       └──────────────────────┘
```

**Identity model:** Firebase UID is the canonical identity throughout backend, DB, and frontend. Socket IDs rotate per connection; uids are stable.

---

## 2. Tech stack

### Backend (`backend/`)
- NestJS 11, Socket.IO 4, TypeScript
- Drizzle ORM (`drizzle-orm` + `postgres` driver) on Railway Postgres
- `firebase-admin` for ID-token verification
- Local credentials: `backend/firebase-admin.json` (git-ignored). Prod: `FIREBASE_ADMIN_KEY` env var with the JSON content as a string.
- Local DB connection: `backend/.env` `DATABASE_URL=...` (Railway public URL). Prod: Railway reference `${{Postgres.DATABASE_URL}}`.

### Frontend (`frontend/`)
- Next.js 16 (App Router, Turbopack dev), React 18, Tailwind, Framer Motion
- `firebase` JS SDK (Auth)
- Env: `frontend/.env.local` for all `NEXT_PUBLIC_*` values

### Deploy targets
- **Backend → Railway** (backend service + Postgres addon)
- **Frontend → Vercel**
- **Auth → Firebase** project `ddz-game`

---

## 3. Database schema

Defined in [backend/src/db/schema.ts](backend/src/db/schema.ts), pushed via `npm run db:push`.

```sql
-- Invite-only allowlist. Only seeded emails can authenticate via the WS guard.
CREATE TABLE allowed_emails (
  email      TEXT PRIMARY KEY,
  added_at   TIMESTAMPTZ DEFAULT now() NOT NULL,
  note       TEXT
);

CREATE TABLE users (
  uid         TEXT PRIMARY KEY,        -- Firebase UID
  email       TEXT UNIQUE NOT NULL,
  nickname    TEXT NOT NULL,           -- editable on /profile
  avatar_url  TEXT,                    -- nullable (Phase 3)
  created_at  TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE TABLE game_results (
  id           SERIAL PRIMARY KEY,
  played_at    TIMESTAMPTZ DEFAULT now() NOT NULL,
  winner_role  TEXT NOT NULL,                          -- 'landlord' | 'farmer'
  plays        JSONB NOT NULL DEFAULT '[]'             -- Phase 4: full hand history
);
CREATE INDEX idx_game_results_id_desc ON game_results(id DESC NULLS LAST);

CREATE TABLE game_players (
  game_id   INT  REFERENCES game_results(id) ON DELETE CASCADE,
  uid       TEXT REFERENCES users(uid),
  role      TEXT NOT NULL,            -- 'landlord' | 'farmer'
  won       BOOLEAN NOT NULL,
  seat      INT NOT NULL,             -- 0/1/2; maps plays.seat back to a uid
  PRIMARY KEY (game_id, uid)
);
CREATE INDEX idx_game_players_uid ON game_players(uid);
```

DB scripts (all in `backend/`):
- `npm run db:push` — apply schema
- `npm run db:studio` — open Drizzle Studio
- `npm run db:seed-allowed` — re-runnable seed of `allowed_emails` (edits in [backend/scripts/seed-allowed-emails.ts](backend/scripts/seed-allowed-emails.ts))
- `npm run db:reset-user -- <email> [<email> ...]` — delete a user from Firebase Auth AND `users` table so they re-create on next login

---

## 4. Auth flow

### Sign-in (frontend)
- Sign-in page `/login`: email + password form
- Password is **anything the user types** (typically `Pa$$w0rd` for the test group). On first sign-in, account is auto-created via `createUserWithEmailAndPassword` if `signInWithEmailAndPassword` fails with `auth/user-not-found` / `invalid-credential`
- Firebase persists the session in IndexedDB (`browserLocalPersistence`)
- ID token is a 1-hour JWT, auto-refreshed by Firebase

### Socket handshake
- Frontend passes the current ID token in `auth.token` on socket connect ([frontend/src/lib/socket.ts](frontend/src/lib/socket.ts))
- Backend runs `server.use(middleware)` **before** any message handler can fire, calling `AuthService.authenticate(token)` which:
  1. `verifyToken` via Firebase Admin
  2. `assertAllowed` — looks up email in `allowed_emails`, throws if missing
  3. `upsertUser` — creates the `users` row on first sign-in (`nickname = email.split('@')[0]`)
- On success, `AuthedUser = { uid, email, nickname, avatarUrl }` is attached to `socket.data.user`
- On failure, `next(err)` rejects the connection — frontend sees `connect_error`

### REST auth
- `HttpAuthGuard` reads `Authorization: Bearer <token>` and runs the same `authenticate` pipeline

### Socket lifecycle (important details)
- The socket is keyed by **uid**, not by token ([frontend/src/lib/socket.ts](frontend/src/lib/socket.ts))
- Firebase's internal token rotations do **not** recreate the socket — recreating it would drop the user from any active game
- The socket singleton is stashed on `window.__ddz_socket` to survive Next.js HMR
- A "transient null user" state (Strict Mode double-render, async auth resolution) does **not** tear down the socket — only an explicit `signOutUser()` calls `destroySocket()`

---

## 5. Room mechanism

In-memory `Map<code, Room>` in [backend/src/game/room.manager.ts](backend/src/game/room.manager.ts). Identity is uid throughout.

**Key invariants:**
- **One room per uid** — user cannot create or join a second room while already in one
- **30-second reconnect grace window mid-game** — see §5a. Outside an active game (`waiting`/`result`), disconnect splices the member immediately.
- **Empty room → killed immediately** on last disconnect (skipping any pending grace)
- **Explicit `leave_room` always forfeits the round immediately** — only socket-level disconnects open the grace window

### 5a. Reconnect grace window (mid-game disconnect)

**Goal:** survive transient network drops, refreshes, and tab navigations during an active round without forcing all 3 players to restart. Out-of-game (waiting/result phases) keeps the immediate-splice behaviour from §5.

**Backend-owned state machine** ([backend/src/game/game.service.ts](backend/src/game/game.service.ts)):
- Constant: `RECONNECT_GRACE_MS = 30_000`. Per-room state lives on `Room.reconnect = { uid, endTime, timer } | null`.
- On socket disconnect of a `player` while `state === 'playing'`:
  1. Mark `member.disconnected = true`, clear `member.socketId` (so future broadcasts skip them until they reattach).
  2. **Pause the turn timer** (`clearTurnTimer`, `turnEndTime = 0`) so we don't auto-pass on someone who isn't there.
  3. Start a 30 s `setTimeout` and store it on `room.reconnect`.
  4. Emit `player_disconnected { uid, nickname, endTime, timeoutMs }` to the whole room.
- On (re)connection of a socket whose uid already owns a room (in `handleConnection`, before joining the lobby):
  - `GameService.reattachSocketToRoom(uid, newSocketId)` rebinds `member.socketId`, and if a matching grace timer is pending, it cancels it, clears `disconnected`, restarts the turn timer (if we're in gameplay), broadcasts `player_reconnected`, and unicasts a full-state snapshot via `emitFullStateToSocket` so the returning client can render.
- On grace expiry: splice the still-disconnected member, then `resetToWaiting(room)` (which emits `game_aborted` and returns the remaining members to the in-room lobby). If the room ends up empty, delete it.
- `resetToWaiting`, `handleWin`, and `deleteRoom` all defensively clear `room.reconnect` so timers never leak.

**Frontend is a pure renderer** of these events ([frontend/src/hooks/useGame.ts](frontend/src/hooks/useGame.ts), [frontend/src/components/GameBoard.tsx](frontend/src/components/GameBoard.tsx)):
- `player_disconnected` → set `disconnectedPlayer = { nickname, endTime, timeoutMs }` in `GameState`. The overlay reads `endTime - Date.now()` once per 250 ms to display the countdown.
- `player_reconnected` → clear `disconnectedPlayer`. No client-side timer fires the abort — that's exclusively the server's `setTimeout`.
- `game_aborted` → reducer wipes round state and returns to the in-room lobby (same handler used for grace expiry and for genuine errors).

**Wire format:**
```ts
// Server → Client
player_disconnected { uid: string, nickname: string, endTime: number, timeoutMs: number, seq }
player_reconnected  { uid: string, nickname: string, playerIds: string[], seq }
```

**Game flow:** user lands on lobby → sees active room list (broadcast over `__lobby` socket.io room) → creates or joins → in-room vote-to-play → game starts when 3 voters → bidding → gameplay → result → return to in-room lobby (room persists for next round). Spectator path also works (join a room mid-game).

### Member shape
```ts
interface Member {
  uid: string;            // Firebase UID — stable identity
  socketId: string;       // current socket; rotates per connection
  nickname: string;       // snapshot from users.nickname at join time; refreshed on profile edit
  avatarUrl: string | null;
  role: 'spectator' | 'player';
  hand: Card[];
  wantToPlay: boolean;
}
```

### Frontend identification
- `playerOrder` / `currentPlayer` / `lastPlayedBy` / `winnerIds` all contain **uids** (not socket IDs)
- The frontend identifies "me" by comparing against `user.uid` from Firebase

---

## 6. WebSocket events

Connection-time auth + lobby broadcasts.

**Client → Server**
- `create_room` (no payload — uses `socket.data.user`)
- `join_room { code }`
- `list_rooms` — request fresh lobby payload
- `vote_play`
- `bid { value: 0 | 1 }`
- `play_cards { cards }`
- `pass`
- `react_emoji { emoji }`
- `sync_request { roomCode }` — request a full state snapshot (used after a seq gap)
- `leave_room`

**Server → Client**
- `room_created { roomCode }`
- `room_joined { roomCode, members, playerIds, playerUids, myUid, state, seq, winCounts, readyCount, canVote, nickname }`
- `members_update { members, readyCount, canVote, seq }`
- `rooms_updated { rooms }` — per-uid (so `myMembership` is accurate); sent to sockets in `__lobby`
- `vote_closed_start { players, spectators, phase, seq }`
- `game_start { hand, firstBidder, phase, reconnect? }` (unicast per player; spectators get empty hand)
- `bid_open { timeoutMs, phase, seq }`, `bid_status { submitted }`, `bid_turn { ... }`, `bid_made { ... }`
- `landlord_decided { playerIndex, landlordCards, playerCardCounts, phase, seq }`
- `hand_updated { hand }` (unicast)
- `game_state { currentPlayer, currentPlayerEndTime, onTable, history, playerCardCounts, landlordIndex, landlordCards, playerHands, phase, seq }`
- `game_over { winner, landlordIndex, winCounts, winnerIds, winningCards, phase, seq }`
- `return_to_lobby { phase, seq }`
- `game_aborted { phase, seq }` (reconnect grace window expired, or a player explicitly left mid-game)
- `player_disconnected { uid, nickname, endTime, timeoutMs, seq }` (mid-game socket drop; 30s reconnect window starts — see §5a)
- `player_reconnected { uid, nickname, playerIds, seq }` (disconnected player came back inside the grace window)
- `emoji_reaction { senderUid, senderId, senderNickname, role, emoji }`
- `room_error { message }`, `invalid_play { reason }`, `auth_error { message }`

**Note on `id` vs `uid`:** Member objects in payloads have both `id` (= uid, for backward-compat with old frontend code that compared `m.id === socket.id`) and `uid`. Frontend can use either.

### Lobby room list payload shape (`rooms_updated`)
Each entry:
```ts
{
  code: string,
  phase: 'waiting' | 'bidding' | 'playing',
  members: [{ uid, nickname, avatarUrl, role, isCurrentTurn, isPlayer }],
  memberCount, playerCount, spectatorCount,
  myMembership: 'none' | 'player' | 'spectator'   // per-recipient
}
```

---

## 7. REST endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/health` | none | Health check |
| GET | `/auth/me` | Bearer | Returns `{ uid, email, nickname, avatarUrl }` |
| PATCH | `/users/me` | Bearer | `{ nickname }` — validates 2-20 chars, sanitizes HTML, propagates instantly to live socket sessions + rooms |
| GET | `/users/me/stats` | Bearer | Per-user stats `{ uid, nickname, avatarUrl, games, totalWins, landlordWins, farmerWins, winRate }` |
| GET | `/users/me/games?limit=N&before=<id>` | Bearer | Paginated history `{ games: HistoryRow[] }` newest first; keyset cursor on `gameId` |
| GET | `/games/:id` | Bearer | Single game detail `{ gameId, playedAt, winnerRole, plays: StoredPlay[], players: [...] }` |
| GET | `/leaderboard?limit=N` | **none (public)** | `{ entries: LeaderboardEntry[] }` ranked by total wins desc |

---

## 8. Leaderboard

Recorded on `game_over` in [backend/src/game/game.service.ts](backend/src/game/game.service.ts) → `handleWin`:
- Fire-and-forget call to `LeaderboardService.recordResult(winnerRole, players[])`
- Inserts one `game_results` row + 3 `game_players` rows (one per seat) in a transaction
- Errors are logged but never thrown — never breaks the live game flow

Global leaderboard query (returns top 50 by default):
```sql
SELECT u.uid, u.nickname, u.avatar_url,
       COUNT(*)                                                AS games,
       COUNT(*) FILTER (WHERE gp.won)                          AS total_wins,
       COUNT(*) FILTER (WHERE gp.won AND gp.role='landlord')   AS landlord_wins,
       COUNT(*) FILTER (WHERE gp.won AND gp.role='farmer')     AS farmer_wins
FROM game_players gp JOIN users u USING (uid)
GROUP BY u.uid, u.nickname, u.avatar_url
ORDER BY total_wins DESC, games DESC
LIMIT $1;
```

Displayed in:
- In-room lobby ([frontend/src/components/RoomLobby.tsx](frontend/src/components/RoomLobby.tsx)) — top 10 with columns 排名/玩家/總勝/地/農/場次, auto-refreshes on `game_over` + `return_to_lobby`
- (Not yet shown elsewhere; consider adding compact top-3 to the global lobby)

---

## 9. Profile page (`/profile`)

[frontend/src/app/profile/page.tsx](frontend/src/app/profile/page.tsx) — uses [frontend/src/hooks/useProfile.ts](frontend/src/hooks/useProfile.ts).

- Header: avatar placeholder (initial letter) + click-to-edit nickname (✏️) + email
- Stats card: 總勝 / 場次 / 地主勝 / 農民勝 + 勝率
- Optimistic nickname update with revert on error
- Accessible from lobby header — clicking your nickname links to `/profile`

When nickname is edited:
- `UsersService.updateNickname` writes to DB
- Calls `GameService.refreshUserInRoom(uid, { nickname })` which:
  - Updates `socket.data.user.nickname` on every connected socket of that uid
  - Updates `Member.nickname` in the room (if any)
  - Broadcasts `members_update` to the room
  - Broadcasts `rooms_updated` to the lobby

---

## 10. Allowlist (invite-only)

Backend's WS auth middleware rejects any email not in `allowed_emails`. Seed via:

```bash
cd backend && npm run db:seed-allowed
```

Edit [backend/scripts/seed-allowed-emails.ts](backend/scripts/seed-allowed-emails.ts) to add more. The script uses `ON CONFLICT DO NOTHING`, safe to re-run.

Currently seeded (8 emails):
- `tongchenyang62@hotmail.com`
- `ziyilai96@gmail.com`
- `cheehong0211@hotmail.com`
- `jjen09031996@hotmail.com`
- `yewshaocong@gmail.com`
- `krimson8@gmail.com` (owner)
- `krimson8+1@gmail.com` (test alias)
- `krimson8+2@gmail.com` (test alias)

To reset a user (clears Firebase Auth record + `users` row, so they re-create with whatever password they type next):
```bash
cd backend && npm run db:reset-user -- email@example.com
```

---

## 11. Repository layout

```
ddz/
├── SPEC.md                          ← this file
├── plan.md                          ← original 4-phase plan (1A → 4)
├── backend/
│   ├── drizzle.config.ts
│   ├── firebase-admin.json          (gitignored)
│   ├── .env                         (gitignored; DATABASE_URL)
│   ├── scripts/
│   │   ├── seed-allowed-emails.ts
│   │   └── reset-user.ts
│   └── src/
│       ├── main.ts                  (loads dotenv, CORS, listen)
│       ├── app.module.ts            (DbModule, AuthModule, LeaderboardModule, UsersModule, GameModule)
│       ├── auth/
│       │   ├── firebase-admin.ts    (lazy admin init; FIREBASE_ADMIN_KEY env OR firebase-admin.json file)
│       │   ├── auth.service.ts      (verifyToken, assertAllowed, upsertUser, authenticate)
│       │   ├── ws-auth.guard.ts     (AuthedSocket type + WsAuthGuard — unused, middleware in gateway does it)
│       │   ├── http-auth.guard.ts   (HttpAuthGuard for REST)
│       │   ├── auth.controller.ts   (GET /auth/me)
│       │   └── auth.module.ts
│       ├── db/
│       │   ├── schema.ts            (allowed_emails, users, game_results, game_players)
│       │   └── db.module.ts         (Drizzle client provider, DB symbol)
│       ├── game/
│       │   ├── types.ts
│       │   ├── card.utils.ts        (deck, shuffle, sortHand, validatePlay)
│       │   ├── room.manager.ts      (Map<code, Room>; CRUD + lookups)
│       │   ├── game.service.ts      (state machine + lobby broadcasts + refreshUserInRoom hook)
│       │   ├── game.gateway.ts      (server.use middleware auth, all @SubscribeMessage handlers)
│       │   └── game.module.ts       (exports GameService, RoomManager)
│       ├── leaderboard/
│       │   ├── leaderboard.service.ts  (recordResult, getGlobalLeaderboard, getUserStats)
│       │   ├── leaderboard.controller.ts  (GET /leaderboard)
│       │   └── leaderboard.module.ts   (@Global, exports LeaderboardService)
│       ├── users/
│       │   ├── users.service.ts        (updateNickname → refreshUserInRoom)
│       │   ├── users.controller.ts     (PATCH /users/me, GET /users/me/stats)
│       │   └── users.module.ts         (imports GameModule for GameService)
│       └── health/health.controller.ts
└── frontend/
    ├── .env.local                   (gitignored; NEXT_PUBLIC_* + API/WS URLs)
    └── src/
        ├── app/
        │   ├── layout.tsx
        │   ├── globals.css
        │   ├── page.tsx             (auth gate → lobby → in-room lobby → game board)
        │   ├── login/page.tsx       (email + password sign-in/auto-create)
        │   ├── profile/page.tsx     (avatar + nickname edit + stats)
        │   └── auth-test/page.tsx   (debug page — works, kept for now)
        ├── lib/
        │   ├── firebase.ts          (app init, browserLocalPersistence)
        │   ├── auth.ts              (signInOrCreate, onAuthChange, getCurrentIdToken, signOutUser)
        │   ├── api.ts               (apiFetch<T> helper, attaches Bearer)
        │   ├── socket.ts            (window-persisted singleton; keyed by uid not token)
        │   └── cardUtils.ts
        ├── hooks/
        │   ├── useAuth.ts           (user, loading, signOut)
        │   ├── useProfile.ts        (me, stats, updateNickname)
        │   ├── useSocket.ts         (gates socket connect on auth)
        │   ├── useGame.ts           (reducer + all socket event handlers)
        │   ├── useRoomList.ts       (subscribes to rooms_updated)
        │   ├── useLeaderboard.ts    (fetch + refetch on game_over)
        │   └── useSoundEffects.ts
        ├── components/
        │   ├── LobbyRoomList.tsx    (avatars + phase badges + ↩ rejoin)
        │   ├── RoomLobby.tsx        (in-room: code + member strip + 全球排行榜 + 我要玩 button)
        │   ├── GameBoard.tsx
        │   ├── GameResult.tsx
        │   ├── BiddingPanel.tsx
        │   ├── CardHand.tsx, Card.tsx, PlayArea.tsx, PlayHistory.tsx, PlayerSeat.tsx
        │   ├── Countdown.tsx, VolumeControl.tsx
        └── types/game.ts
```

---

## 12. Environment variables

### Backend (Railway)
| Var | Value | Notes |
|---|---|---|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` | Railway reference variable (internal URL) |
| `FIREBASE_ADMIN_KEY` | full service-account JSON as one string | Local dev reads `firebase-admin.json` instead |
| `CORS_ORIGIN` | `https://<your-app>.vercel.app` | Single origin currently; update `main.ts` for multi-origin |
| `PORT` | unset | Railway sets this automatically |
| `NODE_ENV` | `production` | Optional |

Build/start: `npm install && npm run build` / `npm run start:prod`. Root dir = `backend`.

### Frontend (Vercel)
All `NEXT_PUBLIC_*` (must have the prefix or Next won't expose them):
- `NEXT_PUBLIC_FIREBASE_API_KEY=AIzaSyD_1Rtf0-7TXjSmWWexnc_KyrdyyoQ7wto`
- `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=ddz-game.firebaseapp.com`
- `NEXT_PUBLIC_FIREBASE_PROJECT_ID=ddz-game`
- `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=ddz-game.firebasestorage.app`
- `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=976219661041`
- `NEXT_PUBLIC_FIREBASE_APP_ID=1:976219661041:web:b542bb8953a7d10c657f50`
- `NEXT_PUBLIC_API_URL=https://<your-backend>.up.railway.app`
- `NEXT_PUBLIC_WS_URL=https://<your-backend>.up.railway.app`

Root dir = `frontend`.

### Firebase Console (one-time)
- Add `<your-app>.vercel.app` to **Authentication → Settings → Authorized domains**

---

## 13. Things that are done

- [x] Phase 1A — DB schema + Drizzle wiring + seed scripts
- [x] Phase 1B — Firebase Auth (originally magic-link, switched to email+password due to Spark plan daily email cap; auto-creates account on first sign-in)
- [x] Phase 1C — Room mechanism rewrite (uid-based, empty room kill, one-room-per-uid, lobby room list). 30-second reconnect grace window for mid-game disconnects added later (see §5a).
- [x] Phase 1D — Leaderboard (recordResult on game_over, GET /leaderboard, global leaderboard panel in RoomLobby)
- [x] Phase 2 — Profile page (`/profile`) with nickname edit and stats; instant propagation to live rooms via `refreshUserInRoom`

## 14. Things NOT done yet

- [x] **Phase 3 — Avatar upload** (done). Client-side resize to 256×256 JPEG q=0.85, encoded as base64 data URL, PATCH `/users/me` with `{ avatarUrl }`. Stored inline in `users.avatar_url` (Postgres TEXT). Avoids Firebase Storage (paid). Backend caps at 64 KB; client auto-drops quality if over. Shown in profile, leaderboard table, lobby room cards, player seats.
- [x] **Phase 4 — Played-hand history** (done):
  - Backend: `recordResult(winnerRole, players, plays)` persists `room.playHistory` as `game_results.plays` JSONB `[{seat, cards:[{suit,rank}...]}...]`. Same txn prunes plays from games outside the newest 200 to `[]`.
  - REST: `GET /users/me/games?limit=20&before=<gameId>` (keyset pagination, returns rows with players + role/won/seat); `GET /games/:id` for full plays (auth-gated).
  - UI: `/profile` shows paginated history list (date + win/loss chip + 3 player avatars with role badges + ★ on winners); click a row with `hasPlays=true` → modal overlay with vertically scrollable plays, each row `[#] [avatar + nickname + role] [mini cards, h-scroll if overflow]`. Older games (pruned) display "回放資料已清除".
- [ ] **Multi-origin CORS in `main.ts`** — currently only supports one origin. Needed if you want both `localhost:3000` and the Vercel URL working simultaneously.
- [ ] **Delete `/auth-test` debug page** — `frontend/src/app/auth-test/page.tsx` was kept around for debugging. Safe to remove now.
- [ ] **Optional polish on lobby**: compact top-3 leaderboard preview in the global lobby (next to / above the room list).

## 15. Known dev-environment caveats

- **Strict Mode + HMR + Firebase auth** caused early socket churn bugs (multiple sockets per user, players dropped from rooms mid-game-start). Fixed by:
  - Keying the socket on uid not token
  - Stashing the singleton on `window` to survive HMR
  - Treating transient `null` user states as no-op (don't tear down on Strict Mode re-renders)
  - Auth happens in `server.use(middleware)` not in `handleConnection` so messages can't race past auth
- **`/auth-test` page** still uses password sign-in (not magic-link); kept for sanity checks
- Firebase Spark plan caps email/identity-toolkit at ~5 emails/day → that's why magic-link was abandoned and password sign-in adopted (no email cost). Free signups also possible since there are no email costs

---

## 16. Game rules

Standard 鬥地主, hand types defined in [backend/src/game/types.ts](backend/src/game/types.ts) `HandType` enum. Validation in [backend/src/game/card.utils.ts](backend/src/game/card.utils.ts) `validatePlay`. 3 players, 54 cards (52 + 2 jokers), 17 dealt to each + 3 face-down landlord cards. Bidding is yes/no (1 round, 8s window, random tiebreaker among yes-voters; if no yes-voters, random pick). Turn timer 30s with auto-pass.
