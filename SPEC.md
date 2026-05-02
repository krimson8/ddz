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
- Shows the member list (all current members), with each member’s ready status visible.
- Once **≥3 people** are in the room, a **"準備出戰"** voting prompt appears for everyone.
  - Any member can click **"我要玩！"** to toggle their `wantToPlay` flag on; clicking again (**"取消準備"**) toggles it off.
  - The ready count (N/3) updates live for all members via `members_update`.
  - The instant exactly 3 members have `wantToPlay = true`, the game locks in immediately (no timeout needed).
- Once 3 players are locked in, the game starts after a 3-second countdown.

### 3.3 Game Screen

- **Players**: see their own hand at the bottom, two opponents above, play/pass controls.
- **Spectators**: see all three players' card counts and the play area, but no hand of their own. Spectators see a read-only view with the play area and a spectator list panel.
- Center area for played cards.
- Cards are dealt and shown to each player **first**; after a ~2-second pause the bidding UI appears so players can review their hand before deciding.

### 3.4 Game End

- Shows winner announcement (地主勝 / 農民勝).
- All `wantToPlay` flags are cleared for everyone; all members revert to spectator role.
- **All** people in the room (3 players + all spectators) are shown the same prompt: **"再玩一局"** / **"取消準備"**.
- Members toggle their intent with the same mechanism as the lobby — **"再玩一局"** sets `wantToPlay = true`, clicking again cancels.
- The instant exactly 3 members have `wantToPlay = true`, the next game locks in and starts after a 3-second countdown.
- There is no timeout — members can take as long as they want; the vote never auto-resets.

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

- Cards are dealt and shown to players; after a **~2-second pause** the bidding UI appears.
- All 3 players bid **simultaneously** within an **8-second window** (`bid_open` event with `timeoutMs: 8000`).
- Each player can click **要做地主 (Want to be Landlord)** or **不做 (Pass)**; once voted they cannot change.
- The round resolves when all 3 have voted **or** the 8-second timer expires:
  - **1 or more players** say yes → the system **randomly picks one** of the yes-voters to be the Landlord.
  - **Nobody** says yes → the system **randomly assigns** one of the 3 players as Landlord (no re-deal).
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
| `/` | Single page — all views (home screen, lobby, game board) rendered here based on `GamePhase` |

There is no `/room/[code]` route. The room code is not in the URL; identity is entirely token-based (see §7.2).

### 5.1.1 Client-Side Game Phase

The frontend tracks a `GamePhase` to drive UI transitions:

| Phase | Description |
|-------|-------------|
| `lobby` | Waiting room / voting screen |
| `dealing` | Cards dealt, players see their hand before bidding opens (~2s window) |
| `bidding` | Simultaneous 8-second bid window open |
| `gameplay` | Active card play phase |
| `result` | Game-over overlay shown |

### 5.2 UI Components

#### Landing Page
- Logo/title: "鬥地主"
- **暱稱 (Nickname)** input field (2–10 chars); pre-filled from `localStorage` if available.
- **建立房間** button — nickname is the only required field.
- **加入房間** section — nickname input (shared/same field) + 6-character room code input + "加入" button.
- Nickname is sanitised against XSS on both client and server before use.
- **Duplicate nicknames**: If a nickname already exists in the room, the server appends a numeric suffix (e.g., "小明" → "小明2") to ensure uniqueness within the room.

#### Lobby
- **"← 離開房間"** button at top-left — emits `leave_room`, clears the reconnect token from `localStorage`, and resets state to the home screen.
- Room code display (large, copyable)
- **Member list**: all members shown as avatar circles in a scrollable strip
  - Each avatar shows the **coloured initial** of the nickname + label below
  - New members appear with a fade-in + scale animation
  - Members with `wantToPlay = true` are highlighted in yellow
- When **≥3 members** are present, the **"準備出戰"** voting prompt appears:
  - Button shows **"我要玩！"** when not ready, **"取消準備"** (red) when ready — toggleable at any time
  - A live counter "準備出戰 (N/3)" updates via `members_update` for all clients
  - When 3 members are ready, a 3-second countdown starts automatically
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
- Overlay or inline panel showing bid options: **"要做地主 (Want to be Landlord)"** and **"不做 (Pass)"**
- All 3 players bid simultaneously; an 8-second countdown is shown
- Each player can only vote once; the panel disables after submission
- A live tally shows how many players have already voted (e.g. "1/3 已投票")

