'use client';

import { useEffect, useRef } from 'react';
import { Card } from './Card';
import type { ClientMember, HistoryEntry } from '@/types/game';

interface PlayHistoryProps {
  history: HistoryEntry[];
  playerOrder: string[];
  members: ClientMember[];
}

export function PlayHistory({ history, playerOrder, members }: PlayHistoryProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to the right (newest entry) when history updates
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollLeft = scrollRef.current.scrollWidth;
    }
  }, [history.length]);

  if (history.length === 0) return null;

  function getPlayerName(idx: number): string {
    const id = playerOrder[idx];
    return members.find((m) => m.id === id)?.nickname ?? `玩家${idx + 1}`;
  }

  return (
    <div className="w-full flex flex-col">
      <div className="bg-black/40 px-2 py-0.5">
        <span className="text-white/50 text-[9px] font-bold">出牌記錄</span>
      </div>
      <div
        ref={scrollRef}
        className="flex flex-row gap-2 overflow-x-auto bg-black/25 px-2 py-1.5"
        style={{ scrollbarWidth: 'none' }}
      >
        {history.map((entry, i) => (
          <div key={i} className="flex-shrink-0 flex flex-col items-center gap-0.5">
            <span className="text-white/60 text-[9px] whitespace-nowrap">
              {getPlayerName(entry.playerIndex)}
            </span>
            {entry.surrender ? (
              <span className="bg-red-500/80 text-white text-[10px] font-bold px-2 py-1 rounded-md whitespace-nowrap">
                投降
              </span>
            ) : (
              <div className="flex gap-[2px]">
                {entry.play.cards.map((card, j) => (
                  <Card key={j} {...card} mini />
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
