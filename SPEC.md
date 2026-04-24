# 鬥地主 (Dou Di Zhu) — Web Game Specification

## 1. Overview

A web-based multiplayer 鬥地主 (Fight the Landlord) card game for 3 players. Players create or join rooms via a room code — no registration required. The game follows standard Dou Di Zhu rules.

**Language**: All UI text, labels, buttons, and messages must be mainly in **Traditional Chinese (繁體中文)**.

---

## 2. Architecture

```
┌─────────────────┐         WebSocket (Socket.IO)         ┌─────────────────────┐
│   Frontend       │ ◄──────────────────────────────────► │   Backend            │
│   Next.js (React)│                                      │   NestJS + Socket.IO │
│   Vercel (Free)  │                                      │   Railway/Render     │
│                  │                                      │   In-memory Map      │
└─────────────────┘                                      └─────────────────────┘
```

### 2.1 Frontend

| Item | Choice |
|------|--------|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript |
| Styling | Tailwind CSS |
| WebSocket | socket.io-client |
| Animation | Framer Motion |
| Hosting | Vercel (Free Tier) |

### 2.2 Backend

| Item | Choice |
|------|--------|
| Framework | NestJS |
| Language | TypeScript |
| WebSocket | @nestjs/websockets + socket.io |
| State | Plain in-memory `Map<string, Room>` (no database) |
| Hosting | Railway or Render (Free Tier) |

### 2.3 Data Storage Philosophy

- **No database**: All game state lives in a plain in-memory `Map<string, Room>` on the server. Zero external dependencies.
- Rooms are garbage-collected via `setTimeout` when all members leave (5-minute idle timeout).

---

## 3. User Flow

### 3.1 Landing Page

1. User enters a **nickname** (2–10 characters).
   - The nickname is **persisted in `localStorage`** under the key `ddz_nickname` so it is pre-filled on the next visit.
2. Two actions available on the **same screen**:
   - **建立房間 (Create Room)** — nickname input shown; clicking creates a room and navigates to the lobby.
   - **加入房間 (Join Room)** — nickname input + 6-character room code input shown side by side; clicking joins the room.

### 3.2 Waiting Lobby

- **Everyone who joins a room (including the creator) starts as a spectator.**
- The room has no dedicated "player" seats until a vote has concluded.
- Displays the room code prominently (copyable) — share to invite more people.
- Shows the spectator list (all current members).
- Once **≥3 people** are in the room, a **"準備開始" (Ready to Start)** voting prompt appears for everyone.
  - Any member can click "我要玩 (I’m In)"; the first 3 to do so become the players for the upcoming game.
  - New arrivals can still vote **as long as fewer than 3 have confirmed**.
- Once 3 players are confirmed, the game starts after a 3-second countdown.

### 3.3 Game Screen

- **Players**: see their own hand at the bottom, two opponents above, play/pass controls.
- **Spectators**: see all three players' card counts and the play area, but no hand of their own. Spectators see a read-only view with the play area and a spectator list panel.
- Center area for played cards.
- Cards are dealt and shown to each player **first**; after a ~2-second pause the bidding UI appears so players can review their hand before deciding.

### 3.4 Game End

- Shows winner announcement (地主勝 / 農民勝).
- **All** people in the room (3 players + all spectators) are shown the same prompt: **"我要玩 (I’m In)"** / **"離開 (Leave)"**.
- The **first 3** to click "我要玩" become the next game’s players; everyone else who confirms becomes a spectator.
- New members who join **while the vote is still open** (i.e., fewer than 3 have confirmed) can also click "我要玩" and claim a player slot.
- Once 3 players are confirmed, the next game starts after a 3-second countdown.
- If fewer than 3 confirm within 60 seconds, the room resets to **waiting** state (everyone is a spectator again, re-waiting for the vote to fill).

---

## 4. Game Rules (Standard Dou Di Zhu)

### 4.1 Deck

