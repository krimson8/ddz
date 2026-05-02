"use client";

import { useCallback, useEffect, useReducer, useRef } from "react";
import { useSocket } from "./useSocket";
import type {
  Card,
  ClientMember,
  GameState,
  HistoryEntry,
  Play,
} from "@/types/game";

// ── Card sorting ──────────────────────────────────────────────────────────────────

const SUIT_PRIORITY: Record<string, number> = {
  spade: 3,
  heart: 2,
  club: 1,
  diamond: 0,
  joker: -1,
};

function sortHand(cards: Card[]): Card[] {
  return [...cards].sort((a, b) => {
    if (b.rank !== a.rank) return b.rank - a.rank;
    return (SUIT_PRIORITY[b.suit] ?? -1) - (SUIT_PRIORITY[a.suit] ?? -1);
  });
}

function removePlayedCards(hand: Card[], played: Card[]): Card[] {
  const remaining = [...hand];
  for (const card of played) {
    const idx = remaining.findIndex(
      (c) => c.suit === card.suit && c.rank === card.rank,
    );
    if (idx !== -1) remaining.splice(idx, 1);
  }
  return remaining;
}

// ── Initial State ────────────────────────────────────────────────────────────

const initialState: GameState = {
  phase: "lobby",
  roomCode: null,
  members: [],
  playerOrder: [],
  myHand: [],
  landlordCards: null,
  landlordIndex: null,
  currentTurn: null,
  currentBid: 0,
  bidVotedCount: 0,
  bidSubmitted: false,
  lastPlay: null,
  winner: null,
  playHistory: [],
  playerCardCounts: [],
  lastPlayPlayerIndex: null,
  winCounts: {},
  disconnectedPlayer: null,
};

// ── Actions ──────────────────────────────────────────────────────────────────

type Action =
  | {
      type: "ROOM_JOINED";
      roomCode: string;
      members: ClientMember[];
      playerIds: string[];
      // Present only on mid-game reconnect
      currentTurn?: number;
      landlordIndex?: number;
      landlordCards?: Card[];
      lastPlay?: Play | null;
      playerCardCounts?: number[];
    }
  | { type: "MEMBERS_UPDATE"; members: ClientMember[] }
  | { type: "VOTE_CLOSED_START"; playerIds: string[] }
  | { type: "GAME_ABORTED" }
  | { type: "GAME_START"; hand: Card[]; firstBidder: number; reconnect?: boolean }
  | { type: "BID_OPEN" }
  | { type: "BID_STATUS"; submitted: boolean }
  | { type: "BID_TURN"; playerIndex: number; currentBid: number; submitted?: boolean }
  | { type: "BID_MADE"; value: number; isMyBid: boolean }
  | {
      type: "LANDLORD_DECIDED";
      landlordIndex: number;
      landlordCards: Card[];
      playerCardCounts: number[];
    }
  | { type: "HAND_UPDATED"; hand: Card[] }
  | {
      type: "CARDS_PLAYED";
      play: Play;
      playerIndex: number;
      nextTurn: number;
      isMyPlay: boolean;
      remaining: number;
    }
  | { type: "PLAYER_PASSED"; playerIndex: number; nextTurn: number }
  | { type: "TURN_CHANGED"; nextTurn: number }
  | { type: "NEW_ROUND"; nextTurn: number }
  | { type: "GAME_OVER"; winner: "landlord" | "peasants"; winCounts: Record<string, number> }
  | { type: "PLAYER_DISCONNECTED"; nickname: string; timeoutMs: number }
  | { type: "PLAYER_RECONNECTED"; playerIds: string[] }
  | { type: "ERROR"; message: string };

