# Plan: 鬥地主 (Dou Di Zhu) Web Game Implementation

## TL;DR
Build a full-stack 3-player web card game. Frontend: Next.js 16 + TypeScript + Tailwind + Framer Motion. Backend: NestJS + Socket.IO + in-memory state. Card CSS already designed in `card-preview.html` — adapt to React components. No database, no deployment setup needed.

---

## Phase 1 — Project Scaffolding *(parallel: frontend + backend)*

1. **Frontend**: `npx create-next-app@16 frontend --typescript --tailwind --app --src-dir`; add deps: `socket.io-client framer-motion`
2. **Backend**: `npx @nestjs/cli new backend`; add deps: `@nestjs/websockets @nestjs/platform-socket.io socket.io`
3. Configure CORS in backend `main.ts` (`CORS_ORIGIN` env var, default `http://localhost:3000`)
4. Set `NEXT_PUBLIC_WS_URL` in `frontend/.env.local` pointing to `http://localhost:3001`

---

## Phase 2 — Shared Types *(backend first, then mirror to frontend)*

5. Create `backend/src/game/types.ts`: `Card`, `Room`, `Member`, `Play`, `HandType` enum (14 types), `RoomState` union
6. Mirror relevant client-facing types to `frontend/src/types/game.ts` (omit server-internal fields like `voteTimeout`, `deck`)

---

## Phase 3 — Backend: Card Engine *(parallel with Phase 2)*

7. `card.utils.ts`:
   - `createDeck()` → 54 cards, ranks 3–17
   - `shuffle(deck)` → Fisher-Yates
   - `identifyHandType(cards)` → `{ type: HandType, rank: number } | null` — covers all 14 types
   - `validatePlay(cards, lastPlay)` → `Play | null` — same type + higher rank, or bomb/rocket override
8. Unit-test `identifyHandType` against spec §4.5 edge cases (sequences ≥5, pair sequences ≥3, etc.)

---

## Phase 4 — Backend: Room Manager & Game Service *(depends on Phase 3)*

9. `room.manager.ts`:
   - `Map<string, Room>` singleton
   - `createRoom(nickname, socketId)` → generates 6-char alphanumeric code (collision-checked)
   - `joinRoom(code, nickname, socketId)` → appends numeric suffix on duplicate nickname
   - `removeSocket(socketId)` → handles spectator/player disconnect differently
   - 5-minute idle `setTimeout` cleanup
10. `game.service.ts` — state machine:
    - `waiting → voting`: fires when memberCount ≥ 3 (emit `vote_open`)
    - `voting`: tracks `voteQueue`, 60s timeout via `setTimeout`, emits `vote_update` on each vote
    - `voting → playing`: when `voteQueue.length ≥ 3` — assign roles, emit `vote_closed_start`, start 3s countdown
    - `playing / bidding`: shuffle + deal, random first bidder, bidding loop (pass counts, re-deal if all pass), emit `landlord_decided`
    - `playing / gameplay`: turn tracking, `validatePlay` on `play_cards`, consecutive pass tracking, `new_round` emit
    - Win detection → emit `game_over`, immediately re-open vote
    - Player disconnect: 60s reconnect window (`setTimeout`), then room reset → `vote_reset`

---

## Phase 5 — Backend: WebSocket Gateway & Health *(depends on Phase 4)*

11. `game.gateway.ts` — handle all 10 client→server events from spec §6.3:
    - `create_room`, `join_room`, `reconnect`
    - `vote_play`, `bid`, `play_cards`, `pass`
    - `react_emoji` (rate-limited: max 1/3s per socket via per-socket timestamp map)
    - `leave_room` (on `handleDisconnect`)
    - Rate limit: reject if >10 events/sec per socket (rolling counter)
12. `health.controller.ts`: `GET /health` → `{ status, rooms, uptime }`

---

## Phase 6 — Frontend: Foundation *(parallel with Phases 3–5)*

13. `lib/socket.ts` — Socket.IO client singleton; exports `getSocket()` lazily initialised with `NEXT_PUBLIC_WS_URL`
14. `hooks/useSocket.ts` — manages connect/disconnect lifecycle, exposes `socket` ref
15. `hooks/useGame.ts` — central game state reducer; subscribes to all server→client events (§6.3), exposes: `gameState`, `myHand`, `members`, `roomCode`, `phase`, `currentTurn`, etc.; actions: `createRoom`, `joinRoom`, `votePlay`, `bid`, `playCards`, `pass`, `reactEmoji`

---

## Phase 7 — Frontend: Landing Page (`/`)

16. `app/page.tsx` — nickname input (pre-fill from `localStorage['ddz_nickname']`), two actions:
    - 建立房間 button → `createRoom` → navigate to `/room/[code]`
    - 加入房間 section → room code input + 加入 button → `joinRoom` → navigate
    - Sanitise nickname client-side (strip HTML tags, max 10 chars)

---

## Phase 8 — Frontend: UI Components

17. `Card.tsx` — adapt CSS from `card-preview.html` to React props: `{ suit, rank, faceDown, selected, onClick }`; Tailwind for layout, inline colour for suit
18. `CardHand.tsx` — scrollable horizontal strip of `Card`; handles selection state (toggle on tap), confirms via 出牌/不出 buttons
19. `PlayerSeat.tsx` — circular avatar (coloured initial), nickname label, role badge (地主/農民), card-count badge, active-turn glow ring (Framer Motion `animate`)
20. `PlayArea.tsx` — center play area: last played cards + hand type label; landlord face-down 3-card strip revealed on landlord decision
21. `BiddingPanel.tsx` — overlay/inline panel; shows bid buttons (1分/2分/3分/不叫); disabled when not your turn
22. `RoomLobby.tsx` — room code display (click-to-copy), member avatar strip (fade-in/scale on join), "我要玩" voting prompt (appears when ≥3 members, live counter N/3), small-screen chip collapse
23. `GameResult.tsx` — winner announcement overlay; all-member vote prompt (same first-3 mechanic as lobby); 60s countdown; live avatar tick roster
24. `Countdown.tsx` — pulsing 3,2,1 animated number (Framer Motion)