- **54 cards**: Standard 52-card deck + 2 Jokers (Small Joker ☆, Big Joker ★).
- Card rank (low → high): **3, 4, 5, 6, 7, 8, 9, 10, J, Q, K, A, 2, Small Joker, Big Joker**.
- Suits: ♠ ♥ ♦ ♣ (suits do not affect rank comparison).

### 4.2 Dealing

1. Shuffle the 54-card deck.
2. Deal **17 cards** to each of the 3 players.
3. Set aside **3 cards** face-down as the "landlord cards" (底牌).

### 4.3 Bidding (叫地主)

- A random player is selected to bid first.
- In turn order, each player can **Want to be Landlord (要做地主)** or **Pass (不做地主)**.
- Players vote once each; all 3 must vote before a landlord is selected.
- After all 3 have voted:
  - **Exactly 1 player** says yes → that player becomes the **Landlord (地主)**.
  - **2 or 3 players** say yes → the system **randomly picks one** of the yes-voters to be the Landlord.
  - **Nobody** says yes → the cards are **re-dealt** and voting restarts.
- The Landlord receives the 3 face-down landlord cards (revealed to all), bringing their hand to **20 cards**.

### 4.4 Gameplay

- The **Landlord plays first**.
- Play proceeds counter-clockwise (or clockwise — we use the order: Landlord → next → next).
- On your turn:
  - **Lead**: Play any valid hand combination.
  - **Follow**: Play a hand of the **same type but higher rank**, or **pass (不出)**.
  - **Bomb / Rocket** can beat any other hand type (see §4.5).
- A player who passes can still play in subsequent rounds.
- When two consecutive players pass, the remaining player leads a new round.

### 4.5 Valid Hand Types

| # | Hand Type | Chinese | Description | Example |
|---|-----------|---------|-------------|---------|
| 1 | Single | 單張 | One card | 5 |
| 2 | Pair | 對子 | Two cards of same rank | 5-5 |
| 3 | Trio | 三條 | Three cards of same rank | 5-5-5 |
| 4 | Trio + Single | 三帶一 | Trio + any single card | 5-5-5-3 |
| 5 | Trio + Pair | 三帶二 | Trio + a pair | 5-5-5-3-3 |
| 6 | Sequence | 順子 | ≥5 consecutive singles (3→A, no 2/Jokers) | 3-4-5-6-7 |
| 7 | Pair Sequence | 連對 | ≥3 consecutive pairs (3→A, no 2/Jokers) | 3-3-4-4-5-5 |
| 8 | Trio Sequence | 飛機 | ≥2 consecutive trios (3→A) | 3-3-3-4-4-4 |
| 9 | Trio Seq + Singles | 飛機帶翅膀(單) | Trio sequence + same number of singles | 3-3-3-4-4-4-7-8 |
| 10 | Trio Seq + Pairs | 飛機帶翅膀(對) | Trio sequence + same number of pairs | 3-3-3-4-4-4-7-7-8-8 |
| 11 | Quad + 2 Singles | 四帶二(單) | Four of a kind + 2 different singles | 5-5-5-5-3-8 |
| 12 | Quad + 2 Pairs | 四帶二(對) | Four of a kind + 2 pairs | 5-5-5-5-3-3-8-8 |
| 13 | Bomb | 炸彈 | Four cards of same rank | 5-5-5-5 |
| 14 | Rocket | 火箭 | Small Joker + Big Joker | ☆-★ |

### 4.6 Hand Comparison Rules

- Hands can only be beaten by hands of the **same type with higher rank**, except:
  - **Bomb** beats any non-bomb hand. A higher-ranked bomb beats a lower bomb.
  - **Rocket** beats everything (including bombs).
- Sequences, pair sequences, and trio sequences must have the **same length** to compare.
- For trio+kicker hands, only the trio rank matters for comparison.

### 4.7 Win Condition

- **Landlord wins** if the Landlord plays all their cards first.
- **Peasants win** if either Peasant plays all their cards first.

---

## 5. Frontend Specification

### 5.1 Pages / Routes

