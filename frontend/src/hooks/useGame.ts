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
  lastPlay: null,
  confirmedVoters: [],
  winner: null,
  playHistory: [],
  playerCardCounts: [],
  lastPlayPlayerIndex: null,
  winCounts: {},
};

// ── Actions ──────────────────────────────────────────────────────────────────

type Action =
  | {
      type: "ROOM_JOINED";
      roomCode: string;
      members: ClientMember[];
      confirmedCount: number;
    }
  | { type: "MEMBER_JOINED"; member: ClientMember }
  | { type: "MEMBER_LEFT"; id: string }
  | { type: "VOTE_OPEN"; members: ClientMember[]; winCounts: Record<string, number> }
  | { type: "VOTE_UPDATE"; confirmedVoters: string[] }
  | { type: "VOTE_CLOSED_START"; playerIds: string[] }
  | { type: "VOTE_RESET" }
  | { type: "GAME_START"; hand: Card[]; firstBidder: number }
  | { type: "BID_OPEN" }
  | { type: "BID_TURN"; playerIndex: number; currentBid: number }
  | { type: "BID_MADE"; value: number }
  | {
      type: "LANDLORD_DECIDED";
      landlordIndex: number;
      landlordCards: Card[];
      isLandlord: boolean;
    }
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
  | { type: "ERROR"; message: string };

