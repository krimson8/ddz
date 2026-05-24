# Prompt for next Claude Code session

Copy-paste the block below as your first message in the next session.

---

I'm continuing work on a 鬥地主 (Dou Di Zhu) multiplayer card game. The project lives at `c:\Programming\ddz` and is a Windows/PowerShell environment.

**Start by reading [SPEC.md](SPEC.md) in full** — it documents the current architecture, DB schema, auth flow, WebSocket protocol, REST endpoints, file layout, env vars, and what's done vs not done. Also check [plan.md](plan.md) for the original 4-phase plan if helpful.

## Where we left off

Phases 1A → 2 are complete and working end-to-end:
- DB on Railway Postgres (Drizzle ORM, 4 tables)
- Firebase Auth (email + password, auto-create account on first sign-in, invite-only via `allowed_emails`)
- uid-based room mechanism (no reconnect grace, empty rooms killed immediately, one-room-per-uid)
- Lobby room list with avatars + phase badges + "↩ 重新加入"
- Leaderboard recorded on `game_over`, displayed in the in-room lobby with 總勝/地主勝/農民勝/場次 columns
- `/profile` page with click-to-edit nickname + stats, with instant propagation of nickname changes to live rooms

The user is about to deploy this to Vercel (frontend) and Railway (backend) — env vars are documented in SPEC.md §12. Confirm with them whether they've deployed and whether everything works in prod before starting new work.

## What's likely next

Pick up from SPEC.md §14 "Things NOT done yet":

1. **Phase 3 — Avatar upload** (Firebase Storage; client-side resize → upload → PATCH `/users/me`)
2. **Phase 4 — Played-hand history** (persist `room.playHistory` to JSONB on game_over, paginated `/users/me/games`, replay overlay on profile)
3. **Multi-origin CORS** in `backend/src/main.ts` (currently single-origin; needed to keep `localhost:3000` working alongside the deployed Vercel URL)
4. **Delete `/auth-test` debug page** (kept around for sanity checks; safe to remove)
5. **Optional polish**: compact top-3 leaderboard preview in the global lobby header

Ask the user which to do next before diving in — they may have new ideas after using the deployed version.

## Important context that's saved time before

- **Don't touch the socket creation/teardown logic in `frontend/src/lib/socket.ts` or `frontend/src/hooks/useSocket.ts` without a strong reason** — there's load-bearing fragility around React Strict Mode + Next.js HMR + Firebase token refresh that caused multiple bugs (players dropped from rooms mid-game-start). Comments in those files explain the invariants. If touching, test with 3 browsers signed in to different accounts and start a game.
- Backend auth happens in `server.use(middleware)` not in `handleConnection` — this prevents message handlers from racing past auth. Don't move it.
- Frontend uses `user.uid` (Firebase) as the identity. Backend `Member.nickname`/`avatarUrl` are snapshotted at room join; live updates flow through `GameService.refreshUserInRoom(uid, patch)` which is called from `UsersService.updateNickname` after a profile edit. Avatar upload (Phase 3) should call the same hook with `{ avatarUrl: newUrl }` so live rooms see it instantly.
- The dev workflow is: backend `npm run start:dev` in one terminal, frontend `npm run dev` in another. Multi-user testing uses normal Chrome + Incognito + Edge (3 different browser contexts). Test accounts `krimson8@gmail.com`, `krimson8+1@gmail.com`, `krimson8+2@gmail.com` all use password `Pa$$w0rd`. If an account is in a weird state, `npm run db:reset-user -- email@example.com` wipes it from both Firebase and Postgres so it re-creates clean.
- Don't run destructive DB operations (drop tables, mass deletes) without asking first — the leaderboard data accumulates value.
- The user prefers terse responses, asks questions when uncertain, and likes the `AskUserQuestion` tool for design choices. They want you to actually understand the code before suggesting changes (not delegating reasoning to subagents).

When the user asks for a new feature, follow the same pattern that worked: read what exists, plan it briefly (with a clarifying `AskUserQuestion` if needed), write it, type-check + smoke test, ask them to verify in the running app.