| Route | Description |
|-------|-------------|
| `/` | Landing page — nickname input, create/join room |
| `/room/[code]` | Game room — lobby, bidding, gameplay, results |

### 5.2 UI Components

#### Landing Page
- Logo/title: "鬥地主"
- **暱稱 (Nickname)** input field (2–10 chars); pre-filled from `localStorage` if available.
- **建立房間** button — nickname is the only required field.
- **加入房間** section — nickname input (shared/same field) + 6-character room code input + "加入" button.
- Nickname is sanitised against XSS on both client and server before use.
- **Duplicate nicknames**: If a nickname already exists in the room, the server appends a numeric suffix (e.g., "小明" → "小明2") to ensure uniqueness within the room.

#### Lobby (within `/room/[code]`)
- Room code display (large, copyable)
- **Member list**: all members shown as avatar circles in a scrollable strip
  - Each avatar shows the **coloured initial** of the nickname + label below
  - New members appear with a fade-in + scale animation
- When **≥3 members** are present, the **"準備開始" voting prompt** appears:
  - Each member sees a "我要玩" button; avatars who have voted get a green tick
  - A live counter "N/3 已確認" is shown
  - When 3 have voted, a 3-second countdown starts
- On small screens (<400px), the member strip collapses behind a "房間成員 (N)" chip

#### Game Board

**Mobile layout (primary — vertical portrait):**
```
┌──────────────────────────┐
│  Opponent 2 avatar+name  │  ← top, card back row
├──────────────────────────┤
│     底牌 (3 cards)        │  ← landlord cards centre
├──────────────────────────┤
│  Opponent 1 avatar+name  │  ← middle, card back row
├──────────────────────────┤
│   Last played cards       │  ← play area
├──────────────────────────┤
│   [出牌] [不出]  buttons  │  (hidden for spectators)
├──────────────────────────┤
│  Self hand (scrollable)  │  ← players only; spectators see
│  OR spectator band       │     a scrollable spectator strip
└──────────────────────────┘
```

**Spectator Band (bottom of screen, players only see this on desktop):**
- Horizontal row of small avatar bubbles (28px circles).
- Shows spectator count chip: "👁 N 人觀看" — tapping expands the full list.
- Hidden automatically when viewport width < 400px; accessible via a collapsible chip instead.

**Desktop layout (secondary — horizontal):**
- Opponents at top-left and top-right, self at bottom.
- Spectator panel as a collapsible sidebar on the right.

**Avatar / Player Info:**
- Each player has a circular avatar (coloured initial of nickname).
- Nickname displayed below/beside avatar.
- Role badge (地主 / 農民) shown after landlord is decided.
- Active-turn glow ring around avatar.
- Emoji reaction bubble appears above avatar (see §5.5).

**HUD**: pass button (不出), play button (出牌), card count badge per opponent.

#### Bidding UI
- Overlay or inline panel showing bid options: "1 分", "2 分", "3 分", "不叫 (Pass)"
- Highlight whose turn it is to bid
- Show previous bids from other players

#### Game End Overlay
- Winner announcement with animation.
- **All room members** see a "我要玩 (I’m In)" / "離開 (Leave)" prompt.
- A live roster shows who has voted, with avatars ticking green as they confirm.
- First 3 to confirm get "玩家" badge; the rest who confirm get "觀眾" badge.
- 60-second countdown; if fewer than 3 confirm, room resets to **waiting** (all members become spectators, vote re-opens when ≥3 present).

### 5.3 Animations (Framer Motion)

| Animation | Description |
|-----------|-------------|
| Card deal | Cards fly from deck to each player position |
| Card select | Card moves up slightly when tapped |
| Card play | Selected cards animate to center play area |
| Bidding | Bid value floats up with fade |
| Turn indicator | Glowing ring around active player avatar |
| Win/Lose | Confetti / shake effect on result screen |
| Player join | Seat fills with a fade-in + scale animation |
| Spectator join | Small avatar bubble slides into spectator strip |
| Countdown | Pulsing number countdown (3, 2, 1) |
| Emoji reaction | Bubble pops out above avatar, floats up, fades out (~1.5s) |
| Next-round vote | Avatar ticks green as each person confirms |
| Role promotion | Spectator avatar expands into a full player seat |

