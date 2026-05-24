# Plan: Auth + Lobby + Profile + History

## Overview of the new mechanism

The app shifts from a code-only flow (input nickname → input room code → enter lobby) to an account-based flow:

```
[ login page (email magic link) ]
            ↓
[ lobby page: list of active rooms + "create room" button ]
            ↓
[ room lobby (vote to play) ]  ──or──  [ join in-progress game as spectator ]
            ↓
[ game board ]
```

After login, every page load lands the user on the lobby. Identity is keyed by **Firebase UID** throughout backend and DB. Client-side persistence is reduced to Firebase's own auth session (managed automatically in IndexedDB) — no more `reconnectToken` or `roomCode` in localStorage.

---

## How Firebase handles auth (reference)

- **Storage**: Firebase persists the session in IndexedDB (default `LOCAL` persistence) — survives reload, browser restart, etc.
- **ID token**: 1-hour JWT, auto-refreshed in background via refresh token. Call `user.getIdToken()` to get the current one (handles refresh transparently).
- **Page-load flow**: `onAuthStateChanged` fires once with the restored user (or `null`). Wait for this before deciding "login screen" vs "lobby".
- **Magic link cross-device**: links must be opened in the same browser that sent them; if opened elsewhere, Firebase prompts the user to re-enter their email to complete sign-in. Recommend a "open this link on the same device" notice; the re-prompt is the safety net.

---

## Phase 1 — Auth, Lobby, Room Mechanism Rewrite, Leaderboard

This phase is one logically atomic ship: you can't half-migrate `reconnectToken → uid`.

### 1A. Database setup (Railway Postgres)

**Schema:**
```sql
-- Allowlist: only seeded emails can sign in. Manage via SQL or a small admin script.
CREATE TABLE allowed_emails (
  email     TEXT PRIMARY KEY,
  added_at  TIMESTAMPTZ DEFAULT now(),
  note      TEXT                          -- e.g. "Alice from work"
);

CREATE TABLE users (
  uid         TEXT PRIMARY KEY,           -- Firebase UID
  email       TEXT UNIQUE NOT NULL,
  nickname    TEXT NOT NULL,
  avatar_url  TEXT,                       -- nullable, Firebase Storage URL (Phase 3)
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE game_results (
  id           SERIAL PRIMARY KEY,
  played_at    TIMESTAMPTZ DEFAULT now(),
  winner_role  TEXT NOT NULL,             -- 'landlord' or 'farmer'
  plays        JSONB NOT NULL DEFAULT '[]' -- Phase 4: full hand history; trimmed beyond 200 newest
);

CREATE TABLE game_players (
  game_id   INT  REFERENCES game_results(id) ON DELETE CASCADE,
  uid       TEXT REFERENCES users(uid),
  role      TEXT NOT NULL,                -- 'landlord' or 'farmer'
  won       BOOLEAN NOT NULL,
  seat      INT NOT NULL,                 -- 0/1/2 — needed to map plays.seat back to uid
  PRIMARY KEY (game_id, uid)
);

CREATE INDEX idx_game_players_uid ON game_players(uid);
CREATE INDEX idx_game_results_id_desc ON game_results(id DESC); -- for keyset pagination
```

**Seeding allowed emails (one-time per friend):**
```sql
INSERT INTO allowed_emails (email, note) VALUES ('friend@example.com', 'note here');
```
Or wrap in a `backend/scripts/add-friend.ts` script that takes args.

**ORM**: Drizzle (`drizzle-orm`, `drizzle-kit`, `postgres` driver).
**Files**: `backend/src/db/schema.ts`, `backend/src/db/db.module.ts` (global module exporting client), `drizzle.config.ts`, `npm run db:push` script.

**Leaderboard query** (used by Phase 1D + later by profile):
```sql
SELECT u.uid, u.nickname, u.avatar_url,
  COUNT(*)                                     AS games,
  COUNT(*) FILTER (WHERE gp.won)               AS total_wins,
  COUNT(*) FILTER (WHERE gp.won AND gp.role='landlord') AS landlord_wins,
  COUNT(*) FILTER (WHERE gp.won AND gp.role='farmer')   AS farmer_wins
FROM game_players gp
JOIN users u USING (uid)
GROUP BY u.uid
ORDER BY total_wins DESC
LIMIT 50;
```

### 1B. Firebase auth

**Backend:**
- Add `firebase-admin` dep
- `auth/auth.service.ts`:
  - `verifyToken(idToken) → { uid, email }`
  - `assertAllowed(email)` — `SELECT 1 FROM allowed_emails WHERE email = $1`; throw `UnauthorizedException` if missing
  - `upsertUser(uid, email)` — runs after `assertAllowed`; on first login inserts row with `nickname = email.split('@')[0]`; on subsequent logins no-op
