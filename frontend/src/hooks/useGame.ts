"use client";

import { useCallback, useEffect, useReducer, useRef } from "react";
import { useSocket } from "./useSocket";
import type {
  Card,
  ClientMember,
  GameState,
  GamePhase,
  HistoryEntry,
  Play,
} from "@/types/game";

// ── Initial State ────────────────────────────────────────────────────────────

const initialState: GameState = {
  phase: "lobby",
  roomCode: null,
  members: [],
  playerOrder: [],
  myHand: [],
  landlordCards: null,
  landlordIndex: null,
  currentPlayer: null,
  currentPlayerEndTime: null,
  currentBid: 0,
  bidVotedCount: 0,
  bidTimeoutMs: 8000,
  bidSubmitted: false,
  lastPlay: null,
  winner: null,
  winnerIds: [],
  playHistory: [],
  playerCardCounts: [],
  lastPlayedBy: null,
  winCounts: {},
  readyCount: 0,
  canVote: false,
  disconnectedPlayer: null,
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
      phase: GamePhase;
    }
  | { type: "GAME_OVER"; winner: "landlord" | "peasants"; winCounts: Record<string, number>; winnerIds: string[]; phase: GamePhase }
  | { type: "PLAYER_DISCONNECTED"; nickname: string; timeoutMs: number }
  | { type: "PLAYER_RECONNECTED"; playerIds: string[] }
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
      };
    }
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
      };
    }
    case "PLAYER_DISCONNECTED":
      return { ...state, disconnectedPlayer: { nickname: action.nickname, timeoutMs: action.timeoutMs } };
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
        winnerIds: action.winnerIds,
        winCounts: action.winCounts,
        disconnectedPlayer: null,
      };
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
        phase: GamePhase;
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
          phase: data.phase,
        });
      },
    );

    socket.on("game_over", (data: { winner: "landlord" | "peasants"; winCounts: Record<string, number>; winnerIds?: string[]; phase?: GamePhase; seq?: number }) => {
      if (!checkSeq(data.seq)) return;
      dispatch({
        type: "GAME_OVER",
        winner: data.winner,
        winCounts: data.winCounts ?? {},
        winnerIds: data.winnerIds ?? [],
        phase: data.phase ?? "result",
      });
    });

    socket.on("turn_changed", (data: { nextTurn: number; seq?: number }) => {
      if (!checkSeq(data.seq)) return;
      dispatch({ type: "TURN_CHANGED", nextTurn: data.nextTurn });
    });

    socket.on("return_to_lobby", (data: { phase?: GamePhase; seq?: number } = {}) => {
      if (!checkSeq(data.seq)) return;
      dispatch({ type: "RETURN_TO_LOBBY", phase: data.phase ?? "lobby" });
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
      socket.off("game_state");
      socket.off("game_over");
      socket.off("return_to_lobby");
      socket.off("player_disconnected");
      socket.off("player_reconnected");
    };
  }, [socket]);

  // ── Actions ──────────────────────────────────────────────────────────────

  const createRoom = useCallback(
    (nickname: string) => { socket.emit("create_room", { nickname }); },
    [socket],
  );

  const joinRoom = useCallback(
    (code: string, nickname: string) => {
      socket.emit("join_room", { code, nickname });
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

  const playCards = useCallback(
    (cards: Card[]) => { socket.emit("play_cards", { cards }); },
    [socket],
  );

  const pass = useCallback(() => { socket.emit("pass"); }, [socket]);

  const reactEmoji = useCallback(
    (emoji: string) => { socket.emit("react_emoji", { emoji }); },
    [socket],
  );

  return { gameState, createRoom, joinRoom, leaveRoom, votePlay, bid, playCards, pass, reactEmoji };
}
