# Plan: Auth + Global Leaderboard Implementation

## Key Insight on the Leaderboard
The existing `winCounts` scoreboard in `RoomLobby` (本局戰績) tracks wins **per room session** by nickname. For a global persistent leaderboard, we replace this with DB-backed win counts keyed by `uid` instead of nickname, and display the same UI but fed from the API. The `GameResult` overlay stays as-is (post-game summary), and we repurpose the lobby scoreboard to show global rankings instead of session-local ones.

---

## Phase A — Database Setup

**A1. Add Railway PostgreSQL to the project**
- Provision Railway PG addon (same Railway project as backend)
- Add `DATABASE_URL` env var to Railway backend service

**A2. Create schema + migrations**
- Use Drizzle ORM (`drizzle-orm`, `drizzle-kit`, `postgres` driver)
- Three tables: `users`, `game_results`, `game_players`
- Add `drizzle.config.ts` + `npm run db:push` script to backend `package.json`

```sql
CREATE TABLE users (
  uid        TEXT PRIMARY KEY,       -- Firebase UID
  email      TEXT UNIQUE NOT NULL,
  nickname   TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE game_results (
  id           SERIAL PRIMARY KEY,
  room_code    TEXT NOT NULL,
  played_at    TIMESTAMPTZ DEFAULT now(),
  winner_role  TEXT NOT NULL          -- 'landlord' or 'farmer'
);

CREATE TABLE game_players (
  game_id   INT REFERENCES game_results(id),
  uid       TEXT REFERENCES users(uid),
  role      TEXT NOT NULL,            -- 'landlord' or 'farmer'
  won       BOOLEAN NOT NULL,
  PRIMARY KEY (game_id, uid)
);
```

Leaderboard query:
```sql
SELECT u.nickname, COUNT(*) FILTER (WHERE gp.won) AS wins, COUNT(*) AS games
FROM game_players gp JOIN users u USING (uid)
GROUP BY u.uid ORDER BY wins DESC LIMIT 20;
```

**A3. `db/` module in NestJS**
- `db.module.ts` — global module exporting a Drizzle client
- `db/schema.ts` — table definitions

---

## Phase B — Firebase Auth

**B1. Backend: `firebase-admin` setup**
- Add `firebase-admin` dep
- `auth/auth.service.ts` — `verifyToken(idToken)` → `{ uid, email }`; also `upsertUser(uid, email, nickname)` writing to `users` table
- `auth/ws-auth.guard.ts` — NestJS `CanActivate` for WebSocket; reads `client.handshake.auth.token`, calls `verifyToken`, attaches `uid` to socket `data`
- `auth/auth.module.ts`

**B2. Replace `reconnectToken` with `uid`**
- `types.ts`: `Member.reconnectToken → Member.uid`
- `room.manager.ts`: `createRoom` / `joinRoom` accept `uid` instead of generating UUID; `removeSocket` / reconnect logic uses `uid`
- `game.gateway.ts`: apply `WsAuthGuard`, pass `client.data.uid` into room manager calls; remove `reconnect` event token logic (uid is the token now)

**B3. Frontend: Firebase SDK**
- Add `firebase` dep
- `lib/firebase.ts` — initialize app + auth
- `lib/auth.ts` — `sendMagicLink(email)`, `completeMagicLink()` → returns `idToken`
- `lib/socket.ts` — update `getSocket()` to accept `idToken` in `auth` handshake option
- `app/page.tsx` — replace nickname-only landing with: email input → magic link sent screen → on redirect, complete sign-in → then show nickname input (for display name) → create/join room

**B4. Update `useGame.ts`**
- Store `myUid` in state (from Firebase `currentUser.uid`)
- Pass `idToken` (refreshed via `user.getIdToken()`) into socket init
- Remove `sessionStorage['reconnectToken']` reconnect logic — reconnect is just re-connecting with the same Firebase user

---

## Phase C — Leaderboard API

**C1. `leaderboard/` NestJS module**
- `leaderboard.service.ts`:
  - `recordResult(roomCode, players: { uid, role, won }[])` — inserts `game_results` + `game_players` rows; called from `game.service.ts` on `game_over`
  - `getGlobalLeaderboard(limit = 20)` — returns `[{ nickname, wins, games, winRate }]` sorted by wins
- `leaderboard.controller.ts` — `GET /leaderboard` (public, no auth required)

**C2. Hook up in `game.service.ts`**
- On win detection (~line 816), after updating `room.winCounts`, fire-and-forget `leaderboardService.recordResult(...)`
- Keep `room.winCounts` for the in-session post-game `GameResult` overlay (still useful for "wins this session")
- Remove `winCounts` from the lobby scoreboard payload — lobby fetches from `/leaderboard` instead

---

## Phase D — Frontend Leaderboard

**D1. `hooks/useLeaderboard.ts`**
- Simple `useEffect` that fetches `GET /leaderboard` on mount and after each `game_over` event
- Returns `{ entries: LeaderboardEntry[], loading, refresh }`

**D2. Update `RoomLobby.tsx`**
- Replace `winCounts` prop with `leaderboard` data from `useLeaderboard`
- Change section label from 本局戰績 → 全球排行榜
- Show `wins / games` instead of just wins
- Keep the same visual style (no redesign needed)

**D3. `GameResult.tsx` — no change needed**
- Already shows per-game winner/loser — correct and complete as-is

---

## What Stays the Same
- All card game logic (`card.utils.ts`, `game.service.ts` state machine)
- All game UI components except `RoomLobby` scoreboard section
- WebSocket event protocol (no new events needed)
- Deployment targets (Vercel + Railway)

---

## File Change Summary

| File | Change type |
|---|---|
| `backend/src/game/types.ts` | `reconnectToken → uid` |
| `backend/src/game/room.manager.ts` | uid-based session |
| `backend/src/game/game.gateway.ts` | add WsAuthGuard, pass uid |
| `backend/src/game/game.service.ts` | call leaderboard on game_over |
| `backend/src/auth/auth.service.ts` | new |
| `backend/src/auth/auth.module.ts` | new |
| `backend/src/auth/ws-auth.guard.ts` | new |
| `backend/src/db/schema.ts` | new |
| `backend/src/db/db.module.ts` | new |
| `backend/src/leaderboard/leaderboard.service.ts` | new |
| `backend/src/leaderboard/leaderboard.controller.ts` | new |
| `backend/src/leaderboard/leaderboard.module.ts` | new |
| `frontend/src/lib/firebase.ts` | new |
| `frontend/src/lib/auth.ts` | new |
| `frontend/src/lib/socket.ts` | add idToken to handshake |
| `frontend/src/app/page.tsx` | magic link login flow |
| `frontend/src/hooks/useGame.ts` | add uid, remove reconnectToken |
| `frontend/src/hooks/useLeaderboard.ts` | new |
| `frontend/src/components/RoomLobby.tsx` | global leaderboard data |

---

## Implementation Order

1. **Phase A** (DB schema) and **Phase B3/B4** (Firebase frontend) — in parallel, no dependencies on each other
2. **Phase B1/B2** (Firebase backend + reconnectToken → uid swap)
3. **Phase C** (leaderboard API) — depends on A + B1
4. **Phase D** (frontend leaderboard UI) — depends on C
