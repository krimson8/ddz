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
- **Any member can toggle ready at any time** — no minimum player count required before voting.
  - Button shows **"我要玩！"** when not ready, **"取消準備"** (red) when ready — toggleable at any time.
  - The ready count (N/3) updates live for all members via `members_update`.
  - The instant exactly 3 members have `wantToPlay = true`, the game locks in immediately (no timeout needed).
- Once 3 players are locked in, the game starts after a 3-second countdown.

### 3.3 Game Screen

- **Players**: see their own hand at the bottom, two opponents above, play/pass controls.
- **Spectators**: see all three players' card counts, the play area, and can browse any player's full hand. The bottom seat defaults to the landlord (once decided). Clicking a top opponent avatar swaps that player to the bottom seat; the seating order remains clockwise. The viewed player's hand is shown read-only below their seat.
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

The frontend tracks a `GamePhase` to drive UI transitions. **All phase transitions are driven exclusively by server events** — the client never derives or self-advances the phase.

| Phase | Description | Triggered by |
|-------|-------------|--------------|
| `lobby` | Waiting room / voting screen | Initial state; `game_aborted`, `return_to_lobby` |
| `dealing` | Cards dealt, players see their hand before bidding opens (~2s window) | `vote_closed_start`, `game_start` |
| `bidding` | Simultaneous 8-second bid window open | `bid_open` |
| `gameplay` | Active card play phase | `landlord_decided` |
| `result` | Game-over overlay shown | `game_over` |

On reconnect, the server includes a `phase` field in `room_joined` so the client restores the correct phase directly.

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
- The **"準備出戰"** voting prompt is always visible — no minimum player count required:
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

**Spectator bottom area (spectators only):**
- Bottom seat defaults to the landlord player once landlord is decided; before that, defaults to `playerOrder[0]`.
- The viewed player's full hand is shown read-only below their seat info (no action buttons).
- Clicking either top opponent avatar swaps them to the bottom seat; the two remaining players fill the top seats in clockwise order.
- A "觀戰中" label appears in the bottom-right corner of the spectator area.

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

#### Game End Banner
- When `game_over` is received, an inline banner slides down from the top of the game board — it does **not** cover the board, so the winning hand remains visible.
- The banner shows: winner announcement (地主獲勝 / 農民獲勝), winner names highlighted, and the **winning hand cards** played on the last move.
- A pulsing "返回大廳中…" message is shown while the backend 5-second delay runs.
- **Voting is blocked during this 5-second window** — the backend rejects any `vote_play` events while `resultPending` is true.
- After 5 seconds the server emits `return_to_lobby` → all clients reset to the lobby screen.
- All `wantToPlay` flags are cleared server-side; `members_update` follows `return_to_lobby`.
- **All room members** see a **"再玩一局"** / **"取消準備"** toggle button — same mechanics as the lobby.
- A live roster shows who is ready, highlighted in yellow as they toggle on.
- No timeout — vote stays open until 3 are ready.

#### `game_over` payload additions
- `winningCards: Card[]` — the cards played on the winning move, included so the banner can render them without the client needing to cache `lastPlay`.

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
- Every received `emoji_reaction` event also triggers the mapped emoji sound (see §5.6).
- Reactions are grouped in the selector:

| Group | Items |
|-------|-------|
| 表情 (Emoji) | 🖕, 🤏, 🤌 |
| 語錄 (Phrases) | EZ, GG, 玩不了啦, 小兒科, 小癟三, 不用看了, 在我者離, 窩妖驗牌, 牌沒有問題, 給我搽皮鞋 |

### 5.6 Sound Effects

Implemented via the `useSoundEffects` hook (`frontend/src/hooks/useSoundEffects.ts`) using the browser's native `HTMLAudioElement`. No external audio library is required.

#### Game event sounds

| Key | File | Trigger |
|-----|------|---------|
| `cardPlay` | `/sounds/card-play.wav` | Any player plays cards (`lastPlay` changes to non-null) |
| `pass` | `/sounds/pass.mp3` | Any player passes (newest history entry has 0 cards) |
| `yourTurn` | `/sounds/your-turn.mp3` | `currentPlayer` becomes the local player's socket ID |
| `landlord` | `/sounds/landlord.mp3` | `landlordIndex` is set for the first time (landlord decided) |
| `deal` | `/sounds/deal.mp3` | Local hand goes from empty → full during `dealing` phase |
| `gameStart` | `/sounds/game-ready.mp3` | Phase transitions into `dealing` (enough players voted) |
| `win` | `/sounds/win.mp3` | Game over and local player is on the winning side |
| `lose` | `/sounds/lose.mp3` | Game over and local player is on the losing side |