function reducer(state: GameState, action: Action): GameState {
  switch (action.type) {
    case "ROOM_JOINED":
      return {
        ...state,
        roomCode: action.roomCode,
        members: action.members,
        phase: "lobby",
        confirmedVoters: [],
      };
    case "MEMBER_JOINED":
      return {
        ...state,
        members: [
          ...state.members.filter((m) => m.id !== action.member.id),
          action.member,
        ],
      };
    case "MEMBER_LEFT":
      return {
        ...state,
        members: state.members.filter((m) => m.id !== action.id),
      };
    case "VOTE_OPEN":
      return { ...state, members: action.members, phase: "lobby", winCounts: action.winCounts };
    case "VOTE_UPDATE":
      return { ...state, confirmedVoters: action.confirmedVoters };
    case "VOTE_CLOSED_START": {
      // Update member roles using the authoritative player order from the server.
      const playerSet = new Set(action.playerIds);
      const updatedMembers = state.members.map((m) => ({
        ...m,
        role: (playerSet.has(m.id)
          ? "player"
          : "spectator") as ClientMember["role"],
      }));
      return {
        ...state,
        phase: "dealing",
        playerOrder: action.playerIds,
        members: updatedMembers,
        lastPlay: null,
        lastPlayPlayerIndex: null,
      };
    }
    case "VOTE_RESET":
      return {
        ...initialState,
        roomCode: state.roomCode,
        members: state.members.map((m) => ({
          ...m,
          role: "spectator" as const,
        })),
      };
    case "GAME_START":
      // Cards dealt — show hand in 'dealing' phase; bidding panel not yet shown.
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
      return { ...state, phase: "bidding", bidVotedCount: 0 };
    case "BID_TURN":
      return {
        ...state,
        currentTurn: action.playerIndex,
        currentBid: action.currentBid,
        phase: "bidding",
      };
    case "BID_MADE":
      return {
        ...state,
        currentBid: action.value > 0 ? action.value : state.currentBid,
        bidVotedCount: state.bidVotedCount + 1,
      };
    case "LANDLORD_DECIDED": {
      const newHand = action.isLandlord
        ? sortHand([...state.myHand, ...action.landlordCards])
        : state.myHand;
      // Landlord gets 20 cards (17 + 3 bottom), others keep 17
      const countsAfterLandlord = [17, 17, 17];
      countsAfterLandlord[action.landlordIndex] = 20;
      return {
        ...state,
        landlordIndex: action.landlordIndex,
        landlordCards: action.landlordCards,
        // Landlord adds the 3 face-down cards to their hand (sorted).
        myHand: newHand,
        phase: "gameplay",
        currentTurn: action.landlordIndex,
        playerCardCounts: countsAfterLandlord,
      };
    }
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
    case "GAME_OVER":
      return { ...state, phase: "result", winner: action.winner, winCounts: action.winCounts };
    default:
      return state;
  }
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export interface UseGameReturn {
  gameState: GameState;
  createRoom: (nickname: string) => void;
  joinRoom: (code: string, nickname: string) => void;
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

  // Subscribe to all server→client events
  useEffect(() => {
    socket.on(
      "room_joined",
      (data: {
        roomCode: string;
        members: ClientMember[];
        confirmedCount: number;
      }) => {
        console.log("[useGame] room_joined received:", data);
        dispatch({ type: "ROOM_JOINED", ...data });
      },
    );
    socket.on("room_created", (data: { roomCode: string }) => {
      console.log("[useGame] room_created received:", data);
      dispatch({
        type: "ROOM_JOINED",
        roomCode: data.roomCode,
        members: [],
        confirmedCount: 0,
      });
    });
    socket.on("member_joined", (member: ClientMember) => {
      dispatch({ type: "MEMBER_JOINED", member });
    });
    socket.on("member_left", (data: { id: string }) => {
      dispatch({ type: "MEMBER_LEFT", id: data.id });
    });
    socket.on("vote_open", (data: { members: ClientMember[]; winCounts: Record<string, number> }) => {
      dispatch({ type: "VOTE_OPEN", members: data.members, winCounts: data.winCounts ?? {} });
    });
    socket.on("vote_update", (data: { confirmedVoters: string[] }) => {
      dispatch({ type: "VOTE_UPDATE", confirmedVoters: data.confirmedVoters });
    });
    socket.on(
      "vote_closed_start",
      (data: { players: { id: string; nickname: string }[] }) => {
        dispatch({
          type: "VOTE_CLOSED_START",
          playerIds: (data?.players ?? []).map((p) => p.id),
        });
      },
    );
    socket.on("vote_reset", () => {
      dispatch({ type: "VOTE_RESET" });
    });
    socket.on("game_start", (data: { hand: Card[]; firstBidder: number }) => {
      dispatch({
        type: "GAME_START",
        hand: data.hand,
        firstBidder: data.firstBidder,
      });
    });
    socket.on("bid_open", () => {
      dispatch({ type: "BID_OPEN" });
    });
    socket.on(
      "bid_turn",
      (data: { playerIndex: number; currentBid: number }) => {
        dispatch({
          type: "BID_TURN",
          playerIndex: data.playerIndex,
          currentBid: data.currentBid,
        });
      },
    );
    socket.on("bid_made", (data: { playerIndex: number; value: number }) => {
      dispatch({ type: "BID_MADE", value: data.value });
    });
    socket.on(
      "landlord_decided",
      (data: { playerIndex: number; landlordCards: Card[] }) => {
        const { playerOrder } = gameStateRef.current;
        const isLandlord = playerOrder[data.playerIndex] === socket.id;
        dispatch({
          type: "LANDLORD_DECIDED",
          landlordIndex: data.playerIndex,
          landlordCards: data.landlordCards,
          isLandlord,
        });
      },
    );
    socket.on(
      "cards_played",
      (data: {
        playerIndex: number;
        cards: Card[];
        handType: Play["type"];
        rank: number;
        remaining: number;
        nextTurn?: number;
      }) => {
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
      (data: { playerIndex: number; nextTurn: number }) => {
        dispatch({ type: "PLAYER_PASSED", ...data });
      },
    );
    socket.on(
      "new_round",
      (data: { nextTurn?: number; starterIndex?: number }) => {
        dispatch({
          type: "NEW_ROUND",
          nextTurn: data.nextTurn ?? data.starterIndex ?? 0,
        });
      },
    );
    socket.on("game_over", (data: { winner: "landlord" | "peasants"; winCounts: Record<string, number> }) => {
      dispatch({ type: "GAME_OVER", winner: data.winner, winCounts: data.winCounts ?? {} });
    });
    socket.on("turn_changed", (data: { nextTurn: number }) => {
      dispatch({ type: "TURN_CHANGED", nextTurn: data.nextTurn });
    });

    return () => {
      socket.off("room_joined");
      socket.off("room_created");
      socket.off("member_joined");
      socket.off("member_left");
      socket.off("vote_open");
      socket.off("vote_update");
      socket.off("vote_closed_start");
      socket.off("vote_reset");
      socket.off("game_start");
      socket.off("bid_open");
      socket.off("bid_turn");
      socket.off("bid_made");
      socket.off("landlord_decided");
      socket.off("cards_played");
      socket.off("player_passed");
      socket.off("new_round");
      socket.off("game_over");
      socket.off("turn_changed");
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
    votePlay,
    bid,
    playCards,
    pass,
    reactEmoji,
  };
}
