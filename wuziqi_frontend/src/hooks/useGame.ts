"use client";

import { useCallback, useEffect, useReducer, useRef } from "react";
import { useSocket } from "./useSocket";
import type {
  Board,
  Cell,
  ClientMember,
  GamePhase,
  GameState,
  Move,
  StoneColor,
  WinnerColor,
  WinReason,
} from "@/types/game";

const BOARD_SIZE = 15;

function emptyBoard(size: number): Board {
  return Array.from({ length: size }, () =>
    Array.from({ length: size }, () => 0 as Cell),
  );
}

function boardFromMoves(size: number, moves: Move[]): Board {
  const b = emptyBoard(size);
  for (const m of moves) {
    if (m.y >= 0 && m.y < size && m.x >= 0 && m.x < size) {
      b[m.y][m.x] = m.color === "black" ? 1 : 2;
    }
  }
  return b;
}

const initialState: GameState = {
  phase: "lobby",
  roomCode: null,
  members: [],
  playerOrder: [],
  boardSize: BOARD_SIZE,
  board: emptyBoard(BOARD_SIZE),
  moves: [],
  currentColor: "black",
  myColor: null,
  blackUid: null,
  whiteUid: null,
  currentPlayerEndTime: null,
  lastMove: null,
  winnerColor: null,
  winReason: null,
  winnerUid: null,
  winningLine: null,
  winCounts: {},
  readyCount: 0,
  canVote: false,
  disconnectedPlayer: null,
  drawVoters: [],
};

// ── Actions ──────────────────────────────────────────────────────────────────

type Action =
  | {
      type: "ROOM_JOINED";
      roomCode: string;
      members: ClientMember[];
      playerUids: string[];
      winCounts: Record<string, number>;
      phase?: GamePhase;
      readyCount?: number;
      canVote?: boolean;
    }
  | { type: "MEMBERS_UPDATE"; members: ClientMember[]; readyCount: number; canVote: boolean }
  | { type: "VOTE_CLOSED_START"; playerUids: string[] }
  | {
      type: "GAME_START";
      boardSize: number;
      blackUid: string | null;
      whiteUid: string | null;
      myColor: StoneColor | null;
      currentColor: StoneColor;
      reconnect?: boolean;
    }
  | {
      type: "MOVE_MADE";
      x: number;
      y: number;
      color: StoneColor;
      nextColor: StoneColor;
      currentPlayerEndTime: number;
    }
  | {
      type: "GAME_STATE";
      board: Board;
      moves: Move[];
      currentColor: StoneColor;
      currentPlayerEndTime: number;
      blackUid: string | null;
      whiteUid: string | null;
      winCounts: Record<string, number>;
    }
  | {
      type: "GAME_OVER";
      winnerColor: WinnerColor;
      winReason: WinReason;
      winnerUid: string | null;
      winningLine: { x: number; y: number }[] | null;
      winCounts: Record<string, number>;
    }
  | { type: "RETURN_TO_LOBBY" }
  | { type: "GAME_ABORTED" }
  | { type: "PLAYER_DISCONNECTED"; nickname: string; endTime: number; timeoutMs: number }
  | { type: "PLAYER_RECONNECTED"; playerUids: string[] }
  | { type: "DRAW_VOTE_UPDATE"; drawVoters: string[] }
  | { type: "LEFT_ROOM" };