- `auth/ws-auth.guard.ts`: NestJS `CanActivate`, reads `client.handshake.auth.token`, calls `verifyToken` → `assertAllowed` → `upsertUser`, attaches `uid` to `socket.data.uid`. Reject if missing/invalid/not-allowed.
- Apply guard at `GameGateway` class level (covers every `@SubscribeMessage`)
- REST endpoints use an equivalent HTTP guard (`AuthGuard`) reading `Authorization: Bearer <idToken>`

**Frontend:**
- Add `firebase` dep
- `lib/firebase.ts`: initialize app + auth
- `lib/auth.ts`: `sendMagicLink(email)`, `completeMagicLink()` (called on `/auth/complete` route after redirect), `getCurrentIdToken()`
- `lib/socket.ts`: pass `idToken` into `auth` handshake option; refresh token before reconnect (Firebase `getIdToken()` handles caching)
- `app/login/page.tsx`: email input → "magic link sent" screen
- `app/auth/complete/page.tsx`: extract link from URL, complete sign-in, redirect to `/`
- `app/page.tsx`: gated by `onAuthStateChanged` — if no user → redirect `/login`; if user → render lobby

### 1C. Room mechanism rewrite

**Goals:**
1. Replace `reconnectToken` with `uid` everywhere
2. Remove all localStorage room state from client
3. Backend tracks "active player uids per room" — reconnect = uid recognition
4. **No reconnect grace window** — on disconnect, splice member immediately
5. **Empty room → killed immediately** (no idle timeout)
6. **One room per uid** — can't create a new room while already in one

**Backend changes:**

`types.ts`:
```ts
interface Member {
  socketId: string;       // current socket
  uid: string;            // stable Firebase UID — identity key
  nickname: string;
  avatarUrl: string | null;
  role: 'spectator' | 'player';
  hand: Card[];
  wantToPlay: boolean;
}

interface Room {
  // ...existing...
  playerUids: string[];     // replaces playerIds (was socket IDs)
  // remove: reconnectTimers, idleTimeout
}
```

`room.manager.ts`:
- `createRoom(uid, nickname, avatarUrl, socketId)` — rejects if uid already in another room (one-room-per-uid rule)
- `joinRoom(code, uid, nickname, avatarUrl, socketId)` — rejects if uid already in another room
- `removeSocket(socketId)` — splice immediately. If room becomes empty → `deleteRoom(code)` inline. If spliced member was an active player → caller (`game.service`) aborts round.
- `findByUid(uid)` — returns the room a uid is currently in (for the one-room-per-uid check and "↩ rejoin" tag)
- Remove: nickname dedup, UUID generation, idle timeout, reconnect grace timers

`game.gateway.ts`:
- `WsAuthGuard` at class level → every handler has `socket.data.uid`
- Remove `rejoin` event entirely
- `create_room`: if `findByUid(uid)` returns a room → error "already in a room"
- `join_room`: if `findByUid(uid)` returns a different room → error; if same room (browser refresh edge case) → no-op + resend state
- New events: `list_rooms` (request), `rooms_updated` (broadcast). Sockets without a game room are implicitly subscribed to lobby broadcasts.
- Disconnect → `removeSocket`, broadcast room update + lobby update

`game.service.ts`:
- `winCounts` keyed by uid (kept for in-session display)
- On `game_over`: fire-and-forget `leaderboardService.recordResult(...)`; error must be logged, not silent
- Broadcast `rooms_updated` on every room state transition (created, joined, left, state changed, members changed)

**Frontend changes:**

Remove:
- All `localStorage.*reconnectToken*` code
- All `localStorage.ddz_nickname` code (nickname comes from Firebase user profile)
- `useGame.ts` reconnect-token logic
- `rejoin` socket emit

Add:
- `app/page.tsx` (lobby) renders **room list** from backend + "Create room" button
- `hooks/useRoomList.ts` — subscribes to `rooms_updated` broadcasts when on lobby
- On `join_room` success → render room lobby (vote phase) or game board (if game in progress, spectator path already works)

**Reconnect UX:**
- Page reload → socket disconnects → backend splices the member; if they were the room's last connection, room is killed immediately. If other players remain and you were a landlord/farmer mid-round, the round aborts (existing logic).
- After Firebase resolves user → frontend lands on lobby → sees fresh room list → user creates or joins a new room.
- Implication: **a browser refresh during a live game forfeits the round.** Acceptable per your "no waiting" requirement. (If this proves too harsh in playtesting, we can reintroduce a short grace window — but design as no-grace first.)

### 1C-bis. Lobby room list payload