### 5.4 Responsive Design

- **Primary target: mobile portrait (375px+).** Layout is single-column vertical.
- Secondary: desktop browser (1280px+) with horizontal layout.
- Tablet landscape follows the desktop layout.
- Card sizes scale with viewport: `clamp(52px, 10vw, 80px)` width.
- Touch targets minimum 44×44px for buttons and cards.

### 5.5 Emoji Reactions

- Three fixed emoji buttons always visible during gameplay (next to HUD).
- When pressed, an emoji bubble animates out from the sender's avatar: scales up, floats upward, and fades out over ~1.5 seconds.
- All three players see every reaction in real time (broadcast via WebSocket).
- Rate-limited: max 1 reaction per player per 3 seconds.

| Emoji | Meaning |
|-------|---------|
| 🖕 | 中指 (middle finger) |
| 🤏 | 這麼小 (finger pinch — "so small") |
| 🤌 | 義大利手勢 (Italian hand / "what do you want?") |

---

## 6. Backend Specification

### 6.1 NestJS Module Structure

```
src/
├── app.module.ts
├── main.ts
├── game/
│   ├── game.module.ts
│   ├── game.gateway.ts        # WebSocket gateway
│   ├── game.service.ts        # Game logic & state management
│   ├── room.manager.ts        # Room creation, joining, cleanup
│   ├── card.utils.ts          # Deck, shuffle, hand validation
│   └── types.ts               # Shared interfaces/types
└── health/
    └── health.controller.ts   # GET /health for uptime monitoring
```

### 6.2 In-Memory State

```typescript
interface Room {
  code: string;               // 6-char room code
  members: Member[];           // all people in the room
  state: 'waiting' | 'voting' | 'playing';
  voteQueue: string[];         // socket IDs in vote_play order; first 3 = players
  voteTimeout: NodeJS.Timeout | null;
  deck: Card[];
  landlordCards: Card[];       // 3 face-down cards
  landlordIndex: number;       // index in players (derived from voteQueue[0..2])
  currentTurn: number;         // player index
  currentBid: number;          // unused (kept for compat)
  currentBidder: number;       // who was chosen as landlord
  passCount: number;           // consecutive passes during gameplay
  lastPlay: Play | null;       // last played hand
  lastPlayedBy: number;        // player index who last played
  bidPassCount: number;        // total votes cast in landlord bidding
  bidYesVoters: number[];      // player indices who said yes in landlord vote
  firstBidder: number;         // who starts bidding
}

interface Member {
  id: string;                  // socket.id
  nickname: string;
  reconnectToken: string;      // UUID stored in client sessionStorage
  role: 'spectator' | 'player'; // 'player' only during 'playing' state
  hand: Card[];                // empty for spectators
}
```

```typescript
interface Card {
  suit: 'spade' | 'heart' | 'diamond' | 'club' | 'joker';
  rank: number;                // 3-15 (3=3, ..., 13=K, 14=A, 15=2, 16=SmallJoker, 17=BigJoker)
}

interface Play {
  type: HandType;
  cards: Card[];
  rank: number;                // primary rank for comparison
}
```

- Rooms are stored in a `Map<string, Room>` in `RoomManager`.
- Rooms are **auto-deleted** after 5-minute idle (no members).

### 6.3 WebSocket Events

#### Client → Server

| Event | Payload | Description |
|-------|---------|-------------|
| `create_room` | `{ nickname }` | Create a new room (creator joins as spectator) |
| `join_room` | `{ roomCode, nickname }` | Join room as spectator |
| `reconnect` | `{ reconnectToken, roomCode }` | Reconnect to a room after disconnect |
| `vote_play` | `{}` | Vote to be a player (valid when vote is open and <3 confirmed) |
| `react_emoji` | `{ emoji: '🖕' \| '🤏' \| '🤌' }` | Send an emoji reaction |
| `bid` | `{ value: 0 \| 1 }` | Vote for landlord (1 = yes, 0 = no) |
| `play_cards` | `{ cards: Card[] }` | Play selected cards |
| `pass` | `{}` | Pass this turn |
| `leave_room` | `{}` | Leave the room |

