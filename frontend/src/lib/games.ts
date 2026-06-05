import type { Game } from "./socket";

/** Display metadata for each game, used across the unified lobby and routing. */
export interface GameMeta {
  id: Game;
  /** Localized title shown on lobby buttons and badges. */
  title: string;
  /** Short emoji/icon prefix. */
  icon: string;
  /** Play route for this game. */
  route: string;
  /** Tailwind accent classes for the game badge. */
  badgeClass: string;
}

export const GAME_META: Record<Game, GameMeta> = {
  ddz: {
    id: "ddz",
    title: "鬥地主",
    icon: "🀄",
    route: "/play/ddz",
    badgeClass: "bg-red-500/30 text-red-200",
  },
  wuziqi: {
    id: "wuziqi",
    title: "五子棋",
    icon: "⚫",
    route: "/play/wuziqi",
    badgeClass: "bg-blue-500/30 text-blue-200",
  },
};

export const GAME_LIST: GameMeta[] = [GAME_META.ddz, GAME_META.wuziqi];