#### Game End Overlay
- Winner announcement shown immediately when `game_over` event is received. No client-side countdown.
- Displays a static "返回大廳中…" message while the backend 5-second delay runs.
- After 5 seconds the server emits `return_to_lobby` → all clients reset to the lobby screen.
- All `wantToPlay` flags are cleared server-side; `members_update` follows `return_to_lobby`.
- **All room members** see a **"再玩一局"** / **"取消準備"** toggle button — same mechanics as the lobby.
- A live roster shows who is ready, highlighted in yellow as they toggle on.
- No timeout — vote stays open until 3 are ready.

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

- A dropdown selector + **送出** button always visible during gameplay (next to the player's hand area).
- When sent, the reaction text/emoji animates above the sender's avatar: scales up, floats upward, and fades out over ~3 seconds.
- All players see every reaction in real time (broadcast via WebSocket).
- Rate-limited: max 1 reaction per player per **500 ms** (silently dropped if too fast).
- Reactions are grouped in the selector:

| Group | Items |
|-------|-------|
| 表情 (Emoji) | 🖕, 🤏, 🤌 |
| 語錄 (Phrases) | 我操, EZ, GG, 什麼lin, 你會玩的嗎, 小癟三, 不用看了, 窩妖驗牌, 牌沒有問題, 在我者離, 給我搽皮鞋 |

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
  state: 'waiting' | 'playing';
  playerIds: string[];         // socket IDs of the 3 locked-in players (set when game starts)
  deck: Card[];
  landlordCards: Card[];       // 3 face-down cards
  landlordIndex: number;       // index in playerIds[0..2]; -1 during bidding
  currentTurn: number;         // player index
  currentBid: number;          // unused (kept for compat)
  currentBidder: number;       // who was chosen as landlord
  passCount: number;           // consecutive passes during gameplay
  lastPlay: Play | null;       // last played hand
  lastPlayedBy: number;        // player index who last played
  bidPassCount: number;        // total votes cast in landlord bidding
  bidYesVoters: number[];      // player indices who said yes in landlord vote
  firstBidder: number;         // who starts bidding
  bidTimer: NodeJS.Timeout | null;    // 8s simultaneous bid window timer
  bidVotedIndices: number[];          // player indices who have already cast their bid
  idleTimeout: NodeJS.Timeout | null; // 5-min auto-delete timer
  reconnectTimers: Map<string, NodeJS.Timeout>; // socketId → 15s grace timer
  winCounts: Record<string, number>;  // nickname → total wins in this room session
}

