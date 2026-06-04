# 五子棋 (Wuziqi / Gomoku) — Specification

A web-based multiplayer 五子棋 (Five-in-a-Row) board game for 2 players, with
account-based identity, persistent stats, an invite-only allowlist, and live
spectating. All UI text is in **Traditional Chinese (繁體中文)**.

This game is built as a **sibling** of the existing 鬥地主 (Dou Di Zhu) project in
the same monorepo. It deliberately reuses DDZ's proven architecture:
**backend-centric communication — all authoritative state lives in the in-memory
room on the backend, and the frontend is a pure renderer of server events.**

> Read [SPEC.md](SPEC.md) (the DDZ spec) first. This document only describes
> what differs from DDZ. Anything not mentioned here is identical to DDZ and
> should be ported as-is.

Repo: `c:\Programming\ddz` (Windows). New sibling apps: `wuziqi_backend/` (NestJS)
and `wuziqi_frontend/` (Next.js).

---

## 0. Relationship to the DDZ codebase

| Concern | Decision |
|---|---|
| **Firebase Auth** | **Shared.** Same Firebase project (`ddz-game`), same browser SDK config, same email+password auto-create flow, same `allowed_emails` gate. A user signs in once per app with the same credentials and gets the same UID. |
| **Database** | **Shared Postgres instance.** Reuses the existing `users` and `allowed_emails` tables verbatim (same UID/email/nickname/avatar — one profile across both games). Adds **two new tables** `wuziqi_results` + `wuziqi_players`. DDZ's `game_results`/`game_players` are untouched. |
| **Hosting** | **Separate services.** `wuziqi_backend` → its own Railway service (pointing at the **same** Postgres addon via `DATABASE_URL`). `wuziqi_frontend` → its own Vercel project. |
| **Code reuse** | Backend room/auth/leaderboard/users plumbing is copied from DDZ and adapted. The DDZ-specific card logic is replaced by board logic. Frontend socket/auth/profile plumbing is copied; the card UI is replaced by a board UI. |

**Why share users but not match tables:** the leaderboards are per-game (a 五子棋
win is not a 鬥地主 win), but identity, avatars, nicknames, and the invite
allowlist are global. This keeps one Firebase project, one user base, and lets a
profile page (per app) show that game's stats while the human is the same person.

---

## 1. Architecture

Identical topology to DDZ (see [SPEC.md](SPEC.md) §1), just a second instance:

```
┌─────────────────┐    WebSocket (Socket.IO) + REST    ┌──────────────────────┐
│  wuziqi_frontend │ ◄────────────────────────────────► │  wuziqi_backend       │
│  Next.js         │                                    │  NestJS               │
│  Vercel (new)    │                                    │  Railway (new svc)    │
│                  │                                    │  In-memory rooms      │
│  Firebase Auth   │                                    │  Firebase Admin SDK   │
│  (project        │                                    │                       │
│   ddz-game)      │                                    │  Drizzle ORM          │
└─────────────────┘                                    │   ┌─────────────────┐ │
                                                       │   │ SAME Postgres   │ │
                                                       │   │ (Railway addon  │ │
                                                       │   │  shared w/ DDZ) │ │
                                                       │   └─────────────────┘ │
                                                       └──────────────────────┘
```

**Identity model (unchanged):** Firebase UID is the canonical identity throughout
backend, DB, and frontend. Socket IDs rotate per connection; uids are stable.

**Backend-centric principle (the whole point):** the backend owns a single
authoritative `Room` object per game. Every mutation (place stone, pass turn,
timeout, win detection) happens on the backend, which then **broadcasts the new
state** to all sockets in the room. The frontend never computes game outcomes —
it renders `game_state` / `game_over` / `move_made` events and sends intents
(`place_stone`). This is exactly the DDZ model; only the rules differ.

---

## 2. Tech stack

Same as DDZ ([SPEC.md](SPEC.md) §2). `wuziqi_backend` is NestJS 11 + Socket.IO 4
+ Drizzle + firebase-admin. `wuziqi_frontend` is Next.js + React + Tailwind +
Framer Motion + firebase JS SDK.

### Deploy targets
- **wuziqi_backend → Railway** (new service; **reuse the existing Postgres
  addon** — do not provision a second DB)