Each room card in the lobby shows:
```ts
{
  code: string,
  state: 'waiting' | 'bidding' | 'playing',
  members: [
    { uid, nickname, avatarUrl, role: 'player'|'spectator', isCurrentTurn: boolean }
  ],
  spectatorCount: number,           // for compact display when game is running
  createdAt: number,                // for sort: newest first, or active-first
  myMembership: 'none' | 'spectator' | 'player'  // server fills per-request based on socket uid
}
```

**Visual rules:**
- `state === 'waiting'`: show all member avatars in a horizontal strip
- `state === 'bidding' | 'playing'`: show only the 3 player avatars prominently with role badges (地主 / 農民); highlight `isCurrentTurn`; show "+N watching" for spectators
- If `myMembership !== 'none'`: card shows "↩ 重新加入" button instead of "加入"
- If user is already in *any* room: the "建立房間" button is disabled with tooltip "你已在房間中"

Backend broadcasts a full lobby payload on every room mutation (create / member change / state change / delete). Cheap because rooms are in-memory.

### 1D. Leaderboard API

**`leaderboard/leaderboard.service.ts`:**
- `recordResult(players: { uid, role, won, seat }[], plays: HistoryEntry[])` — inserts `game_results` + `game_players` in a transaction
- `getGlobalLeaderboard(limit=50)` — runs the query above; returns `{ uid, nickname, avatarUrl, games, totalWins, landlordWins, farmerWins, winRate }[]`

**`leaderboard.controller.ts`:**
- `GET /leaderboard` — public, no auth

**`RoomLobby.tsx`:**
- Replace `winCounts` prop with global leaderboard from `useLeaderboard` hook
- Section label: 本局戰績 → 全球排行榜
- Show columns: 排名 / 玩家 / 總勝 / 地主勝 / 農民勝 / 場次
- `GameResult.tsx` overlay stays as-is (uses in-session `winCounts`)

---

## Phase 2 — Profile page

**Route:** `/profile`

**Backend:**
- `users/users.controller.ts`:
  - `GET /users/me` — returns own user record + aggregated stats (reuse leaderboard query, single-uid)
  - `PATCH /users/me` — updates nickname (validate 2–20 chars, sanitize)
- `users/users.service.ts`

**Frontend:**
- `app/profile/page.tsx`:
  - Header: avatar (placeholder until Phase 3) + editable nickname
  - Stats card: total wins / landlord wins / farmer wins / games / win rate
- Add nav link from lobby header → profile

**Effort: ~3-4h**

---

## Phase 3 — Avatar upload

**Storage:** Firebase Storage (already have Firebase set up; free 5GB tier; CDN-backed).

**Backend:**
- `PATCH /users/me` accepts `avatarUrl` field
- Validate URL is from your Firebase Storage bucket (prevent users pointing to arbitrary URLs)

**Frontend:**
- Profile page: avatar click → file picker
- Client-side: resize to 256×256, upload to Firebase Storage path `avatars/{uid}.jpg` via Firebase Storage SDK
- On success → `PATCH /users/me { avatarUrl: downloadURL }`
- Show avatar in: profile, leaderboard rows, room member list, game board player tiles

**Effort: ~4-5h** (most work is responsive resize + image preview)

---

## Phase 4 — Played-hand history