function reducer(state: GameState, action: Action): GameState {
  switch (action.type) {
    case "ROOM_JOINED": {
      const isReconnect = action.playerIds.length > 0 && action.currentTurn !== undefined;
      return {
        ...state,
        roomCode: action.roomCode,
        members: action.members,
        playerOrder: action.playerIds,
        phase: action.playerIds.length > 0 ? state.phase : "lobby",
        ...(isReconnect ? {
          currentTurn: action.currentTurn!,
          landlordIndex: action.landlordIndex ?? null,
          landlordCards: action.landlordCards ?? null,
          lastPlay: action.lastPlay ?? null,
          playerCardCounts: action.playerCardCounts ?? state.playerCardCounts,
          phase: action.landlordIndex !== undefined && action.landlordIndex >= 0 ? "gameplay" : "bidding",
        } : {}),
      };
    }
    case "MEMBERS_UPDATE":
      return { ...state, members: action.members };
    case "VOTE_CLOSED_START":
      // Roles are broadcast via the members_update that follows this event.
      return {
        ...state,
        phase: "dealing",
        playerOrder: action.playerIds,
        lastPlay: null,
        lastPlayPlayerIndex: null,
      };
    case "GAME_ABORTED":
      return {
        ...initialState,
        roomCode: state.roomCode,
        members: state.members,
        winCounts: state.winCounts,
      };
    case "GAME_START":
      if (action.reconnect) {
        // Mid-game reconnect: only restore the hand, phase/turn already set by ROOM_JOINED
        return { ...state, myHand: sortHand(action.hand) };
      }
      // Fresh deal — show hand in 'dealing' phase; bidding panel not yet shown.
      return {
        ...state,
        myHand: sortHand(action.hand),
        currentTurn: action.firstBidder,
        phase: "dealing",
        playHistory: [],
        lastPlay: null,
        lastPlayPlayerIndex: null,
      };
    case "BID_OPEN":
      return { ...state, phase: "bidding", bidVotedCount: 0, bidSubmitted: false };
    case "BID_STATUS":
      return { ...state, bidSubmitted: action.submitted };
    case "BID_TURN":
      return {
        ...state,
        currentTurn: action.playerIndex,
        currentBid: action.currentBid,
        phase: "bidding",
        ...(action.submitted !== undefined ? { bidSubmitted: action.submitted } : {}),
      };
    case "BID_MADE":
      return {
        ...state,
        currentBid: action.value > 0 ? action.value : state.currentBid,
        bidVotedCount: state.bidVotedCount + 1,
        ...(action.isMyBid ? { bidSubmitted: true } : {}),
      };
    case "LANDLORD_DECIDED":
      return {
        ...state,
        landlordIndex: action.landlordIndex,
        landlordCards: action.landlordCards,
        phase: "gameplay",
        currentTurn: action.landlordIndex,
        playerCardCounts: action.playerCardCounts,
      };
    case "HAND_UPDATED":
      return { ...state, myHand: sortHand(action.hand) };
    case "CARDS_PLAYED": {
      // Update card count for the player who just played
      const newCounts = [...state.playerCardCounts];
      newCounts[action.playerIndex] = action.remaining;
      return {
        ...state,
        lastPlay: action.play,
        lastPlayPlayerIndex: action.playerIndex,
        playHistory: [
          ...state.playHistory,
          {
            playerIndex: action.playerIndex,
            play: action.play,
          } as HistoryEntry,
        ],
        myHand: action.isMyPlay
          ? removePlayedCards(state.myHand, action.play.cards)
          : state.myHand,
        playerCardCounts: newCounts,
      };
    }
    case "PLAYER_PASSED":
      // turn_changed (or new_round) will update currentTurn.
      return state;
    case "TURN_CHANGED":
      return { ...state, currentTurn: action.nextTurn };
    case "NEW_ROUND":
      return {
        ...state,
        lastPlay: null,
        lastPlayPlayerIndex: null,
        currentTurn: action.nextTurn,
      };
    case "PLAYER_DISCONNECTED":
      return { ...state, disconnectedPlayer: { nickname: action.nickname, timeoutMs: action.timeoutMs } };
    case "PLAYER_RECONNECTED":
      return {
        ...state,
        disconnectedPlayer: null,
        playerOrder: action.playerIds.length > 0 ? action.playerIds : state.playerOrder,
      };
    case "GAME_OVER":
      return { ...state, phase: "result", winner: action.winner, winCounts: action.winCounts, disconnectedPlayer: null };
    default:
      return state;
  }
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export interface UseGameReturn {
  gameState: GameState;
  createRoom: (nickname: string) => void;
  joinRoom: (code: string, nickname: string) => void;
  leaveRoom: () => void;
  votePlay: () => void;
  bid: (amount: 0 | 1) => void;
  playCards: (cards: Card[]) => void;
  pass: () => void;
  reactEmoji: (emoji: string) => void;
}

export function useGame(): UseGameReturn {
  const socket = useSocket();
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
    // Only room-broadcast events carry `seq`; unicasts (game_start, your_turn) pass seq=undefined.
    function checkSeq(seq: number | undefined): boolean {
      if (seq === undefined) return true; // unicast — no seq tracking
      if (seq === seqRef.current + 1) {
        seqRef.current = seq;
        return true;
      }
      // Gap detected — request a full state snapshot from the server
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
        currentTurn?: number;
        landlordIndex?: number;
        landlordCards?: Card[];
        lastPlay?: Play | null;
        playerCardCounts?: number[];
        seq?: number;
      }) => {
        console.log("[useGame] room_joined received:", data);
        if (typeof data.seq === "number") {
          seqRef.current = data.seq;
        }
        roomCodeRef.current = data.roomCode;
        dispatch({
          type: "ROOM_JOINED",
          roomCode: data.roomCode,
          members: data.members,
          playerIds: data.playerIds ?? [],
          currentTurn: data.currentTurn,
          landlordIndex: data.landlordIndex,
          landlordCards: data.landlordCards,
          lastPlay: data.lastPlay,
          playerCardCounts: data.playerCardCounts,
        });
      },
    );
    socket.on("room_created", (data: { roomCode: string }) => {
      console.log("[useGame] room_created received:", data);
      roomCodeRef.current = data.roomCode;
      seqRef.current = 0;
      dispatch({ type: "ROOM_JOINED", roomCode: data.roomCode, members: [], playerIds: [] });
    });
    socket.on("members_update", (data: { members: ClientMember[]; seq?: number }) => {
      if (!checkSeq(data.seq)) return;
      dispatch({ type: "MEMBERS_UPDATE", members: data.members });
    });
    socket.on("game_aborted", (data: { seq?: number } = {}) => {
      if (!checkSeq(data.seq)) return;
      dispatch({ type: "GAME_ABORTED" });
    });
    socket.on(
      "vote_closed_start",
      (data: { players: { id: string; nickname: string }[]; seq?: number }) => {
        if (!checkSeq(data.seq)) return;
        dispatch({
          type: "VOTE_CLOSED_START",
          playerIds: (data?.players ?? []).map((p) => p.id),
        });
      },
    );
    // game_start is a unicast — no seq
    socket.on("game_start", (data: { hand: Card[]; firstBidder: number; reconnect?: boolean }) => {
      dispatch({
        type: "GAME_START",
        hand: data.hand,
        firstBidder: data.firstBidder,
        reconnect: data.reconnect,
      });
    });
    socket.on("bid_open", (data: { seq?: number } = {}) => {
      if (!checkSeq(data.seq)) return;
      dispatch({ type: "BID_OPEN" });
    });
    socket.on(
      "bid_status",
      (data: { submitted: boolean }) => {
        dispatch({ type: "BID_STATUS", submitted: data.submitted });
      },
    );
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
    socket.on("bid_made", (data: { playerIndex: number; value: number; seq?: number }) => {
      if (!checkSeq(data.seq)) return;
      const { playerOrder } = gameStateRef.current;
      const isMyBid = playerOrder[data.playerIndex] === socket.id;
      dispatch({ type: "BID_MADE", value: data.value, isMyBid });
    });
    socket.on(
      "landlord_decided",
      (data: { playerIndex: number; landlordCards: Card[]; playerCardCounts: number[]; seq?: number }) => {
        if (!checkSeq(data.seq)) return;
        dispatch({
          type: "LANDLORD_DECIDED",
          landlordIndex: data.playerIndex,
          landlordCards: data.landlordCards,
          playerCardCounts: data.playerCardCounts,
        });
      },
    );
    // Unicast — no seq. Replaces myHand with the server-authoritative version.
    socket.on("hand_updated", (data: { hand: Card[] }) => {
      dispatch({ type: "HAND_UPDATED", hand: data.hand });
    });
    socket.on(
      "cards_played",
      (data: {
        playerIndex: number;
        cards: Card[];
        handType: Play["type"];
        rank: number;
        remaining: number;
        nextTurn?: number;
        seq?: number;
      }) => {
        if (!checkSeq(data.seq)) return;
        const { playerOrder } = gameStateRef.current;
        const mySocketIndex = playerOrder.indexOf(socket.id ?? "");
        dispatch({
          type: "CARDS_PLAYED",
          play: { type: data.handType, cards: data.cards, rank: data.rank },
          playerIndex: data.playerIndex,
          nextTurn: data.nextTurn ?? 0,
          isMyPlay: data.playerIndex === mySocketIndex,
          remaining: data.remaining,
        });
      },
    );
    socket.on(
      "player_passed",
      (data: { playerIndex: number; nextTurn: number; seq?: number }) => {
        if (!checkSeq(data.seq)) return;
        dispatch({ type: "PLAYER_PASSED", ...data });
      },
    );
    socket.on(
      "new_round",
      (data: { nextTurn?: number; starterIndex?: number; seq?: number }) => {
        if (!checkSeq(data.seq)) return;
        dispatch({
          type: "NEW_ROUND",
          nextTurn: data.nextTurn ?? data.starterIndex ?? 0,
        });
      },
    );
    socket.on("game_over", (data: { winner: "landlord" | "peasants"; winCounts: Record<string, number>; seq?: number }) => {
      if (!checkSeq(data.seq)) return;
      dispatch({ type: "GAME_OVER", winner: data.winner, winCounts: data.winCounts ?? {} });
    });
    socket.on("turn_changed", (data: { nextTurn: number; seq?: number }) => {
      if (!checkSeq(data.seq)) return;
      dispatch({ type: "TURN_CHANGED", nextTurn: data.nextTurn });
    });
    socket.on("return_to_lobby", (data: { seq?: number } = {}) => {
      if (!checkSeq(data.seq)) return;
      dispatch({ type: "GAME_ABORTED" });
    });
    socket.on("player_disconnected", (data: { nickname: string; timeoutMs: number; seq?: number }) => {
      if (!checkSeq(data.seq)) return;
      dispatch({ type: "PLAYER_DISCONNECTED", nickname: data.nickname, timeoutMs: data.timeoutMs });
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
      socket.off("landlord_decided");
      socket.off("hand_updated");
      socket.off("cards_played");
      socket.off("player_passed");
      socket.off("new_round");
      socket.off("game_over");
      socket.off("turn_changed");
      socket.off("return_to_lobby");
      socket.off("player_disconnected");
      socket.off("player_reconnected");
    };
  }, [socket]);

  // ── Actions ──────────────────────────────────────────────────────────────

  const createRoom = useCallback(
    (nickname: string) => {
      socket.emit("create_room", { nickname });
    },
    [socket],
  );

  const joinRoom = useCallback(
    (code: string, nickname: string) => {
      console.log(
        "[useGame] emitting join_room, connected:",
        socket.connected,
        "code:",
        code,
        "nickname:",
        nickname,
      );
      socket.emit("join_room", { code, nickname });
    },
    [socket],
  );

  const leaveRoom = useCallback(() => {
    socket.emit("leave_room");
    dispatch({ type: "GAME_ABORTED" });
  }, [socket]);

  const votePlay = useCallback(() => {
    socket.emit("vote_play");
  }, [socket]);

  const bid = useCallback(
    (amount: 0 | 1) => {
      socket.emit("bid", { value: amount });
    },
    [socket],
  );

  const playCards = useCallback(
    (cards: Card[]) => {
      socket.emit("play_cards", { cards });
    },
    [socket],
  );

  const pass = useCallback(() => {
    socket.emit("pass");
  }, [socket]);

  const reactEmoji = useCallback(
    (emoji: string) => {
      socket.emit("react_emoji", { emoji });
    },
    [socket],
  );

  return {
    gameState,
    createRoom,
    joinRoom,
    leaveRoom,
    votePlay,
    bid,
    playCards,
    pass,
    reactEmoji,
  };
}