---

## Phase 9 — Frontend: Game Room Page (`/room/[code]`)

25. `app/room/[code]/page.tsx` — orchestrates all components:
    - Reads `useGame` state to switch between: `RoomLobby` → `BiddingPanel` → `GameBoard` → `GameResult`
    - Reconnection: on mount, check `sessionStorage['reconnectToken']` + `sessionStorage['roomCode']`; if present emit `reconnect`
26. `GameBoard.tsx` — mobile-first single-column layout (spec §5.2 layout diagram); desktop: horizontal with sidebar; spectator vs player conditional rendering; emoji HUD buttons (🖕 🤏 🤌, rate-limited via client timestamp)

---

## Phase 10 — Animations (Framer Motion)

27. Card deal: staggered `AnimatePresence` from center deck position to each player
28. Card select: `whileTap={{ y: -14 }}` on Card component
29. Card play: `layoutId` on cards — shared layout animation from hand to play area
30. Turn glow: `animate={{ boxShadow }}` pulse loop on active `PlayerSeat`
31. Member join: `initial={{ opacity:0, scale:0.5 }}` → `animate={{ opacity:1, scale:1 }}` in lobby strip
32. Emoji reaction: `AnimatePresence` bubble — appears above avatar, floats upward, fades (~1.5s)
33. Countdown: scale + opacity pulse per number
34. Game result: confetti via CSS keyframes or Framer Motion stagger

---

## Key Files to Create

```
backend/
  src/
    main.ts
    app.module.ts
    game/
      types.ts
      card.utils.ts
      room.manager.ts
      game.service.ts
      game.gateway.ts
      game.module.ts
    health/
      health.controller.ts

frontend/
  src/
    types/
      game.ts
    lib/
      socket.ts
    hooks/
      useSocket.ts
      useGame.ts
    app/
      page.tsx
      room/[code]/
        page.tsx
    components/
      Card.tsx
      CardHand.tsx
      PlayerSeat.tsx
      PlayArea.tsx
      BiddingPanel.tsx
      GameBoard.tsx
      RoomLobby.tsx
      GameResult.tsx
      Countdown.tsx
```

---

## Verification Checklist

1. Run backend `npm run start:dev` and connect via browser DevTools WS inspector; emit `create_room` manually, confirm `room_created` response
2. Open three browser tabs: one creates a room, two join — confirm lobby vote UI appears at 3 members
3. Complete a full bidding round — confirm landlord card reveal and hand grows to 20
4. Play cards and verify `invalid_play` fires for illegal hands (e.g., mismatched type)
5. Empty a player's hand — confirm `game_over` event and winner announcement
6. Close a player tab mid-game — confirm 60s timer → room reset → `vote_reset`
7. Mobile viewport (375px): confirm card hand scrolls, all touch targets ≥44×44px
8. Emoji reaction spam: confirm only 1/3s passes the rate limit

---

## Decisions

- Card visuals: CSS-rendered (zero external dependencies) — already prototyped in `card-preview.html`
- State: pure in-memory `Map`, no database
- No deployment config (local dev only)
- All UI text: Traditional Chinese (繁體中文)
- Reconnection token stored in `sessionStorage` (tab-scoped, per spec §7.2)

---

## Phase 11 — Deployment *(Frontend → Vercel, Backend → Railway)*

### Files added
- `.gitignore` (root) — excludes `node_modules`, `dist`, `.next`, `.env*.local`
- `backend/railway.toml` — build: `npm run build`; start: `npm run start:prod`; healthcheck: `/health`
- `backend/.env.example` — documents `PORT` and `CORS_ORIGIN` env vars
- `frontend/vercel.json` — security headers (`X-Frame-Options`, `X-Content-Type-Options`, etc.)
- `"engines": { "node": ">=20" }` added to both `package.json` files

### Deploy order

1. **Push repo to GitHub** (root `.gitignore` is now in place)
2. **Deploy backend on Railway**
   - New project → connect repo → set Service Root to `backend/`
   - Railway picks up `railway.toml` automatically
   - Add env var: `CORS_ORIGIN=https://<your-vercel-url>.vercel.app` (fill in after step 3)
   - Note the deployed URL: `https://<your-app>.up.railway.app`
3. **Deploy frontend on Vercel**
   - New project → connect repo → set Root Directory to `frontend/`
   - Add env var: `NEXT_PUBLIC_WS_URL=https://<your-app>.up.railway.app`
   - Vercel auto-detects Next.js, no further config needed
   - Note the deployed URL: `https://<your-app>.vercel.app`
4. **Complete Railway CORS** — go back to Railway, set `CORS_ORIGIN` to the Vercel URL, then redeploy
5. **Smoke test** — open the Vercel URL in two tabs, create/join a room, confirm WebSocket connects

### Notes
- Railway injects `PORT` automatically; do not set it manually
- Socket.IO uses `transports: ['websocket']` only — no polling, no Vercel proxy needed
- All in-memory room state resets on every backend redeploy (no database, per design)
- Railway free tier may sleep after inactivity; upgrade to paid for always-on
- `NEXT_PUBLIC_WS_URL` must use `https://` (not `http://`) in production so Socket.IO can upgrade to `wss://`
