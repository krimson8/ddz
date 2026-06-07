"use client";

import { useCallback, useEffect, useReducer, useRef } from "react";
import { useSocket } from "@/hooks/useSocket";
import type {
  Card,
  ClientMember,
  GameState,
  GamePhase,
  HistoryEntry,
  Play,
  RoleSlot,
} from "@/features/ddz/types";

// ── Initial State ────────────────────────────────────────────────────────────

const initialState: GameState = {
  phase: "lobby",
  roomCode: null,
  members: [],
  playerOrder: [],
  myHand: [],
  landlordCards: null,
  playerHands: [],
  landlordIndex: null,
  currentPlayer: null,
  currentPlayerEndTime: null,
  currentBid: 0,
  bidVotedCount: 0,
  bidTimeoutMs: 8000,
  bidSubmitted: false,
  roleSlots: [
    { pickedBy: null, role: null },
    { pickedBy: null, role: null },
    { pickedBy: null, role: null },
  ],
  roleSubmitted: false,
  roleLocked: false,
  roleDeck: null,
  lastPlay: null,
  winner: null,
  winnerIds: [],
  winningCards: [],
  playHistory: [],
  playerCardCounts: [],
  lastPlayedBy: null,
  winCounts: {},
  readyCount: 0,
  canVote: false,
  disconnectedPlayer: null,
  winReason: "normal",
  surrendered: [],
};

// ── Actions ──────────────────────────────────────────────────────────────────

type Action =
  | {
      type: "ROOM_JOINED";
      roomCode: string;
      members: ClientMember[];
      playerIds: string[];
      winCounts: Record<string, number>;
      phase?: GamePhase;
      readyCount?: number;
      canVote?: boolean;
    }
  | { type: "MEMBERS_UPDATE"; members: ClientMember[]; readyCount: number; canVote: boolean }
  | { type: "VOTE_CLOSED_START"; playerIds: string[]; phase: GamePhase }
  | { type: "GAME_ABORTED"; phase: GamePhase }
  | { type: "RETURN_TO_LOBBY"; phase: GamePhase }
  | { type: "GAME_START"; hand: Card[]; firstBidder: number; phase: GamePhase; reconnect?: boolean }
  | { type: "BID_OPEN"; timeoutMs: number; phase: GamePhase }
  | { type: "BID_STATUS"; submitted: boolean }
  | { type: "BID_TURN"; playerIndex: number; currentBid: number; submitted?: boolean }
  | { type: "BID_MADE"; value: number; votedCount: number }
  | {
      type: "ROLE_DRAW_OPEN";
      revealed?: ({ slotIndex: number; playerIndex: number; role: "landlord" | "peasant" } | null)[];
      submitted?: boolean;
    }
  | { type: "ROLE_PICKED"; slotIndex: number; playerIndex: number; role: "landlord" | "peasant" }
  | { type: "ROLE_SUBMIT" }
  | { type: "ROLE_DRAW_LOCKED"; roleDeck: ("landlord" | "peasant")[] }
  | { type: "ROLE_REVEAL_FOR_FUN"; slotIndex: number }
  | {
      type: "LANDLORD_DECIDED";
      landlordIndex: number;
      landlordCards: Card[];
      playerCardCounts: number[];
      phase: GamePhase;
    }
  | { type: "HAND_UPDATED"; hand: Card[] }
  | {
      type: "GAME_STATE";
      currentPlayer: string | null;
      currentPlayerEndTime: number;
      onTable: Play | null;
      history: HistoryEntry[];
      playerCardCounts: number[];
      landlordIndex: number;
      landlordCards: Card[];
      playerHands: Card[][];
      phase: GamePhase;
      surrendered: number[];
    }
  | { type: "GAME_OVER"; winner: "landlord" | "peasants"; winReason: "normal" | "surrender"; winCounts: Record<string, number>; winnerIds: string[]; winningCards: Card[]; phase: GamePhase }
  | { type: "SURRENDER_UPDATE"; surrendered: number[] }
  | { type: "TURN_CHANGED"; nextTurn: number }
  | { type: "PLAYER_DISCONNECTED"; nickname: string; endTime: number; timeoutMs: number }
  | { type: "PLAYER_RECONNECTED"; playerIds: string[] }
  | { type: "LEFT_ROOM" }
  | { type: "ERROR"; message: string };