#### Server → Client

| Event | Payload | Description |
|-------|---------|-------------|
| `room_created` | `{ roomCode }` | Room successfully created |
| `room_joined` | `{ members, roomCode }` | Joined successfully (everyone is a spectator initially) |
| `member_joined` | `{ nickname, memberCount }` | Someone new joined the room |
| `member_left` | `{ nickname, memberCount }` | Someone left the room |
| `vote_open` | `{ memberCount }` | ≥3 members present, voting is now open |
| `vote_update` | `{ confirmedNicknames, confirmedCount }` | Someone voted; broadcast updated tally |
| `vote_closed_start` | `{ players: [{id,nickname}], spectators: [{id,nickname}] }` | 3 confirmed — roles assigned, game starting |
| `vote_reset` | `{}` | 60s timeout expired with <3 confirmed; vote resets, back to waiting |
| `game_start` | `{ hand: Card[], firstBidder }` | Game begins (players get hand; spectators get empty hand) |
| `bid_turn` | `{ playerIndex, currentBid }` | It’s someone’s turn to bid |
| `bid_made` | `{ playerIndex, value }` | A player placed a bid |
| `landlord_decided` | `{ playerIndex, landlordCards }` | Landlord is chosen, reveal 3 cards |
| `your_turn` | `{}` | It’s your turn to play |
| `cards_played` | `{ playerIndex, cards, handType, remaining }` | Cards were played |
| `player_passed` | `{ playerIndex }` | A player passed |
| `new_round` | `{ starterIndex }` | Two passes, new lead round |
| `game_over` | `{ winner: 'landlord'\|'peasants', landlordIndex }` | Game ended; vote re-opens automatically |
| `room_disbanded` | `{ reason }` | Room closed (all members left) |
| `invalid_play` | `{ reason }` | Played cards are invalid |
| `room_error` | `{ message }` | Room-related error |
| `rebid` | `{}` | No one bid, re-dealing |
| `emoji_reaction` | `{ senderNickname, role: 'player'\|'spectator', emoji }` | Broadcast emoji reaction to room |

### 6.4 Game Logic Flow (Server-Side)

```
── UNIFIED ROOM STATE MACHINE ──────────────────────────────

state: 'waiting'
  - Everyone in the room is a spectator (including creator).
  - New members can join at any time.
  - Transition → 'voting' when memberCount ≥ 3.

state: 'voting'
  - vote_open broadcast to all members.
  - Any member can emit vote_play to claim a player slot.
  - New arrivals while <3 confirmed may also vote.
  - Server tracks voteQueue: string[] (socket IDs, in order of receipt).
  - Transition → 'playing' when voteQueue.length ≥ 3
      → first 3 become players, rest remain spectators.
  - If memberCount drops below 3 while voting → back to 'waiting',
    vote resets, vote_reset broadcast.
  - 60-second timeout with <3 confirmed → vote resets, back to 'waiting'.

state: 'playing'  (encompasses bidding + gameplay sub-states)
  - Sub-state: 'bidding'
      Shuffle & deal 17 cards each (sorted highest→lowest), set aside 3 landlord cards.
      Spectators receive no cards.
      Random first bidder assigned.
      Server deals cards to all players (`game_start`), waits ~2 seconds,
      then emits `bid_turn` to open bidding — giving players time to see
      their hand before deciding.
      Players vote in turn: yes (want to be landlord) or no.
      After all 3 vote:
        - Nobody voted yes → re-deal, repeat bidding.
        - 1 voted yes → that player is the Landlord.
        - 2-3 voted yes → system randomly picks one of the yes-voters.
      Landlord receives the 3 bottom cards (sorted into their hand, 20 total).
      Landlord cards revealed to all players.
  - Sub-state: 'gameplay'
      Landlord plays first.
      Validate each play against hand type rules.
      Track consecutive passes.
      Two consecutive passes → new round (last player leads).
  - When a player’s hand is empty:
      If Landlord → Landlord wins.
      If Peasant → Peasants win.
  - Transition → 'voting' on game end
      (game_over broadcast, vote immediately re-opens for all members).

── DISCONNECTION ────────────────────────────────────────────

  Player disconnects during 'playing':
    - Grant 60-second reconnect window.
    - If reconnected within 60s → restore hand & state, continue.
    - If not reconnected → room resets to 'waiting' state:
        All remaining members become spectators.
        Players’ hands are discarded.
        vote_reset broadcast; memberCount checked → if ≥3, vote_open fires again.

  Spectator disconnects (any state):
    - Silently removed; no impact on game or voting.

  All members leave:
    - Room auto-deleted after 5-minute idle timeout.
    - room_disbanded broadcast.
```