- The `yourTurn` sound is stopped immediately when the local player's turn ends (they played or passed, or game over) — it does not play past the end of their turn.
- Sound files are lazy-loaded on first interaction (browser autoplay policy). Missing files are silently skipped.
- Each game-event sound uses a pool of 3 `HTMLAudioElement` instances (round-robin) to support rapid re-triggering without cutting off overlapping plays.

#### Emoji sounds

Each reaction has an optional mapped sound under `/sounds/emoji/`. Missing entries are silently skipped.

| Reaction | File |
|----------|------|
| 🖕 | `/sounds/emoji/middle-finger.mp3` |
| 🤏 | `/sounds/emoji/small.mp3` |
| 🤌 | `/sounds/emoji/chef-kiss.mp3` |
| EZ | `/sounds/emoji/ez.mp3` |
| GG | `/sounds/emoji/gg.mp3` |
| 玩不了啦 | `/sounds/emoji/wan-bu-liao-la.mp3` |
| 小兒科 | `/sounds/emoji/xiao-er-ke.ogg` |
| 小癟三 | `/sounds/emoji/xiao-bie-san1.ogg` |
| 不用看了 | `/sounds/emoji/bu-yong-kan-le.ogg` |
| 在我者離 | `/sounds/emoji/zai-wo-zhe-li.ogg` |
| 窩妖驗牌 | `/sounds/emoji/wo-yao-yan-pai.ogg` |
| 牌沒有問題 | `/sounds/emoji/pai-mei-you-wen-ti.ogg` |
| 給我搽皮鞋 | `/sounds/emoji/gei-wo-cha-pixie.ogg` |

Supported formats: MP3, WAV, OGG (OGG not supported on Safari).

### 5.7 Volume Control

A persistent volume widget is rendered on every page/phase via `frontend/src/components/VolumeControl.tsx`.