function reducer(state: GameState, action: Action): GameState {
  switch (action.type) {
    case "ROOM_JOINED": {
      return {
        ...state,
        roomCode: action.roomCode,
        members: action.members,
        playerOrder: action.playerIds,
        winCounts: action.winCounts,
        phase: action.phase ?? (action.playerIds.length > 0 ? state.phase : "lobby"),
        readyCount: action.readyCount ?? state.readyCount,
        canVote: action.canVote ?? state.canVote,
      };
    }
    case "LEFT_ROOM":
      return { ...initialState };
    case "MEMBERS_UPDATE":
      return { ...state, members: action.members, readyCount: action.readyCount, canVote: action.canVote };
    case "VOTE_CLOSED_START":
      return {
        ...state,
        phase: action.phase,
        playerOrder: action.playerIds,
        lastPlay: null,
        lastPlayedBy: null,
      };
    case "GAME_ABORTED":
      return {
        ...initialState,
        roomCode: state.roomCode,
        members: state.members.map((m) => ({ ...m, wantToPlay: false })),
        winCounts: state.winCounts,
        phase: action.phase,
      };
    case "RETURN_TO_LOBBY":
      return {
        ...initialState,
        roomCode: state.roomCode,
        members: state.members.map((m) => ({ ...m, wantToPlay: false })),
        winCounts: state.winCounts,
        phase: action.phase,
      };
    case "GAME_START":
      if (action.reconnect) {
        return { ...state, myHand: action.hand };
      }
      return {
        ...state,
        myHand: action.hand,
        phase: action.phase,
        playHistory: [],
        lastPlay: null,
        lastPlayedBy: null,
        currentPlayer: null,
        currentPlayerEndTime: null,
        surrendered: [],
        winReason: "normal",
      };
    case "BID_OPEN":
      return { ...state, phase: action.phase, bidVotedCount: 0, bidSubmitted: false, bidTimeoutMs: action.timeoutMs };
    case "BID_STATUS":
      return { ...state, bidSubmitted: action.submitted };
    case "BID_TURN":
      return {
        ...state,
        currentBid: action.currentBid,
        phase: "bidding",
        ...(action.submitted !== undefined ? { bidSubmitted: action.submitted } : {}),
      };
    case "BID_MADE":
      return {
        ...state,
        currentBid: action.value > 0 ? action.value : state.currentBid,
        bidVotedCount: action.votedCount,
      };
    case "ROLE_DRAW_OPEN": {
      // Rebuild the three slots, applying any already-revealed picks (reconnect).
      const slots: RoleSlot[] = [
        { pickedBy: null, role: null },
        { pickedBy: null, role: null },
        { pickedBy: null, role: null },
      ];
      for (const r of action.revealed ?? []) {
        if (r) slots[r.slotIndex] = { pickedBy: r.playerIndex, role: r.role };
      }
      return {
        ...state,
        phase: "roledraw",
        roleSlots: slots,
        roleSubmitted: action.submitted ?? false,
        roleLocked: false,
        roleDeck: null,
      };
    }
    case "ROLE_PICKED": {
      const slots = state.roleSlots.map((s, i) =>
        i === action.slotIndex
          ? { pickedBy: action.playerIndex, role: action.role }
          : s,
      );
      return { ...state, roleSlots: slots };
    }
    case "ROLE_SUBMIT":
      return { ...state, roleSubmitted: true };
    case "ROLE_DRAW_LOCKED":
      return { ...state, roleLocked: true, roleDeck: action.roleDeck };
    case "ROLE_REVEAL_FOR_FUN": {
      // Locally flip the leftover card for fun (no backend effect). Uses the
      // full deck sent on lock; ownership stays null since nobody claimed it.
      if (!state.roleDeck) return state;
      if (state.roleSlots[action.slotIndex].role !== null) return state;
      const slots = state.roleSlots.map((s, i) =>
        i === action.slotIndex
          ? { pickedBy: null, role: state.roleDeck![action.slotIndex] }
          : s,
      );
      return { ...state, roleSlots: slots };
    }
    case "LANDLORD_DECIDED":
      return {
        ...state,
        landlordIndex: action.landlordIndex,
        landlordCards: action.landlordCards,
        phase: action.phase,
        playerCardCounts: action.playerCardCounts,
      };
    case "HAND_UPDATED":
      return { ...state, myHand: action.hand };
    case "GAME_STATE": {
      const lastHistoryEntry = action.history.length > 0
        ? action.history[action.history.length - 1]
        : null;
      const lastPlayedBySocketId = lastHistoryEntry !== null
        ? (state.playerOrder[lastHistoryEntry.playerIndex] ?? null)
        : null;
      return {
        ...state,
        phase: action.phase,
        currentPlayer: action.currentPlayer,
        currentPlayerEndTime: action.currentPlayerEndTime,
        lastPlay: action.onTable,
        lastPlayedBy: lastPlayedBySocketId,
        playHistory: action.history,
        playerCardCounts: action.playerCardCounts,
        landlordIndex: action.landlordIndex,
        landlordCards: action.landlordCards,
        playerHands: action.playerHands,
        surrendered: action.surrendered,
      };
    }
    case "PLAYER_DISCONNECTED":
      return { ...state, disconnectedPlayer: { nickname: action.nickname, endTime: action.endTime, timeoutMs: action.timeoutMs } };
    case "PLAYER_RECONNECTED":
      return {
        ...state,
        disconnectedPlayer: null,
        playerOrder: action.playerIds.length > 0 ? action.playerIds : state.playerOrder,
      };
    case "GAME_OVER":
      return {
        ...state,
        phase: action.phase,
        winner: action.winner,
        winReason: action.winReason,
        winnerIds: action.winnerIds,
        winningCards: action.winningCards,
        winCounts: action.winCounts,
        disconnectedPlayer: null,
      };
    case "SURRENDER_UPDATE":
      return { ...state, surrendered: action.surrendered };
    case "TURN_CHANGED":
      return { ...state, currentPlayer: state.playerOrder[action.nextTurn] ?? null };
    default:
      return state;
  }
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export interface UseGameReturn {
  gameState: GameState;
  createRoom: () => void;
  joinRoom: (code: string) => void;
  leaveRoom: () => void;
  votePlay: () => void;
  bid: (amount: 0 | 1) => void;
  pickRole: (slotIndex: number) => void;
  revealRoleForFun: (slotIndex: number) => void;
  playCards: (cards: Card[]) => void;
  pass: () => void;
  surrender: () => void;
}

export function useGame(): UseGameReturn {
  const socket = useSocket("ddz");
  const [gameState, dispatch] = useReducer(reducer, initialState);

  // Keep a ref so event handlers always see the latest state (avoids stale closures).
  const gameStateRef = useRef(initialState);
  gameStateRef.current = gameState;

  // Sequence number tracking for divergence detection.
  const seqRef = useRef(0);
  const roomCodeRef = useRef<string | null>(null);

  // Subscribe to all server→client events
  useEffect(() => {
    // Returns true if the event is in-order; requests a resync and returns false if not.
    function checkSeq(seq: number | undefined): boolean {
      if (seq === undefined) return true; // unicast — no seq tracking
      if (seq === seqRef.current + 1) {
        seqRef.current = seq;
        return true;
      }
      const roomCode = roomCodeRef.current;
      if (roomCode) socket.emit("sync_request", { roomCode });
      return false;
    }

    socket.on(
      "room_joined",
      (data: {
        roomCode: string;
        members: ClientMember[];
        playerIds?: string[];
        winCounts?: Record<string, number>;
        phase?: GamePhase;
        seq?: number;
        readyCount?: number;
        canVote?: boolean;
      }) => {
        if (typeof data.seq === "number") seqRef.current = data.seq;
        roomCodeRef.current = data.roomCode;
        dispatch({
          type: "ROOM_JOINED",
          roomCode: data.roomCode,
          members: data.members,
          playerIds: data.playerIds ?? [],
          winCounts: data.winCounts ?? {},
          phase: data.phase,
          readyCount: data.readyCount,
          canVote: data.canVote,
        });
      },
    );

    socket.on("room_created", (data: { roomCode: string }) => {
      roomCodeRef.current = data.roomCode;
      seqRef.current = 0;
      dispatch({ type: "ROOM_JOINED", roomCode: data.roomCode, members: [], playerIds: [], winCounts: {} });
    });

    socket.on("members_update", (data: { members: ClientMember[]; readyCount?: number; canVote?: boolean; seq?: number }) => {
      if (!checkSeq(data.seq)) return;
      dispatch({
        type: "MEMBERS_UPDATE",
        members: data.members,
        readyCount: data.readyCount ?? 0,
        canVote: data.canVote ?? false,
      });
    });

    socket.on("game_aborted", (data: { phase?: GamePhase; seq?: number } = {}) => {
      if (!checkSeq(data.seq)) return;
      dispatch({ type: "GAME_ABORTED", phase: data.phase ?? "lobby" });
    });

    socket.on(
      "vote_closed_start",
      (data: { players: { id: string; nickname: string }[]; phase?: GamePhase; seq?: number }) => {
        if (!checkSeq(data.seq)) return;
        dispatch({
          type: "VOTE_CLOSED_START",
          playerIds: (data?.players ?? []).map((p) => p.id),
          phase: data.phase ?? "dealing",
        });
      },
    );

    socket.on("game_start", (data: { hand: Card[]; firstBidder: number; phase?: GamePhase; reconnect?: boolean }) => {
      dispatch({
        type: "GAME_START",
        hand: data.hand,
        firstBidder: data.firstBidder,
        phase: data.phase ?? "dealing",
        reconnect: data.reconnect,
      });
    });

    socket.on("bid_open", (data: { timeoutMs?: number; phase?: GamePhase; seq?: number } = {}) => {
      if (!checkSeq(data.seq)) return;
      dispatch({ type: "BID_OPEN", timeoutMs: data.timeoutMs ?? 8000, phase: data.phase ?? "bidding" });
    });

    socket.on("bid_status", (data: { submitted: boolean }) => {
      dispatch({ type: "BID_STATUS", submitted: data.submitted });
    });

    socket.on(
      "bid_turn",
      (data: { playerIndex: number; currentBid: number; submitted?: boolean }) => {
        dispatch({
          type: "BID_TURN",
          playerIndex: data.playerIndex,
          currentBid: data.currentBid,
          submitted: data.submitted,
        });
      },
    );

    socket.on("bid_made", (data: { playerIndex: number; value: number; votedCount?: number; seq?: number }) => {
      if (!checkSeq(data.seq)) return;
      dispatch({ type: "BID_MADE", value: data.value, votedCount: data.votedCount ?? 0 });
    });

    socket.on(
      "role_draw_open",
      (
        data: {
          revealed?: ({ slotIndex: number; playerIndex: number; role: "landlord" | "peasant" } | null)[];
          submitted?: boolean;
          seq?: number;
        } = {},
      ) => {
        if (!checkSeq(data.seq)) return;
        dispatch({ type: "ROLE_DRAW_OPEN", revealed: data.revealed, submitted: data.submitted });
      },
    );

    socket.on(
      "role_picked",
      (data: { slotIndex: number; playerIndex: number; role: "landlord" | "peasant"; seq?: number }) => {
        if (!checkSeq(data.seq)) return;
        dispatch({
          type: "ROLE_PICKED",
          slotIndex: data.slotIndex,
          playerIndex: data.playerIndex,
          role: data.role,
        });
      },
    );

    socket.on(
      "role_draw_locked",
      (data: { landlordIndex: number; roleDeck: ("landlord" | "peasant")[]; seq?: number }) => {
        if (!checkSeq(data.seq)) return;
        dispatch({ type: "ROLE_DRAW_LOCKED", roleDeck: data.roleDeck });
      },
    );

    socket.on(
      "landlord_decided",
      (data: { playerIndex: number; landlordCards: Card[]; playerCardCounts: number[]; phase?: GamePhase; seq?: number }) => {
        if (!checkSeq(data.seq)) return;
        dispatch({
          type: "LANDLORD_DECIDED",
          landlordIndex: data.playerIndex,
          landlordCards: data.landlordCards,
          playerCardCounts: data.playerCardCounts,
          phase: data.phase ?? "gameplay",
        });
      },
    );

    socket.on("hand_updated", (data: { hand: Card[] }) => {
      dispatch({ type: "HAND_UPDATED", hand: data.hand });
    });

    socket.on(
      "game_state",
      (data: {
        currentPlayer: string | null;
        currentPlayerEndTime: number;
        onTable: Play | null;
        history: HistoryEntry[];
        playerCardCounts: number[];
        landlordIndex: number;
        landlordCards: Card[];
        playerHands: Card[][];
        phase: GamePhase;
        surrendered?: number[];
        seq?: number;
      }) => {
        if (!checkSeq(data.seq)) return;
        dispatch({
          type: "GAME_STATE",
          currentPlayer: data.currentPlayer,
          currentPlayerEndTime: data.currentPlayerEndTime,
          onTable: data.onTable,
          history: data.history,
          playerCardCounts: data.playerCardCounts,
          landlordIndex: data.landlordIndex,
          landlordCards: data.landlordCards,
          playerHands: data.playerHands ?? [],
          phase: data.phase,
          surrendered: data.surrendered ?? [],
        });
      },
    );

    socket.on("game_over", (data: { winner: "landlord" | "peasants"; winReason?: "normal" | "surrender"; winCounts: Record<string, number>; winnerIds?: string[]; winningCards?: Card[]; phase?: GamePhase; seq?: number }) => {
      // Always apply game_over — it's an authoritative phase transition.
      // Advancing the seq here keeps subsequent in-order events accepted.
      if (typeof data.seq === "number") seqRef.current = data.seq;
      dispatch({
        type: "GAME_OVER",
        winner: data.winner,
        winReason: data.winReason ?? "normal",
        winCounts: data.winCounts ?? {},
        winnerIds: data.winnerIds ?? [],
        winningCards: data.winningCards ?? [],
        phase: data.phase ?? "result",
      });
    });

    socket.on("surrender_update", (data: { surrendered: number[]; seq?: number }) => {
      if (!checkSeq(data.seq)) return;
      dispatch({ type: "SURRENDER_UPDATE", surrendered: data.surrendered ?? [] });
    });

    socket.on("turn_changed", (data: { nextTurn: number; seq?: number }) => {
      if (!checkSeq(data.seq)) return;
      dispatch({ type: "TURN_CHANGED", nextTurn: data.nextTurn });
    });

    socket.on("left_room", () => {
      roomCodeRef.current = null;
      seqRef.current = 0;
      dispatch({ type: "LEFT_ROOM" });
    });

    socket.on("return_to_lobby", (data: { phase?: GamePhase; seq?: number } = {}) => {
      // Always apply return_to_lobby — seq gaps during the 5s result window
      // (e.g. spectator join, emoji) would cause checkSeq to drop this event.
      if (typeof data.seq === "number") seqRef.current = data.seq;
      dispatch({ type: "RETURN_TO_LOBBY", phase: data.phase ?? "lobby" });
    });

    socket.on("player_disconnected", (data: { nickname: string; endTime: number; timeoutMs: number; seq?: number }) => {
      if (!checkSeq(data.seq)) return;
      dispatch({ type: "PLAYER_DISCONNECTED", nickname: data.nickname, endTime: data.endTime, timeoutMs: data.timeoutMs });
    });

    socket.on("player_reconnected", (data: { nickname: string; playerIds?: string[]; seq?: number }) => {
      if (!checkSeq(data.seq)) return;
      dispatch({ type: "PLAYER_RECONNECTED", playerIds: data.playerIds ?? [] });
    });

    return () => {
      socket.off("room_joined");
      socket.off("room_created");
      socket.off("members_update");
      socket.off("game_aborted");
      socket.off("vote_closed_start");
      socket.off("game_start");
      socket.off("bid_open");
      socket.off("bid_status");
      socket.off("bid_turn");
      socket.off("bid_made");
      socket.off("role_draw_open");
      socket.off("role_picked");
      socket.off("role_draw_locked");
      socket.off("landlord_decided");
      socket.off("hand_updated");
      socket.off("game_state");
      socket.off("game_over");
      socket.off("surrender_update");
      socket.off("left_room");
      socket.off("return_to_lobby");
      socket.off("player_disconnected");
      socket.off("player_reconnected");
    };
  }, [socket]);

  // ── Actions ──────────────────────────────────────────────────────────────

  const createRoom = useCallback(
    () => { socket.emit("create_room"); },
    [socket],
  );

  const joinRoom = useCallback(
    (code: string) => {
      socket.emit("join_room", { code });
    },
    [socket],
  );

  const leaveRoom = useCallback(() => {
    // Do NOT reset state here — wait for server to confirm via members_update / room_disbanded
    socket.emit("leave_room");
  }, [socket]);

  const votePlay = useCallback(() => { socket.emit("vote_play"); }, [socket]);

  const bid = useCallback(
    (amount: 0 | 1) => { socket.emit("bid", { value: amount }); },
    [socket],
  );

  const pickRole = useCallback(
    (slotIndex: number) => {
      // Lock the local UI immediately — a player may only claim one card.
      dispatch({ type: "ROLE_SUBMIT" });
      socket.emit("role_pick", { slotIndex });
    },
    [socket],
  );

  // After the draw is locked, the leftover card can be flipped for fun — this
  // is purely local (the backend already sent the full deck and ignores picks).
  const revealRoleForFun = useCallback(
    (slotIndex: number) => { dispatch({ type: "ROLE_REVEAL_FOR_FUN", slotIndex }); },
    [],
  );

  const playCards = useCallback(
    (cards: Card[]) => { socket.emit("play_cards", { cards }); },
    [socket],
  );

  const pass = useCallback(() => { socket.emit("pass"); }, [socket]);

  const surrender = useCallback(() => { socket.emit("surrender"); }, [socket]);

  return { gameState, createRoom, joinRoom, leaveRoom, votePlay, bid, pickRole, revealRoleForFun, playCards, pass, surrender };
}