- **wuziqi_frontend → Vercel** (new project)
- **Auth → Firebase** project `ddz-game` (shared)

---

## 3. Database schema

The shared tables `allowed_emails` and `users` are **defined and owned by the DDZ
backend** ([backend/src/db/schema.ts](backend/src/db/schema.ts)). The wuziqi
backend declares them in its own `schema.ts` too (so Drizzle can join against
them) but **must not** run a destructive `db:push` that would drop/recreate them.

> ⚠️ **Migration discipline:** because two apps share one database, the wuziqi
> backend's `drizzle.config.ts` and `db:push` must only create the two new
> `wuziqi_*` tables. Verify the generated migration touches *only* the new tables
> before applying. When in doubt, create the tables with explicit SQL rather than
> a blind `db:push`. **Never** drop `users`, `allowed_emails`, `game_results`, or
> `game_players`.

New tables:

```sql
-- One row per finished 五子棋 game.
CREATE TABLE wuziqi_results (
  id           SERIAL PRIMARY KEY,
  played_at    TIMESTAMPTZ DEFAULT now() NOT NULL,
  winner_color TEXT NOT NULL,                 -- 'black' | 'white' | 'draw'
  win_reason   TEXT NOT NULL,                 -- 'five' | 'timeout' | 'resign' | 'disconnect' | 'draw'
  board_size   INT  NOT NULL DEFAULT 15,
  moves        JSONB NOT NULL DEFAULT '[]'    -- full move history (replay)
);
CREATE INDEX idx_wuziqi_results_id_desc ON wuziqi_results(id DESC NULLS LAST);

-- Two rows per game (one per player). Mirrors DDZ's game_players.
CREATE TABLE wuziqi_players (
  game_id   INT  REFERENCES wuziqi_results(id) ON DELETE CASCADE,
  uid       TEXT REFERENCES users(uid),
  color     TEXT NOT NULL,                    -- 'black' | 'white'
  won       BOOLEAN NOT NULL,
  PRIMARY KEY (game_id, uid)
);
CREATE INDEX idx_wuziqi_players_uid ON wuziqi_players(uid);
```

**`moves` JSONB shape** (one entry per stone placed, in play order):
```ts
{ color: 'black' | 'white', x: number, y: number }   // x,y are 0-indexed board coords
```
Same retention strategy as DDZ: keep full `moves` for the newest 200 games, prune
older games' `moves` to `[]` inside the same insert transaction.

DB scripts (in `wuziqi_backend/`):
- `npm run db:push` — apply **only** the wuziqi tables (see migration discipline above)
- `npm run db:studio` — Drizzle Studio
- `npm run db:seed-allowed` — **shared allowlist**; can be the same script as DDZ.
  Recommended: do NOT duplicate seeding logic — the allowlist is already seeded by
  DDZ. This script is a convenience for adding emails; it must use
  `ON CONFLICT DO NOTHING` so running it from either app is safe.

---

## 4. Auth flow

**Identical to DDZ** ([SPEC.md](SPEC.md) §4) — port the files verbatim:
- `auth/firebase-admin.ts`, `auth/auth.service.ts`, `auth/http-auth.guard.ts`,
  `auth/ws-auth.guard.ts`, `auth/auth.controller.ts`, `auth/auth.module.ts`
- Frontend `lib/firebase.ts`, `lib/auth.ts`, `lib/api.ts`, `lib/socket.ts`,
  `hooks/useAuth.ts`, `hooks/useSocket.ts`