### 6.5 Card Validation Algorithm

The server must validate every play. Key validation functions:

```
validatePlay(cards: Card[], lastPlay: Play | null): Play | null
  - If lastPlay is null (new round): validate cards form a legal hand type.
  - If lastPlay exists: cards must be same type + higher rank, OR bomb/rocket.

identifyHandType(cards: Card[]): { type: HandType, rank: number } | null
  - Check card count and patterns against all 14 hand types.
  - Return null if cards don't form a valid hand.
```

### 6.6 Disconnection Handling

| Scenario | Behaviour |
|----------|-----------|
| Spectator disconnects (any state) | Silently removed from member list. No effect on game. |
| Player disconnects during 'playing' | 60-second grace period. If reconnected → restore state. If not → reset room to 'waiting': all remaining members become spectators, hands discarded, `vote_reset` broadcast. If ≥3 members remain, `vote_open` fires immediately. |
| Member disconnects during 'voting' | Removed from member list and voteQueue (if present). If memberCount drops below 3 → `vote_reset`, back to 'waiting'. |
| All members leave | Room deleted after 5-minute idle timeout. |

### 6.7 Health & Monitoring

- `GET /health` → `{ status: 'ok', rooms: <count>, uptime: <seconds> }`
- Used by hosting platform for health checks.

---

## 7. API & Communication Protocol

All communication is via **WebSocket (Socket.IO)**. No REST endpoints except `/health`.

### 7.1 Connection Flow

1. Client connects to WebSocket with query params: `?nickname=xxx`
2. Server assigns `socket.id` as player identifier.
3. Client emits `create_room` or `join_room`.
4. Server places socket into a Socket.IO room (identified by room code).
5. All game events are scoped to the Socket.IO room.

### 7.2 Reconnection

- Client stores a `reconnectToken` (UUID) in `sessionStorage`.
- On reconnect, client sends `{ reconnectToken, roomCode }`.
- Server matches token to player and restores their state.

---

## 8. Security Considerations

- **Input validation**: All incoming events are validated (nickname length, card legality, turn order).
- **Anti-cheat**: The server is the source of truth — clients only receive their own hand. Opponent hands are never sent.
- **Rate limiting**: Max 10 events/second per socket to prevent spam.
- **Room code**: 6-char alphanumeric, collision-checked on creation.
- **No authentication needed** (by design), but nicknames are sanitized to prevent XSS.

---

## 9. Deployment

### 9.1 Frontend (Vercel)

- `next build && next export` or standard Vercel deployment.
- Environment variable: `NEXT_PUBLIC_WS_URL` → backend WebSocket URL.
- No server-side rendering needed; static/client-rendered pages suffice.

### 9.2 Backend (Railway / Render)

- Dockerfile or `npm start` deployment.
- Single process (NestJS).
- Environment variables:
  - `PORT` (provided by platform)
  - `CORS_ORIGIN` (frontend URL)
- No database or persistent volume needed.
- Health check endpoint: `/health`.

---