- **Position**: fixed top-left corner (`z-50`), always on top of all other UI.
- **Speaker icon button**: clicking toggles mute (volume 0 ↔ restores previous level). Icon changes based on current level (muted / low / high).
- **Expand arrow**: a small `›` / `‹` toggle to the right of the speaker button reveals/hides a horizontal slider.
- **Slider**: range 0–1, step 0.05, styled with `accent-yellow-400`.
- Volume changes apply **immediately** to all currently-playing audio elements, not just future plays.
- Volume is persisted to `localStorage` under key `ddz_volume` and restored on every page load.
- **Reset button** (`⟳`): sits to the right of the expand arrow. Two-click confirmation flow:
  - First click: button turns red and shows `確定？`; tooltip changes to `再按一次確認清除`. Auto-cancels after 3 seconds if not confirmed.
  - Second click within 3 s: clears all `ddz_*` localStorage keys **except** `ddz_nickname` and `ddz_volume`, then reloads the page.
  - Hover tooltip on first click: `點兩下清除房間連線（保留暱稱）`.

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
  resultPending: boolean;             // true during the 5s game_over → return_to_lobby delay; blocks vote_play
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
| `room_joined` | `{ roomCode, members, state, playerIds, seq, winCounts, phase, reconnectToken?, reconnect?, currentTurn?, landlordIndex?, landlordCards?, lastPlay?, playerCardCounts? }` | Full state snapshot — sent on join, rejoin, and sync. `winCounts` and `phase` always present. Gameplay fields only present when reconnecting mid-game. |
| `members_update` | `{ members: [{id, nickname, role, cardCount, wantToPlay}], readyCount, canVote, seq }` | Full member list broadcast whenever membership, role, or `wantToPlay` changes. `readyCount` is the authoritative count of members with `wantToPlay=true`. `canVote` is `true` when the room is in `waiting` state (voting is always available regardless of member count). Also emitted immediately after `vote_closed_start` to push updated roles. |
| `vote_closed_start` | `{ players: [{id,nickname}], spectators: [{id,nickname}], phase: ‘dealing’, seq }` | 3 members ready — roles locked, game starting in 3s. Followed immediately by `members_update` with authoritative roles. |
| `game_start` | `{ hand: Card[], firstBidder, phase: ‘dealing’, reconnect? }` | Unicast — game begins; players get hand, spectators get empty hand. On reconnect, only restores hand (phase already set by `room_joined`). |
| `bid_open` | `{ timeoutMs: 8000, phase: ‘bidding’, seq }` | Simultaneous bid window is open. Each player also receives a unicast `bid_status` immediately after. |
| `bid_status` | `{ submitted: boolean }` | Unicast — tells the receiving player whether they have already cast their landlord bid. Sent after `bid_open` and on reconnect via `bid_turn`. |
| `bid_turn` | `{ playerIndex, currentBid, submitted }` | Unicast to reconnected player only — restores bidding UI state including whether the player already voted. |
| `bid_made` | `{ playerIndex, value, votedCount, seq }` | A player placed a bid. `votedCount` is the authoritative total number of players who have voted so far. |
| `landlord_decided` | `{ playerIndex, landlordCards, playerCardCounts, phase: ‘gameplay’, seq }` | Landlord chosen; 3 face-down cards revealed to all; authoritative card counts for all 3 players included. Followed by a unicast `hand_updated` to the landlord. |
| `hand_updated` | `{ hand: Card[] }` | Unicast — full sorted hand. Sent to the landlord after receiving the 3 bottom cards, and to any player after every successful `play_cards`. Clients must not modify their hand locally. |
| `game_state` | `{ currentPlayer, currentPlayerEndTime, onTable, history, playerCardCounts, landlordIndex, landlordCards, playerHands: Card[][], phase, seq }` | Broadcast after every gameplay action. `playerHands` contains all 3 players’ current hands indexed by `playerOrder`; used by spectators to browse hands. Players receive this but the UI does not render opponent hands for them. |
| `your_turn` | `{}` | Unicast — it’s your turn to play |
| `cards_played` | `{ playerIndex, cards, handType, rank, remaining, seq }` | Cards were played |
| `turn_changed` | `{ nextTurn, seq }` | Current turn index changed (emitted after every play or pass) |
| `player_passed` | `{ playerIndex, seq }` | A player passed |
| `new_round` | `{ nextTurn, seq }` | Two passes — new lead round; `lastPlay` resets to null |
| `game_over` | `{ winner: ‘landlord’\|’peasants’, landlordIndex, winnerIds: string[], winCounts, phase: ‘result’, seq }` | Game ended; win overlay shown. `winnerIds` is the authoritative list of winning socket IDs. `return_to_lobby` follows after 5s. |
| `return_to_lobby` | `{ phase: ‘lobby’, seq }` | Emitted 5s after `game_over` — all clients reset to lobby screen; `members_update` follows immediately |
| `player_disconnected` | `{ nickname, timeoutMs: 15000, seq }` | A player dropped mid-game; reconnect window started. Other players see a waiting overlay. |
| `player_reconnected` | `{ nickname, playerIds, seq }` | Disconnected player successfully rejoined; `playerIds` carries the updated slot assignments (new socket ID) so all clients can re-render that player’s seat. Overlay dismissed, game continues. |
| `game_aborted` | `{ phase: ‘lobby’, seq }` | Game aborted (reconnect window expired); all flags cleared, back to waiting |
| `room_disbanded` | `{ reason }` | Room closed (all members left, 5-min idle timeout) |
| `invalid_play` | `{ reason }` | Played cards are invalid |
| `room_error` | `{ message }` | Room-related error (e.g. join failed, rate limit, reconnect failed) |
| `emoji_reaction` | `{ senderId, senderNickname, role: ‘player’\|’spectator’, emoji }` | Broadcast emoji reaction/phrase to room |

### 6.4 Game Logic Flow (Server-Side)