The connection-level `server.use(middleware)` auth (verify token → assert allowed
→ upsert user) is preserved exactly. The socket singleton keyed by uid + stashed
on `window` to survive HMR is preserved exactly (rename `window.__ddz_socket` →
`window.__wuziqi_socket` to avoid clashing if both apps are ever open on the same
origin, though they won't be — different Vercel domains).

The same Firebase project means the same authorized-domains list must include the
new Vercel domain (Firebase Console → Authentication → Settings → Authorized
domains).

---

## 5. Room mechanism

Port [backend/src/game/room.manager.ts](backend/src/game/room.manager.ts) and the
room half of [backend/src/game/game.service.ts](backend/src/game/game.service.ts)
with these adaptations:

**Key invariants (mostly unchanged from DDZ [SPEC.md](SPEC.md) §5):**
- **One room per uid** — cannot create/join a second room while in one.
- **Players capped at 2** (instead of 3). A 3rd+ joiner is a **spectator**.
- **Vote-to-play**: game starts when **2** members have voted 我要下 (instead of 3).
- **30-second reconnect grace window mid-game** — port §5a verbatim. Pause the
  turn timer on disconnect, resume on reattach, abort the game on grace expiry.
- **Empty room → killed immediately** on last disconnect.
- **Explicit `leave_room` mid-game forfeits immediately** (the leaver loses).
- **Spectators** join anytime, including mid-game, and receive a full board
  snapshot on join (`emitFullStateToSocket`).

### Member shape (adapted)
```ts
interface Member {
  uid: string;
  socketId: string;
  nickname: string;
  avatarUrl: string | null;
  role: 'spectator' | 'player';
  color: 'black' | 'white' | null;   // assigned at game start; null until then
  wantToPlay: boolean;
  disconnected: boolean;
}
```
(`hand: Card[]` from DDZ is removed — there are no private hands in 五子棋. The
board is fully public, which actually makes spectating trivial: everyone sees the
same state.)

### Room shape (adapted)
Replace DDZ's card/bidding/landlord fields with board state:
```ts
interface Room {
  code: string;
  members: Member[];
  state: 'waiting' | 'playing' | 'result';   // no 'bidding' phase
  eventSeq: number;

  // ── board state (authoritative) ──
  boardSize: number;                  // 15
  board: (0 | 1 | 2)[][];             // 0 empty, 1 black, 2 white; [y][x]
  moves: { color: 'black' | 'white'; x: number; y: number }[];  // play order
  currentColor: 'black' | 'white';    // whose turn
  blackUid: string | null;            // which player is black this round
  whiteUid: string | null;
  turnEndTime: number;                // epoch ms; 0 when no active timer
  turnTimer: NodeJS.Timeout | null;

  winnerColor: 'black' | 'white' | 'draw' | null;
  winReason: 'five' | 'timeout' | 'resign' | 'disconnect' | 'draw' | null;

  winCounts: Record<string, number>; // uid -> wins this room session
  resultPending: boolean;
  reconnect: { uid: string; endTime: number; timer: NodeJS.Timeout } | null;
}
```

### Frontend identification (unchanged philosophy)
- `blackUid` / `whiteUid` / `currentTurnUid` contain **uids**, not socket IDs.
- The frontend identifies "me" by comparing against `user.uid` from Firebase, and
  derives "am I black/white/spectator" from the room payload.

---

## 6. Game flow & rules

### 6.1 Ruleset (decided)
- **Board:** 15×15.
- **Win:** **free-style five-in-a-row** — first color to get **five or more** of
  its stones in a contiguous line (horizontal, vertical, or either diagonal) wins.
  No overline/forbidden-move restrictions (no Renju rules).
- **First move:** **Black moves first.** At game start, Black/White are assigned
  **randomly** between the 2 voters.
- **Draw:** board full (225 stones) with no five-in-a-row → draw.

### 6.2 Turn timer (decided)
- **30-second per-move timer** (reuse DDZ's turn-timer machinery).
- **On timeout: the backend auto-places a random valid (empty) cell** for the
  timed-out player, then advances the turn. (This keeps games progressing and
  keeps all state server-authoritative — the random move is chosen and applied on
  the backend, then broadcast like any other move.)
- The timer pauses during a reconnect grace window and resumes on reattach
  (identical to DDZ §5a).

### 6.3 Flow
lobby → see active room list → create or join → in-room vote-to-play
(我要下) → when 2 voters: **game_start** (random color assignment, empty board,
Black to move) → players alternate `place_stone` → backend validates, applies,
checks win after each move → on five-in-a-row / board-full / timeout-random /
resign / disconnect-grace-expiry: **game_over** → result screen → return to
in-room lobby (room persists for next round; colors re-randomized next game).

### 6.4 Move validation (backend-authoritative)
On `place_stone { x, y }`:
1. Reject if `state !== 'playing'`.
2. Reject if the sender's uid is not the `currentColor`'s player.
3. Reject if `x`/`y` out of `[0, boardSize)` or not integers.
4. Reject if `board[y][x] !== 0` (occupied).
5. Apply: set cell, push to `moves`, clear turn timer.
6. Run win check centered on `(x, y)` (scan 4 directions for a run ≥ 5).
7. If win → `handleWin(color, 'five')`. Else if board full → `handleWin('draw',
   'draw')`. Else flip `currentColor`, start a fresh 30s turn timer, broadcast.

All of the above happens on the backend. Invalid intents get `invalid_move
{ reason }`; the board state never changes from a rejected intent.

---

## 7. WebSocket events

Connection-time auth + lobby broadcasts are **identical to DDZ** ([SPEC.md](SPEC.md)
§6). Below are the game-specific deltas. Keep the `seq` field on every server
event (monotonic per room) so the client can detect gaps and `sync_request`.

**Client → Server**
- `create_room` (no payload)
- `join_room { code }`
- `list_rooms`
- `vote_play`
- `place_stone { x, y }`        ← replaces DDZ `play_cards` / `pass` / `bid`
- `resign`                      ← replaces DDZ `surrender`
- `react_emoji { emoji }`
- `sync_request { roomCode }`
- `leave_room`

**Server → Client**
- `room_created { roomCode }`
- `room_joined { roomCode, members, playerUids, myUid, state, seq, winCounts, readyCount, canVote, nickname }`
- `members_update { members, readyCount, canVote, seq }`
- `rooms_updated { rooms }`    (per-uid; sent to `__lobby` sockets)
- `vote_closed_start { players, spectators, phase, seq }`
- `game_start { boardSize, blackUid, whiteUid, yourColor, currentColor, phase, reconnect?, seq }`
  (unicast per player so each learns `yourColor`; spectators get `yourColor: null`)
- `move_made { x, y, color, nextColor, currentPlayerEndTime, moveCount, phase, seq }`
  (broadcast after every applied move, including server auto-placed timeout moves —
  include a `byTimeout: boolean` flag so the UI can annotate it)
- `game_state { board, moves, currentColor, currentPlayerEndTime, blackUid, whiteUid, winCounts, phase, seq }`
  (full snapshot — sent on join, on `sync_request`, and on reconnect reattach)
- `game_over { winnerColor, winReason, winnerUid, winningLine, winCounts, phase, seq }`
  (`winningLine` = the array of 5 `{x,y}` cells to highlight, or null for draw/non-five)
- `return_to_lobby { phase, seq }`
- `game_aborted { phase, seq }`   (reconnect grace expired, or player left mid-game)
- `player_disconnected { uid, nickname, endTime, timeoutMs, seq }`
- `player_reconnected { uid, nickname, playerUids, seq }`
- `emoji_reaction { senderUid, senderNickname, role, emoji }`
- `room_error { message }`, `invalid_move { reason }`, `auth_error { message }`

**Lobby room list payload (`rooms_updated`)** — same shape as DDZ but `phase` is
`'waiting' | 'playing'` (no bidding), and `playerCount` caps at 2.

---

## 8. REST endpoints

Mirror DDZ ([SPEC.md](SPEC.md) §7), pointed at the wuziqi tables:

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/health` | none | Health check |
| GET | `/auth/me` | Bearer | `{ uid, email, nickname, avatarUrl }` |
| PATCH | `/users/me` | Bearer | `{ nickname }` or `{ avatarUrl }` — same validation/propagation as DDZ. **Writes to the shared `users` table**, so a nickname/avatar change here also shows in DDZ. |
| GET | `/users/me/stats` | Bearer | Per-user 五子棋 stats `{ uid, nickname, avatarUrl, games, wins, blackWins, whiteWins, winRate }` |
| GET | `/users/me/games?limit=N&before=<id>` | Bearer | Paginated 五子棋 history (keyset on `gameId`) |
| GET | `/games/:id` | Bearer | Single game detail `{ gameId, playedAt, winnerColor, winReason, moves, players }` (for replay) |
| GET | `/leaderboard?limit=N` | **public** | `{ entries }` ranked by wins desc, over `wuziqi_players` |

> **Shared-write caveat:** `PATCH /users/me` mutates the shared `users` row. That's
> intentional (one profile). But the live-propagation hook (`refreshUserInRoom`)
> only reaches rooms **on this backend** — a nickname change in wuziqi will reflect
> in DDZ only after the DDZ user's next room join / token refresh, not instantly.
> Document this; don't try to cross-notify the two backends.

---

## 9. Leaderboard & stats

Port DDZ's `leaderboard/` module against the wuziqi tables. `recordResult` is
called fire-and-forget from `handleWin`:
- Insert one `wuziqi_results` row + two `wuziqi_players` rows in a transaction.
- Prune `moves` from games outside the newest 200.
- Errors logged, never thrown (never breaks the live game).

Leaderboard query (top 50 by wins):
```sql
SELECT u.uid, u.nickname, u.avatar_url,
       COUNT(*)                                          AS games,
       COUNT(*) FILTER (WHERE wp.won)                    AS wins,
       COUNT(*) FILTER (WHERE wp.won AND wp.color='black') AS black_wins,
       COUNT(*) FILTER (WHERE wp.won AND wp.color='white') AS white_wins
FROM wuziqi_players wp JOIN users u USING (uid)
GROUP BY u.uid, u.nickname, u.avatar_url
ORDER BY wins DESC, games DESC
LIMIT $1;
```
(Draws insert two rows with `won = false`, so they count toward `games` but not
`wins`.)

Displayed in the in-room lobby (top 10) and on `/profile`, same as DDZ.

---

## 10. Frontend

Port the DDZ frontend's plumbing verbatim (`lib/`, `hooks/useAuth`,
`hooks/useSocket`, `hooks/useRoomList`, `hooks/useLeaderboard`, `hooks/useProfile`,
the lobby/room-list/room-lobby/profile components, sound infra). Replace the
card-game surface with a board surface:

**New / replaced components:**
- `Board.tsx` — renders the 15×15 grid (SVG or CSS grid). Click an empty
  intersection to emit `place_stone`. Disabled when it's not your turn / you're a
  spectator / game not playing. Highlights the last move and the winning line.
- `Stone.tsx` — a black/white stone with a subtle drop animation (Framer Motion).
- `GameResult.tsx` — 黑/白 winner, win reason (五子連線 / 超時 / 認輸 / 對手斷線), rematch via
  return-to-lobby.
- `MoveHistory.tsx` (optional) — list of moves; powers replay on the profile/game
  detail page.

**Reducer (`hooks/useGame.ts`):** same pattern as DDZ — a reducer whose only job
is to fold server events into render state. Handlers:
`game_start` → set board empty + my color + whose turn; `move_made` → set
`board[y][x]`, flip turn, update timer; `game_state` → replace whole snapshot
(used on join/reconnect/sync); `game_over` → set winner + winning line for
highlight; `return_to_lobby` / `game_aborted` → reset to in-room lobby;
`player_disconnected`/`player_reconnected` → the same countdown overlay as DDZ.

**The frontend computes nothing about wins or legality** — it greys out illegal
clicks optimistically for UX but trusts `move_made` / `invalid_move` from the
server as the source of truth.

---

## 10a. Static assets (MUST be copied when scaffolding the frontend)

When `wuziqi_frontend` is created by copying `frontend/`, the following non-code
assets must be copied too — they are easy to miss because they live outside
`src/` or are referenced by string path at runtime.

### Sounds — copy the entire `frontend/public/sounds/` tree
The reaction-emoji feature and turn/game sounds depend on these. There are **15
real files** (some paths referenced in `useSoundEffects.ts` point at files that do
**not** exist and fail silently — see note below). Copy all of:

```
public/sounds/card-play.mp3
public/sounds/card-play.wav
public/sounds/game-ready.mp3
public/sounds/your-turn.mp3
public/sounds/surrender.mp3
public/sounds/emoji/ez.mp3
public/sounds/emoji/gg.mp3
public/sounds/emoji/wan-bu-liao-la.mp3
public/sounds/emoji/xiao-er-ke.ogg
public/sounds/emoji/xiao-bie-san1.ogg
public/sounds/emoji/bu-yong-kan-le.ogg
public/sounds/emoji/zai-wo-zhe-li.ogg
public/sounds/emoji/wo-yao-yan-pai.ogg
public/sounds/emoji/pai-mei-you-wen-ti.ogg
public/sounds/emoji/gei-wo-cha-pixie.ogg
```

The 15 emoji **reaction texts** themselves (`🖕 🤏 🤌 我操 EZ GG 玩不了啦 小兒科 你會玩的嗎
小癟三 不用看了 窩妖驗牌 牌沒有問題 在我者離 給我搽皮鞋`) live in two places that must
stay in sync and be ported as-is:
- backend `ALLOWED_REACTIONS` set in `game.gateway.ts`
- frontend `EMOJI_SOUNDS` map in `hooks/useSoundEffects.ts`

> **Known gap (carried over from DDZ, harmless):** `useSoundEffects.ts` references
> `pass.mp3`, `deal.mp3`, `win.mp3`, `lose.mp3`, `landlord.mp3`, and emoji files
> `middle-finger.mp3`, `small.mp3`, `chef-kiss.mp3` that don't exist in the repo.
> The player catches the load/play error and skips silently, so missing files are
> not fatal. **For 五子棋, prune the sound map to what the game actually uses** —
> there's no dealing/landlord/pass in Gomoku. Keep: `gameStart` (game-ready),
> `yourTurn`, a stone-placement sound (reuse `card-play.wav` or add a new file),
> `win`/`lose` (add files if you want them, or drop), `surrenderPending` → rename
> conceptually to "resign pending" if you keep it. Keep the whole emoji set.

### Fonts & favicon — copy from `frontend/src/app/`
```
src/app/fonts/GeistVF.woff       (referenced by layout.tsx localFont src)
src/app/fonts/GeistMonoVF.woff   (referenced by layout.tsx localFont src)
src/app/favicon.ico
```
`layout.tsx` loads these via `next/font/local` with relative `./fonts/...` paths,
so they must sit at the same location. (Optionally swap in a 五子棋-themed favicon.)

### Avatars — NO files to copy
Avatars are **not static files.** They are user-uploaded images resized
client-side to a 256×256 JPEG **base64 data URL** by
[frontend/src/lib/avatar.ts](frontend/src/lib/avatar.ts) (center-crop, quality
step-down to stay under a 64 KB cap), then PATCHed to `/users/me` and stored
inline in the shared `users.avatar_url` TEXT column. Because `users` is **shared**,
**a user's avatar uploaded in DDZ already appears in 五子棋 and vice-versa** — no
migration, no copying, no Firebase Storage. Just port `lib/avatar.ts` and the
profile upload UI verbatim. The backend's 64 KB validator on `PATCH /users/me`
must be ported too so the two apps agree on the cap.

---

## 11. Repository layout

```
ddz/
├── SPEC.md                     ← DDZ spec (read first)
├── SPEC_WUZIQI.md              ← this file
├── backend/                    ← DDZ backend (unchanged)
├── frontend/                   ← DDZ frontend (unchanged)
├── wuziqi_backend/             ← NEW — NestJS, mirrors backend/ structure
│   └── src/
│       ├── auth/               (ported verbatim from backend/)
│       ├── db/
│       │   ├── schema.ts       (allowed_emails + users mirrored read-only;
│       │   │                    wuziqi_results + wuziqi_players new)
│       │   └── db.module.ts    (same DATABASE_URL — shared Postgres)
│       ├── game/
│       │   ├── types.ts        (Member, Room, Move; NO Card)
│       │   ├── board.utils.ts  (REPLACES card.utils.ts: emptyBoard, applyMove,
│       │   │                    checkWin, randomEmptyCell, isFull)
│       │   ├── room.manager.ts (ported; players capped at 2)
│       │   ├── game.service.ts (ported state machine; board rules)
│       │   ├── game.gateway.ts (ported; place_stone/resign instead of play_cards)
│       │   └── game.module.ts
│       ├── leaderboard/        (ported; wuziqi tables)
│       ├── users/              (ported; shared users table)
│       └── health/
└── wuziqi_frontend/            ← NEW — Next.js, mirrors frontend/ structure
    ├── public/
    │   └── sounds/             ← COPY all 15 files from frontend/public/sounds/ (incl. emoji/)
    └── src/
        ├── app/
        │   ├── fonts/          ← COPY GeistVF.woff + GeistMonoVF.woff from frontend/
        │   ├── favicon.ico     ← COPY (or replace with a 五子棋 icon)
        │   ├── page.tsx, login/, profile/, layout.tsx
        ├── lib/                (firebase, auth, api, socket [window.__wuziqi_socket], avatar, boardUtils)
        ├── hooks/              (useAuth, useSocket, useGame, useRoomList, useLeaderboard, useProfile, useSoundEffects)
        ├── components/         (Board, Stone, GameResult, LobbyRoomList, RoomLobby, VolumeControl, ...)
        └── types/game.ts
```

---

## 12. Environment variables

### wuziqi_backend (Railway, new service)
| Var | Value | Notes |
|---|---|---|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` | **Reference the SAME Postgres addon** shared with DDZ |
| `FIREBASE_ADMIN_KEY` | same service-account JSON as DDZ | Same Firebase project |
| `CORS_ORIGIN` | `https://<wuziqi-frontend>.vercel.app` | The new Vercel domain |
| `PORT` | unset | Railway sets it |

Root dir = `wuziqi_backend`. Build/start: `npm install && npm run build` /
`npm run start:prod`.

### wuziqi_frontend (Vercel, new project)
Same `NEXT_PUBLIC_FIREBASE_*` values as DDZ (shared project). New backend URLs:
- `NEXT_PUBLIC_API_URL=https://<wuziqi-backend>.up.railway.app`
- `NEXT_PUBLIC_WS_URL=https://<wuziqi-backend>.up.railway.app`

Root dir = `wuziqi_frontend`.

### Firebase Console (one-time)
- Add `<wuziqi-frontend>.vercel.app` to **Authentication → Authorized domains**.

---

## 13. Implementation order (suggested)

1. **Scaffold `wuziqi_backend`** by copying `backend/`, then strip DDZ game logic.
   Port auth/db/users/leaderboard modules; get `/health` + WS auth working.
2. **Board engine** — `board.utils.ts` with `checkWin` + unit tests (this is the
   only genuinely new logic; test it hard: horizontal/vertical/both diagonals,
   overline ≥5, edges, no false positives).
3. **Room + game.service** — port the state machine, swap bidding/cards for the
   two-player place-stone loop, random color assignment, 30s timer with
   random-move-on-timeout, win/draw/resign/disconnect handling.
4. **Gateway** — port handlers; `place_stone` validation, `resign`.
5. **Wire DB** — create the two tables (carefully — shared DB), `recordResult`,
   leaderboard + stats + history + game-detail endpoints.
6. **Scaffold `wuziqi_frontend`** by copying `frontend/`; port plumbing; build
   `Board`/`Stone`/`GameResult`; wire the `useGame` reducer.
7. **Multi-user smoke test** — two browsers play a full game; a third spectates
   live; test disconnect/reconnect grace; test timeout auto-move; test resign.
8. **Deploy** — new Railway service (same DB) + new Vercel project; add the
   Firebase authorized domain.

---

## 14. Things to be careful about (carried over from DDZ's hard-won lessons)

- **Don't touch socket creation/teardown logic** (`lib/socket.ts`,
  `hooks/useSocket.ts`) without strong reason — load-bearing fragility around
  React Strict Mode + Next.js HMR + Firebase token refresh. Comments explain the
  invariants. Test with multiple browser contexts before/after any change.
- **Auth stays in `server.use(middleware)`**, not `handleConnection` — prevents
  message handlers racing past auth.
- **Shared DB is the sharp edge.** Any `db:push` from the wuziqi backend must
  only create the `wuziqi_*` tables. Inspect the generated migration before
  applying. Never drop or alter DDZ's tables or the shared `users`/`allowed_emails`.
- **All game state is backend-authoritative.** The frontend renders events and
  sends intents. If you're tempted to compute a win on the client, don't — emit
  the intent and render the server's `move_made` / `game_over`.
- **Don't run destructive DB ops without asking** — leaderboard data has value.
```