## 10. Project Structure

```
ddz/
├── frontend/
│   ├── package.json
│   ├── next.config.js
│   ├── tailwind.config.ts
│   ├── tsconfig.json
│   ├── public/
│   │   └── favicon.ico
│   ├── src/
│   │   ├── app/
│   │   │   ├── layout.tsx
│   │   │   ├── page.tsx        # Landing page
│   │   │   └── room/
│   │   │       └── [code]/
│   │   │           └── page.tsx # Game room
│   │   ├── components/
│   │   │   ├── Card.tsx
│   │   │   ├── CardHand.tsx
│   │   │   ├── GameBoard.tsx
│   │   │   ├── BiddingPanel.tsx
│   │   │   ├── PlayerSeat.tsx
│   │   │   ├── PlayArea.tsx
│   │   │   ├── RoomLobby.tsx
│   │   │   ├── GameResult.tsx
│   │   │   └── Countdown.tsx
│   │   ├── hooks/
│   │   │   ├── useSocket.ts
│   │   │   └── useGame.ts
│   │   ├── lib/
│   │   │   ├── socket.ts       # Socket.IO client singleton
│   │   │   └── cardUtils.ts    # Client-side card helpers
│   │   └── types/
│   │       └── game.ts         # Shared type definitions
│   └── ...
├── backend/
│   ├── package.json
│   ├── tsconfig.json
│   ├── nest-cli.json
│   ├── Dockerfile
│   ├── src/
│   │   ├── main.ts
│   │   ├── app.module.ts
│   │   ├── game/
│   │   │   ├── game.module.ts
│   │   │   ├── game.gateway.ts
│   │   │   ├── game.service.ts
│   │   │   ├── room.manager.ts
│   │   │   ├── card.utils.ts
│   │   │   └── types.ts
│   │   └── health/
│   │       └── health.controller.ts
│   └── ...
├── SPEC.md                     # This file
└── README.md
```

---

## 11. Card Visual Representation

Cards will be rendered as styled HTML/CSS components (not images) for simplicity:

- Each card shows: rank symbol + suit symbol + suit color (red/black).
- Jokers: distinct design (☆ small / ★ big) with unique colors.
- Card back: solid pattern for opponent cards.
- Card dimensions: ~70px × 100px (desktop), scaled on smaller screens.

---

## 12. Scope & Non-Goals

### In Scope (MVP)
- [x] Traditional Chinese (繁體中文) UI throughout
- [x] Room creation/joining with room code
- [x] 3-player Dou Di Zhu with full rules
- [x] Bidding phase
- [x] All 14 hand types
- [x] Basic card animations
- [x] Win/loss detection
- [x] Play again in same room
- [x] Reconnection support (60s grace)

### In Scope (MVP) — additions
- [x] Nickname input with `localStorage` prefill
- [x] Nickname displayed on player avatar (coloured initial circle)
- [x] Mobile-first vertical portrait layout
- [x] 3 emoji reactions (🖕 🤏 🤌) with bubble animation
- [x] Spectator mode (join as observer, shown in spectator strip)
- [x] Post-game all-member vote; first 3 confirmers become next players

### Out of Scope (Not for MVP)
- ❌ User registration / accounts
- ❌ Game history / statistics
- ❌ Full chat
- ❌ AI/bot players
- ❌ Scoring / points across games
- ❌ Sound effects
- ❌ Tournament mode

---

## 13. Open Questions

1. **Card assets**: Use CSS-rendered cards or import an SVG card set?
   - *Resolved*: CSS-rendered for zero external dependencies.
2. **Reconnection**: Is 60 seconds sufficient?
   - *Resolved*: Yes, keep it simple.
3. **Room expiry**: How long should an idle room persist?
   - *Resolved*: 5 minutes after all members leave.
4. **"Next round" mechanic**: Require all players to agree, or first-come-first-served?
   - *Resolved*: First 3 to vote "我要玩" become the next players.

---

*This spec will be referenced during implementation. Any changes should be reflected here first.*