```
── UNIFIED ROOM STATE MACHINE ──────────────────────────────

── SERVER AUTHORITY PRINCIPLE ───────────────────────────────

  The backend is the sole source of truth for all game state and phase transitions.
  Clients never derive phase, compute card counts, or mutate their hand locally.
  Specifically:
    - Every phase transition is delivered as an explicit `phase` field in a server event.
    - `members_update` carries `readyCount` and `canVote` so the UI never computes them.
    - `bid_made` carries `votedCount` so the UI never self-increments a local counter.
    - `game_over` carries `winnerIds` (socket IDs) so the UI never derives winners from landlordIndex.
    - `hand_updated` is sent after every successful play so clients never remove cards locally.
    - A 30-second server-side `turnTimer` auto-passes for idle players; the client
      countdown is display-only and has no game-state side effects.

state: ‘waiting’
  - Everyone in the room is a spectator; all wantToPlay flags are false.
  - New members can join at any time.
  - Any member can toggle wantToPlay via vote_play at any time (no minimum member count required).
  - On every toggle, members_update is broadcast with the full member list
    (includes readyCount and canVote).
  - Transition → ‘playing’ the instant exactly 3 members have wantToPlay = true.
  - No timeout, no separate ‘voting’ state.
  - On transition: vote_closed_start { phase: ‘dealing’ } broadcast, then members_update
    broadcast with authoritative roles (players vs spectators).

state: ‘playing’  (encompasses bidding + gameplay sub-states)
  - The 3 players are locked in playerIds[]; wantToPlay flags are no longer relevant.
  - Sub-state: ‘bidding’
      Shuffle & deal 17 cards each (sorted highest→lowest), set aside 3 landlord cards.
      Spectators receive no cards.
      Random first bidder index assigned (stored as `firstBidder`).
      Server deals cards to all players via unicast `game_start { phase: ‘dealing’ }`,
      waits ~2 seconds, then emits `bid_open { timeoutMs: 8000, phase: ‘bidding’ }`.
      Each player also receives a unicast `bid_status { submitted }` right after bid_open.
      An 8-second server-side timer (`bidTimer`) enforces the deadline.
      The round resolves when all 3 have voted OR the timer fires:
        - 1 or more voted yes → system randomly picks one of the yes-voters.
        - Nobody voted yes → system randomly assigns one of the 3 players.
      (There is no re-deal; landlord is always determined in one round.)
      Landlord receives the 3 bottom cards (sorted into their hand, 20 total).
      landlord_decided { phase: ‘gameplay’ } broadcast includes playerCardCounts.
      Unicast hand_updated sent to landlord with their full 20-card hand.
  - Sub-state: ‘gameplay’
      Landlord plays first.
      A 30-second server-side turn timer (`turnTimer`) starts when each turn begins.
      If the timer fires, the server calls handlePass on behalf of the idle player.
      Validate each play against hand type rules.
      After every successful play: unicast hand_updated to the player who played,
      then emit turn_changed { nextTurn } to all clients and your_turn {} to the next player.
      Track consecutive passes.
      Two consecutive passes → new round (last player leads), `new_round { nextTurn }` broadcast.
  - When a player’s hand is empty:
      If Landlord → Landlord wins.
      If Peasant → Peasants win.
  - On game end:
      game_over { phase: ‘result’, winnerIds, winCounts } broadcast → win overlay shown.
      All wantToPlay flags cleared; all members reverted to spectator.
      After 5-second delay:
        return_to_lobby { phase: ‘lobby’ } broadcast → all clients reset to lobby screen.
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
        playerCardCounts, winCounts) unicast via room_joined + game_start.
        player_reconnected { nickname, playerIds } broadcast → other clients update
        their playerOrder to the new socket ID so the seat re-renders correctly.
        Overlay dismissed, game continues.
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
| Player disconnects during 'playing' | 15-second grace period — `player_disconnected` broadcast; member stays in room with `disconnectedAt` set, filtered from `members_update`. If reconnected → full state unicast (`room_joined` with `winCounts` + `game_start`), `player_reconnected { nickname, playerIds }` broadcast (so other clients update their seat mapping to the new socket ID) + `members_update`. If timer expires → `game_aborted`, all flags cleared, room back to 'waiting'. |
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
- Server matches token → updates socket ID → restores full game state via `room_joined` (includes `winCounts` always) + `game_start` unicast.
- Token is rotated on every successful reconnect to prevent replay attacks.
- If `rejoin` fails (room gone, token expired) → server emits `room_error` → client clears the stale token and shows the home screen.
- "← 離開房間" button clears the token explicitly so a page refresh after leaving returns to the home screen.

---

## 8. Security Considerations

- **Input validation**: All incoming events are validated (nickname length, card legality, turn order).
- **Anti-cheat**: The server is the source of truth — clients only receive their own hand via the unicast `hand_updated` event. All three players' hands are additionally broadcast in `game_state` as `playerHands` for spectator viewing; players receive this data but the UI does not render it for them.
- **Rate limiting**: Max 10 events/second per socket; emoji reactions additionally capped at 1 per 500 ms per socket.
- **Emoji allowlist**: Server enforces `ALLOWED_REACTIONS` set in `game.gateway.ts` — any unlisted value is silently dropped.
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
│   │   ├── favicon.ico
│   │   └── sounds/
│   │       ├── card-play.wav       # Game event sounds
│   │       ├── pass.mp3
│   │       ├── your-turn.mp3
│   │       ├── deal.mp3
│   │       ├── win.mp3
│   │       ├── lose.mp3
│   │       ├── landlord.mp3
│   │       ├── game-ready.mp3
│   │       └── emoji/              # Per-reaction sounds (optional)
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
│   │   │   ├── Countdown.tsx
│   │   │   └── VolumeControl.tsx   # Fixed top-left volume widget
│   │   ├── hooks/
│   │   │   ├── useSocket.ts
│   │   │   ├── useGame.ts
│   │   │   └── useSoundEffects.ts  # Game event + emoji sounds, volume control
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
- ✅ Sound effects (game events + per-emoji sounds + volume control)
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