interface Member {
  id: string;                  // socket.id
  nickname: string;
  reconnectToken: string;      // UUID stored in client localStorage (per room key)
  role: 'spectator' | 'player'; // 'player' only during 'playing' state
  hand: Card[];                // empty for spectators
  wantToPlay: boolean;         // toggled by vote_play; cleared on game start/end
  disconnectedAt?: number;     // timestamp (ms) set on disconnect; cleared on reconnect
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
| `join_room` | `{ code, nickname }` | Join room as spectator (`code` = 6-char room code) |
| `rejoin` | `{ reconnectToken, code }` | Reconnect to a room after disconnect |
| `vote_play` | `{}` | Toggle `wantToPlay` flag — valid any time game is not running; triggers game start if 3 members are now ready |
| `react_emoji` | `{ emoji: string }` | Send an emoji reaction or phrase (see §5.5 for allowed values) |
| `bid` | `{ value: 0 \| 1 }` | Vote for landlord (1 = yes, 0 = no) during simultaneous bid window |
| `play_cards` | `{ cards: Card[] }` | Play selected cards |
| `pass` | `{}` | Pass this turn |
| `leave_room` | `{}` | Leave the room |

#### Server → Client

| Event | Payload | Description |
|-------|---------|-------------|
| `room_created` | `{ roomCode, reconnectToken }` | Room successfully created |
| `room_joined` | `{ roomCode, members, state, playerIds, seq, reconnectToken?, reconnect?, currentTurn?, landlordIndex?, landlordCards?, lastPlay?, playerCardCounts? }` | Full state snapshot — sent on join, rejoin, and sync. Gameplay fields only present when reconnecting mid-game. |
| `members_update` | `{ members: [{id, nickname, role, cardCount, wantToPlay}], seq }` | Full member list broadcast whenever membership or `wantToPlay` changes |
| `vote_closed_start` | `{ players: [{id,nickname}], spectators: [{id,nickname}], seq }` | 3 members ready — roles locked, game starting in 3s |
| `game_start` | `{ hand: Card[], firstBidder, reconnect? }` | Unicast — game begins; players get hand, spectators get empty hand. On reconnect, only restores hand (phase already set by `room_joined`). |
| `bid_open` | `{ timeoutMs: 8000, seq }` | Simultaneous bid window is open |
| `bid_turn` | `{ playerIndex, currentBid }` | Unicast to reconnected player only — restores bidding UI state |
| `bid_made` | `{ playerIndex, value, seq }` | A player placed a bid |
| `landlord_decided` | `{ playerIndex, landlordCards, seq }` | Landlord chosen; 3 face-down cards revealed to all |
| `your_turn` | `{}` | Unicast — it’s your turn to play |
| `cards_played` | `{ playerIndex, cards, handType, rank, remaining, seq }` | Cards were played |
| `turn_changed` | `{ nextTurn, seq }` | Current turn index changed (emitted after every play or pass) |
| `player_passed` | `{ playerIndex, seq }` | A player passed |
| `new_round` | `{ nextTurn, seq }` | Two passes — new lead round; `lastPlay` resets to null |
| `game_over` | `{ winner: ‘landlord’\|’peasants’, landlordIndex, winCounts, seq }` | Game ended; win overlay shown. `return_to_lobby` follows after 5s. |
| `return_to_lobby` | `{ seq }` | Emitted 5s after `game_over` — all clients reset to lobby screen; `members_update` follows immediately |
| `player_disconnected` | `{ nickname, timeoutMs: 15000, seq }` | A player dropped mid-game; reconnect window started. Other players see a waiting overlay. |
| `player_reconnected` | `{ nickname, seq }` | Disconnected player successfully rejoined; overlay dismissed, game continues |
| `game_aborted` | `{ seq }` | Game aborted (reconnect window expired); all flags cleared, back to waiting |
| `room_disbanded` | `{ reason }` | Room closed (all members left, 5-min idle timeout) |
| `invalid_play` | `{ reason }` | Played cards are invalid |
| `room_error` | `{ message }` | Room-related error (e.g. join failed, rate limit, reconnect failed) |
| `emoji_reaction` | `{ senderId, senderNickname, role: ‘player’\|’spectator’, emoji }` | Broadcast emoji reaction/phrase to room |

### 6.4 Game Logic Flow (Server-Side)

```
── UNIFIED ROOM STATE MACHINE ──────────────────────────────

state: ‘waiting’
  - Everyone in the room is a spectator; all wantToPlay flags are false.
  - New members can join at any time.
  - Any member can toggle wantToPlay via vote_play at any time.
  - On every toggle, members_update is broadcast with the full member list.
  - Transition → ‘playing’ the instant exactly 3 members have wantToPlay = true.
  - No timeout, no separate ‘voting’ state.

state: ‘playing’  (encompasses bidding + gameplay sub-states)
  - The 3 players are locked in playerIds[]; wantToPlay flags are no longer relevant.
  - Sub-state: ‘bidding’
      Shuffle & deal 17 cards each (sorted highest→lowest), set aside 3 landlord cards.
      Spectators receive no cards.
      Random first bidder index assigned (stored as `firstBidder`).
      Server deals cards to all players (`game_start`), waits ~2 seconds,
      then emits `bid_open { timeoutMs: 8000 }` — all 3 players bid simultaneously.
      An 8-second server-side timer (`bidTimer`) enforces the deadline.
      The round resolves when all 3 have voted OR the timer fires:
        - 1 or more voted yes → system randomly picks one of the yes-voters.
        - Nobody voted yes → system randomly assigns one of the 3 players.
      (There is no re-deal; landlord is always determined in one round.)
      Landlord receives the 3 bottom cards (sorted into their hand, 20 total).
      Landlord cards revealed to all players.
  - Sub-state: ‘gameplay’
      Landlord plays first.
      Validate each play against hand type rules.
      After every successful play or pass, server emits `turn_changed { nextTurn }` to
      all clients and `your_turn {}` to the individual player whose turn it is now.
      Track consecutive passes.
      Two consecutive passes → new round (last player leads), `new_round { nextTurn }` broadcast.
  - When a player’s hand is empty:
      If Landlord → Landlord wins.
      If Peasant → Peasants win.
  - On game end:
      game_over broadcast → win overlay shown on all clients.
      All wantToPlay flags cleared; all members reverted to spectator.
      After 5-second delay:
        return_to_lobby broadcast → all clients reset to lobby screen.
        members_update broadcast (updated member list with cleared flags).
      Room returns to ‘waiting’ — members may immediately start voting again.

── DISCONNECTION ────────────────────────────────────────────

  Player disconnects during ‘playing’:
    - Grant 15-second reconnect window (member marked disconnectedAt, filtered from members_update).
    - player_disconnected { nickname, timeoutMs: 15000 } broadcast to remaining players.
    - Remaining players see a waiting overlay until resolved.
    - If reconnected within 15s:
        playerIds updated to new socket ID.
        Full game state (hand, currentTurn, landlordIndex, landlordCards, lastPlay,
        playerCardCounts) unicast via room_joined + game_start.
        player_reconnected broadcast → overlay dismissed, game continues.
        members_update broadcast.
    - If not reconnected → room resets to ‘waiting’:
        All remaining members become spectators, wantToPlay flags cleared.
        game_aborted broadcast + members_update.

  Socket transport reconnect (network blip, same page):
    - Socket.IO fires a new ‘connect’ event on the client.
    - Client re-emits rejoin with the saved reconnect token automatically.
    - Server processes it as a normal reconnect (token lookup, state restore).

  Member disconnects during ‘waiting’:
    - Removed immediately from member list.
    - members_update broadcast. No impact on vote (their flag is gone with them).

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
| Member disconnects during 'waiting' | Removed immediately from member list. `members_update` broadcast. Their `wantToPlay` flag is gone with them — vote count drops naturally. |
| Player disconnects during 'playing' | 15-second grace period — `player_disconnected` broadcast; member stays in room with `disconnectedAt` set, filtered from `members_update`. If reconnected → full state unicast (`room_joined` + `game_start`), `player_reconnected` + `members_update` broadcast. If timer expires → `game_aborted`, all flags cleared, room back to 'waiting'. |
| All members leave | Room deleted after 5-minute idle timeout. `room_disbanded` broadcast. |

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

- On join/create, server assigns a `reconnectToken` (UUID) and sends it in `room_created` / `room_joined`.
- Client stores it in `localStorage` under key `ddz_reconnectToken_<ROOMCODE>`.
- On page load, client scans `localStorage` for any saved token and auto-emits `rejoin { code, reconnectToken }`.
- On socket transport reconnect (network blip), client re-emits `rejoin` on the `connect` event if a token exists for the current room.
- Server matches token → updates socket ID → restores full game state via `room_joined` + `game_start` unicast.
- Token is rotated on every successful reconnect to prevent replay attacks.
- If `rejoin` fails (room gone, token expired) → server emits `room_error` → client clears the stale token and shows the home screen.
- "← 離開房間" button clears the token explicitly so a page refresh after leaving returns to the home screen.

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
│   │   │   └── page.tsx        # Single page — home / lobby / game board
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
- [x] Reconnection support (15s grace, token-based, auto-rejoin on transport reconnect)

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
   - *Resolved*: Reduced to 15 seconds. Token-based, auto-rejoin on transport reconnect and page load.
3. **Room expiry**: How long should an idle room persist?
   - *Resolved*: 5 minutes after all members leave.
4. **"Next round" mechanic**: Require all players to agree, or first-come-first-served?
   - *Resolved*: Toggle-based — any member can set/unset `wantToPlay`; game locks the instant 3 are ready. No timeout.
5. **Bidding mechanic**: Sequential or simultaneous?
   - *Resolved*: Simultaneous 8-second window. If nobody bids yes, landlord is randomly assigned (no re-deal).
6. **Emoji rate limit**: 3 seconds or shorter?
   - *Resolved*: 500 ms (both server and client) for snappier feel.

---

*This spec will be referenced during implementation. Any changes should be reflected here first.*