function reducer(state: GameState, action: Action): GameState {
  switch (action.type) {
    case "ROOM_JOINED":
      return {
        ...state,
        roomCode: action.roomCode,
        members: action.members,
        playerOrder: action.playerUids,
        winCounts: action.winCounts,
        phase:
          action.phase ?? (action.playerUids.length > 0 ? state.phase : "lobby"),
        readyCount: action.readyCount ?? state.readyCount,
        canVote: action.canVote ?? state.canVote,
      };
    case "LEFT_ROOM":
      return { ...initialState };
    case "MEMBERS_UPDATE":
      return {
        ...state,
        members: action.members,
        readyCount: action.readyCount,
        canVote: action.canVote,
      };
    case "VOTE_CLOSED_START":
      return { ...state, phase: "starting", playerOrder: action.playerUids };
    case "GAME_ABORTED":
    case "RETURN_TO_LOBBY":
      return {
        ...initialState,
        roomCode: state.roomCode,
        members: state.members.map((m) => ({ ...m, wantToPlay: false, color: null })),
        winCounts: state.winCounts,
        phase: "lobby",
      };
    case "GAME_START": {
      // On reconnect the GAME_STATE snapshot follows and fills the board.
      return {
        ...state,
        phase: "gameplay",
        boardSize: action.boardSize,
        board: action.reconnect ? state.board : emptyBoard(action.boardSize),
        moves: action.reconnect ? state.moves : [],
        blackUid: action.blackUid,
        whiteUid: action.whiteUid,
        myColor: action.myColor,
        currentColor: action.currentColor,
        lastMove: action.reconnect ? state.lastMove : null,
        winnerColor: null,
        winReason: null,
        winnerUid: null,
        winningLine: null,
        disconnectedPlayer: null,
        drawVoters: [],
      };
    }
    case "MOVE_MADE": {
      const board = state.board.map((row) => row.slice());
      if (board[action.y]) board[action.y][action.x] = action.color === "black" ? 1 : 2;
      return {
        ...state,
        board,
        moves: [...state.moves, { color: action.color, x: action.x, y: action.y }],
        currentColor: action.nextColor,
        currentPlayerEndTime: action.currentPlayerEndTime,
        lastMove: { x: action.x, y: action.y },
      };
    }
    case "GAME_STATE": {
      const moves = action.moves ?? [];
      const last = moves.length > 0 ? moves[moves.length - 1] : null;
      return {
        ...state,
        phase: "gameplay",
        board: action.board ?? boardFromMoves(state.boardSize, moves),
        moves,
        currentColor: action.currentColor,
        currentPlayerEndTime: action.currentPlayerEndTime,
        blackUid: action.blackUid,
        whiteUid: action.whiteUid,
        winCounts: action.winCounts ?? state.winCounts,
        lastMove: last ? { x: last.x, y: last.y } : null,
      };
    }
    case "GAME_OVER":
      return {
        ...state,
        phase: "result",
        winnerColor: action.winnerColor,
        winReason: action.winReason,
        winnerUid: action.winnerUid,
        winningLine: action.winningLine,
        winCounts: action.winCounts ?? state.winCounts,
        currentPlayerEndTime: null,
        disconnectedPlayer: null,
        drawVoters: [],
      };
    case "DRAW_VOTE_UPDATE":
      return { ...state, drawVoters: action.drawVoters };
    case "PLAYER_DISCONNECTED":
      return {
        ...state,
        disconnectedPlayer: {
          nickname: action.nickname,
          endTime: action.endTime,
          timeoutMs: action.timeoutMs,
        },
      };
    case "PLAYER_RECONNECTED":
      return {
        ...state,
        disconnectedPlayer: null,
        playerOrder:
          action.playerUids.length > 0 ? action.playerUids : state.playerOrder,
      };
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
  placeStone: (x: number, y: number) => void;
  resign: () => void;
  voteDraw: () => void;
  reactEmoji: (emoji: string) => void;
}

export function useGame(): UseGameReturn {
  const socket = useSocket();
  const [gameState, dispatch] = useReducer(reducer, initialState);

  const seqRef = useRef(0);
  const roomCodeRef = useRef<string | null>(null);

  useEffect(() => {
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
        playerUids?: string[];
        winCounts?: Record<string, number>;
        phase?: string;
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
          playerUids: data.playerUids ?? [],
          winCounts: data.winCounts ?? {},
          phase: data.phase === "gameplay" ? "gameplay" : data.phase === "lobby" ? "lobby" : undefined,
          readyCount: data.readyCount,
          canVote: data.canVote,
        });
      },
    );

    socket.on("room_created", (data: { roomCode: string }) => {
      roomCodeRef.current = data.roomCode;
      seqRef.current = 0;
      dispatch({
        type: "ROOM_JOINED",
        roomCode: data.roomCode,
        members: [],
        playerUids: [],
        winCounts: {},
      });
    });

    socket.on(
      "members_update",
      (data: { members: ClientMember[]; readyCount?: number; canVote?: boolean; seq?: number }) => {
        if (!checkSeq(data.seq)) return;
        dispatch({
          type: "MEMBERS_UPDATE",
          members: data.members,
          readyCount: data.readyCount ?? 0,
          canVote: data.canVote ?? false,
        });
      },
    );

    socket.on(
      "vote_closed_start",
      (data: { players: { id: string; nickname: string }[]; seq?: number }) => {
        if (!checkSeq(data.seq)) return;
        dispatch({
          type: "VOTE_CLOSED_START",
          playerUids: (data?.players ?? []).map((p) => p.id),
        });
      },
    );

    socket.on(
      "game_start",
      (data: {
        boardSize: number;
        blackUid: string | null;
        whiteUid: string | null;
        yourColor: StoneColor | null;
        currentColor: StoneColor;
        reconnect?: boolean;
      }) => {
        dispatch({
          type: "GAME_START",
          boardSize: data.boardSize ?? BOARD_SIZE,
          blackUid: data.blackUid,
          whiteUid: data.whiteUid,
          myColor: data.yourColor,
          currentColor: data.currentColor ?? "black",
          reconnect: data.reconnect,
        });
      },
    );

    socket.on(
      "move_made",
      (data: {
        x: number;
        y: number;
        color: StoneColor;
        nextColor: StoneColor;
        currentPlayerEndTime: number;
        seq?: number;
      }) => {
        if (!checkSeq(data.seq)) return;
        dispatch({
          type: "MOVE_MADE",
          x: data.x,
          y: data.y,
          color: data.color,
          nextColor: data.nextColor,
          currentPlayerEndTime: data.currentPlayerEndTime,
        });
      },
    );

    socket.on(
      "game_state",
      (data: {
        board: Board;
        moves: Move[];
        currentColor: StoneColor;
        currentPlayerEndTime: number;
        blackUid: string | null;
        whiteUid: string | null;
        winCounts: Record<string, number>;
        seq?: number;
      }) => {
        if (!checkSeq(data.seq)) return;
        dispatch({
          type: "GAME_STATE",
          board: data.board,
          moves: data.moves ?? [],
          currentColor: data.currentColor,
          currentPlayerEndTime: data.currentPlayerEndTime,
          blackUid: data.blackUid,
          whiteUid: data.whiteUid,
          winCounts: data.winCounts,
        });
      },
    );

    socket.on(
      "game_over",
      (data: {
        winnerColor: WinnerColor;
        winReason: WinReason;
        winnerUid: string | null;
        winningLine: { x: number; y: number }[] | null;
        winCounts: Record<string, number>;
        seq?: number;
      }) => {
        // Always apply — authoritative phase transition.
        if (typeof data.seq === "number") seqRef.current = data.seq;
        dispatch({
          type: "GAME_OVER",
          winnerColor: data.winnerColor,
          winReason: data.winReason,
          winnerUid: data.winnerUid,
          winningLine: data.winningLine,
          winCounts: data.winCounts ?? {},
        });
      },
    );

    socket.on("return_to_lobby", (data: { seq?: number } = {}) => {
      if (typeof data.seq === "number") seqRef.current = data.seq;
      dispatch({ type: "RETURN_TO_LOBBY" });
    });

    socket.on("game_aborted", (data: { seq?: number } = {}) => {
      if (!checkSeq(data.seq)) return;
      dispatch({ type: "GAME_ABORTED" });
    });

    socket.on(
      "player_disconnected",
      (data: { nickname: string; endTime: number; timeoutMs: number; seq?: number }) => {
        if (!checkSeq(data.seq)) return;
        dispatch({
          type: "PLAYER_DISCONNECTED",
          nickname: data.nickname,
          endTime: data.endTime,
          timeoutMs: data.timeoutMs,
        });
      },
    );

    socket.on(
      "player_reconnected",
      (data: { nickname: string; playerUids?: string[]; seq?: number }) => {
        if (!checkSeq(data.seq)) return;
        dispatch({ type: "PLAYER_RECONNECTED", playerUids: data.playerUids ?? [] });
      },
    );

    socket.on(
      "draw_vote_update",
      (data: { drawVoters?: string[]; seq?: number }) => {
        if (!checkSeq(data.seq)) return;
        dispatch({ type: "DRAW_VOTE_UPDATE", drawVoters: data.drawVoters ?? [] });
      },
    );

    socket.on("left_room", () => {
      roomCodeRef.current = null;
      seqRef.current = 0;
      dispatch({ type: "LEFT_ROOM" });
    });

    return () => {
      socket.off("room_joined");
      socket.off("room_created");
      socket.off("members_update");
      socket.off("vote_closed_start");
      socket.off("game_start");
      socket.off("move_made");
      socket.off("game_state");
      socket.off("game_over");
      socket.off("return_to_lobby");
      socket.off("game_aborted");
      socket.off("player_disconnected");
      socket.off("player_reconnected");
      socket.off("draw_vote_update");
      socket.off("left_room");
    };
  }, [socket]);

  // ── Actions ──────────────────────────────────────────────────────────────

  const createRoom = useCallback(() => {
    socket.emit("create_room");
  }, [socket]);

  const joinRoom = useCallback(
    (code: string) => {
      socket.emit("join_room", { code });
    },
    [socket],
  );

  const leaveRoom = useCallback(() => {
    socket.emit("leave_room");
  }, [socket]);

  const votePlay = useCallback(() => {
    socket.emit("vote_play");
  }, [socket]);

  const placeStone = useCallback(
    (x: number, y: number) => {
      socket.emit("place_stone", { x, y });
    },
    [socket],
  );

  const resign = useCallback(() => {
    socket.emit("resign");
  }, [socket]);

  const voteDraw = useCallback(() => {
    socket.emit("vote_draw");
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
    placeStone,
    resign,
    voteDraw,
    reactEmoji,
  };
}