**Backend:**
- On `game_over` in `game.service.ts`: pass `room.playHistory` to `leaderboardService.recordResult()` → stored as JSONB in `game_results.plays`
  - Shape: `[{ seat: 0|1|2, cards: [{suit, rank}, ...] }, ...]` (seat instead of playerIndex so it's stable across the per-game `game_players.seat` mapping)
- **Global cap (200 games of full replay)**: in the same transaction as `recordResult`, run:
  ```sql
  UPDATE game_results
  SET plays = '[]'::jsonb
  WHERE plays != '[]'::jsonb
    AND id <= (SELECT id FROM game_results WHERE plays != '[]'::jsonb ORDER BY id DESC OFFSET 200 LIMIT 1);
  ```
  Effect: leaderboard stats (in `game_players`) and game metadata are preserved forever — only the heavy `plays` JSONB is trimmed beyond the newest 200. Older games show in history list as "replay unavailable".
- `games/games.controller.ts`:
  - `GET /users/me/games?limit=20&before=<gameId>` — keyset pagination on `game_results.id DESC`, filtered by `game_players.uid = me`. Returns:
    ```ts
    {
      games: [{ gameId, playedAt, winnerRole, hasReplay: boolean,
                players: [{ uid, nickname, avatarUrl, role, seat, won }] }],
      nextCursor: number | null  // gameId to pass as `before` next page
    }
    ```
  - `GET /games/:id` — full game including `plays` array; 404 / `hasReplay: false` if trimmed

**Frontend:**
- Profile page: paginated list of own games below stats
  - First page: 20 games. "Load more" button (or infinite scroll) fetches next page via `before=<lastSeenGameId>`. Continues until `nextCursor === null`.
  - Each row: `[landlord avatar+nickname] vs [farmer1] [farmer2] — winner: [role badge]`. Trimmed-replay rows are visually muted (greyed out, no click affordance).
  - Click → open overlay (only if `hasReplay`)
- `components/GameReplay.tsx` overlay:
  - Vertically scrollable list of plays
  - Each row: `[avatar + role badge] [played cards horizontally]`
  - Max visible cards per row defined by screen width (e.g. 6 on mobile, 12 on desktop); overflow → horizontal scroll within the row
  - Reuse existing `Card` component from game board

**Effort estimate: 7-10h total**
- Backend persist `playHistory` + endpoints + global trim logic: 2.5h
- Frontend paginated history list: 2.5h
- Frontend hand-replay overlay (responsive card layout is the bulk): 2.5h
- Polish, testing, edge cases (trimmed-replay state, empty state): 1.5h

---

## What stays the same

- All card game logic (`card.utils.ts`, `game.service.ts` state machine)
- All in-game UI components except `RoomLobby` scoreboard section
- WebSocket event protocol mostly unchanged (add `list_rooms` + `rooms_updated`; remove `rejoin`)
- Deployment targets (Vercel + Railway)
- The vote-to-play / spectator / mid-game-join mechanic (already implemented and propagating correctly)

---

## Implementation order

1. **Phase 1A** (DB schema + Drizzle wiring) — blocks everything
2. **Phase 1B** (Firebase auth, both ends) — independent of 1C, can run in parallel
3. **Phase 1C** (room mechanism rewrite) — depends on 1B (needs `uid` on socket)
4. **Phase 1D** (leaderboard API + RoomLobby UI swap) — depends on 1A + 1C
5. **Ship Phase 1** — end-to-end test before moving on
6. **Phase 2** (profile page) — independent, ship when ready
7. **Phase 3** (avatar upload) — depends on Phase 2 UI scaffold
8. **Phase 4** (hand history) — depends on Phase 1A schema; UI depends on Phase 2

---

## File change summary (Phase 1 only — other phases listed in their sections)

| File | Change type |
|---|---|
| `backend/src/db/schema.ts` | new |
| `backend/src/db/db.module.ts` | new |
| `backend/drizzle.config.ts` | new |
| `backend/src/auth/auth.service.ts` | new |
| `backend/src/auth/auth.module.ts` | new |
| `backend/src/auth/ws-auth.guard.ts` | new |
| `backend/src/leaderboard/leaderboard.service.ts` | new |
| `backend/src/leaderboard/leaderboard.controller.ts` | new |
| `backend/src/leaderboard/leaderboard.module.ts` | new |
| `backend/src/game/types.ts` | `reconnectToken → uid`, add `avatarUrl`, `playerIds → playerUids` |
| `backend/src/game/room.manager.ts` | uid-keyed members, drop UUID + nickname dedup, `findByUid` |
| `backend/src/game/game.gateway.ts` | apply `WsAuthGuard`, drop `rejoin`, add `list_rooms`/`rooms_updated` |
| `backend/src/game/game.service.ts` | uid-keyed `winCounts`, `playerUids`, fire `recordResult` on `game_over`, lobby broadcasts |
| `frontend/src/lib/firebase.ts` | new |
| `frontend/src/lib/auth.ts` | new |
| `frontend/src/lib/socket.ts` | add `idToken` to handshake |
| `frontend/src/app/login/page.tsx` | new |
| `frontend/src/app/auth/complete/page.tsx` | new |
| `frontend/src/app/page.tsx` | gated by auth; renders lobby (room list + create) |
| `frontend/src/hooks/useGame.ts` | drop reconnectToken/localStorage; uid from Firebase |
| `frontend/src/hooks/useRoomList.ts` | new — subscribes to `rooms_updated` |
| `frontend/src/hooks/useLeaderboard.ts` | new |
| `frontend/src/components/RoomLobby.tsx` | global leaderboard data, new columns |
| `frontend/src/components/LobbyRoomList.tsx` | new — list view + create button |

---

## Decisions (locked in)

1. **Access: restricted via `allowed_emails` allowlist table.** Manage via SQL `INSERT` or a small `backend/scripts/add-friend.ts` helper. Backend rejects auth for any email not in the table.
2. **Default nickname**: email local-part on first signup, editable in profile (Phase 2).
3. **Room visibility**: all rooms public to any authenticated user.
4. **One room per uid**: cannot create or join a second room while already in one. Empty rooms are killed immediately on last disconnect (no idle timer). No reconnect grace window — refresh = leave.
5. **Avatar storage**: Firebase Storage (Phase 3).
6. **Hand history**: JSONB on `game_results.plays`. Paginated `/users/me/games`. Global cap: only the newest 200 games retain `plays`; older rows are kept (for stats) but their `plays` field is wiped to `[]`.
