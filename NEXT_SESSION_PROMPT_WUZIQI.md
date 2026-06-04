# Prompt for next Claude Code session — build 五子棋 (Wuziqi)

Copy-paste the block below as your first message in the next session.

---

I'm building a new game in an existing monorepo at `c:\Programming\ddz` (Windows /
PowerShell). The repo already contains a working 鬥地主 (Dou Di Zhu) multiplayer
card game in `backend/` + `frontend/`. I want to add a **五子棋 (Wuziqi / Gomoku)**
game as sibling apps `wuziqi_backend/` and `wuziqi_frontend/`, deployed to a
**separate** Railway service and Vercel project, but **sharing the same Firebase
Auth project and the same Postgres database** (reusing the `users` and
`allowed_emails` tables, adding new `wuziqi_results` + `wuziqi_players` tables).

**Read these two specs in full before writing any code:**
1. [SPEC_WUZIQI.md](SPEC_WUZIQI.md) — the full spec for what to build. It is
   written as a *delta* against the DDZ spec: it only describes what differs.
2. [SPEC.md](SPEC.md) — the DDZ spec. Everything not overridden by SPEC_WUZIQI.md
   is identical to DDZ, so you must understand the DDZ architecture to port it.

The core design philosophy (from DDZ, kept here): **the backend owns all
authoritative game state in an in-memory `Room`; the frontend is a pure renderer
of server events and only sends intents.** Win detection, move legality, turn
advancement, and timeouts all happen on the backend, which broadcasts the new
state. Do not compute game outcomes on the client.

## Decisions already made (don't re-ask these)
- **DB:** share `users` + `allowed_emails` as-is; add `wuziqi_results` +
  `wuziqi_players`; same Postgres instance as DDZ. DDZ tables must not be touched.
- **Rooms:** mirror DDZ's room manager, but **2 players + unlimited spectators**.
  Vote-to-play starts the game at 2 voters. Spectators can join/watch mid-game.
- **Rules:** 15×15 board, free-style five-in-a-row (no Renju forbidden moves),
  Black moves first, **Black/White assigned randomly** to the 2 voters at start.
- **Turn timer:** 30s per move; **on timeout the backend auto-places a random
  valid empty cell** for the timed-out player, then advances the turn (state stays
  server-authoritative).
- **Reconnect:** port DDZ's 30s reconnect grace window verbatim.
- **Layout:** sibling folders `wuziqi_backend/` + `wuziqi_frontend/` in this repo.

## Where to start
Follow the implementation order in [SPEC_WUZIQI.md](SPEC_WUZIQI.md) §13:
1. Scaffold `wuziqi_backend` by copying `backend/`; strip DDZ card logic; port
   auth/db/users/leaderboard; get `/health` + WS auth working.
2. Write `board.utils.ts` (`emptyBoard`, `applyMove`, `checkWin`,
   `randomEmptyCell`, `isFull`) **with thorough unit tests for `checkWin`** —
   this is the only genuinely new logic. Test all 4 directions, overlines (≥5),
   board edges, and no false positives.
3. Port the room manager (cap players at 2) + game.service state machine (random
   color assignment, place-stone loop, 30s timer w/ random-move-on-timeout,
   win/draw/resign/disconnect).
4. Port the gateway (`place_stone`, `resign` replace `play_cards`/`pass`/`bid`/
   `surrender`).
5. Wire the DB: **carefully** create only the two new tables (the DB is shared —
   inspect any generated migration before applying; never drop DDZ tables),
   `recordResult`, leaderboard/stats/history/game-detail endpoints.
6. Scaffold `wuziqi_frontend` by copying `frontend/`; port the plumbing; build
   `Board` / `Stone` / `GameResult`; wire the `useGame` reducer to fold server
   events into render state. **Copy the static assets** (see the checklist below
   and SPEC_WUZIQI.md §10a) — they're easy to miss.
7. Multi-user smoke test (2 players + 1 spectator; test disconnect/reconnect,
   timeout auto-move, resign).

## Static assets checklist (don't forget these when scaffolding the frontend)
See SPEC_WUZIQI.md §10a for full detail. In short:
- **Copy the entire `frontend/public/sounds/` tree** (15 files incl. the
  `emoji/` subfolder) into `wuziqi_frontend/public/sounds/`. The reaction-emoji
  sounds and turn/game sounds depend on them.
- **Copy the fonts and favicon**: `frontend/src/app/fonts/GeistVF.woff` +
  `GeistMonoVF.woff` (referenced by `layout.tsx`) and `frontend/src/app/favicon.ico`.
- **Port the 15 emoji reaction texts** — they live in TWO synced places: the
  backend `ALLOWED_REACTIONS` set (`game.gateway.ts`) and the frontend
  `EMOJI_SOUNDS` map (`useSoundEffects.ts`). Port both.
- **Avatars need NO file copying** — they're user-uploaded base64 data URLs stored
  in the shared `users.avatar_url` column. Because `users` is shared, avatars
  uploaded in DDZ already show in 五子棋. Just port `lib/avatar.ts` + the profile
  upload UI + the backend's 64 KB validator on `PATCH /users/me`.
- Note: `useSoundEffects.ts` references some sound files that don't exist (they
  fail silently). For 五子棋, **prune the sound map** to what Gomoku actually uses
  (no deal/landlord/pass) — keep gameStart, yourTurn, a stone-placement sound,
  optional win/lose, and the full emoji set.

## Important context (saves time)
- **Don't touch the socket creation/teardown logic** in `lib/socket.ts` /
  `hooks/useSocket.ts` when porting — there's load-bearing fragility around React
  Strict Mode + Next.js HMR + Firebase token refresh. Port the files as-is; only
  rename the window key `__ddz_socket` → `__wuziqi_socket`. Test with multiple
  browser contexts.
- **Auth must stay in `server.use(middleware)`** (not `handleConnection`) so
  message handlers can't race past auth.
- The **shared database is the sharp edge.** The wuziqi backend's `db:push` must
  only create the `wuziqi_*` tables. Verify before applying. Never drop or alter
  `users`, `allowed_emails`, `game_results`, or `game_players`.
- Identity is `user.uid` (Firebase) everywhere. `Member.nickname`/`avatarUrl` are
  snapshotted at room join; live nickname/avatar updates flow through
  `GameService.refreshUserInRoom(uid, patch)` from `UsersService`. Note: a profile
  edit in wuziqi reflects in DDZ only on the DDZ user's next join (the two backends
  don't cross-notify) — that's expected, document it, don't try to fix it.
- Dev workflow: backend `npm run start:dev` in one terminal, frontend
  `npm run dev` in another. Multi-user testing uses Chrome + Incognito + Edge.
  Test accounts `krimson8@gmail.com`, `krimson8+1@gmail.com` (password `Pa$$w0rd`)
  are already in the shared allowlist, so they work for wuziqi too. Two accounts
  is enough for a 2-player game; use a third for spectator testing.
- **Don't run destructive DB operations without asking first.**
- The user prefers terse responses, asks clarifying questions when genuinely
  uncertain (and likes the `AskUserQuestion` tool for design forks), and wants you
  to actually understand the code before changing it (no delegating the reasoning
  to subagents). Plan briefly, write it, type-check + smoke test, then ask the
  user to verify in the running app.

Confirm you've read both specs and outline your plan for step 1 before scaffolding.
```
