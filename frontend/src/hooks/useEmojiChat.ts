'use client';

import { useEffect, useRef, useState } from 'react';
import { useSocket } from '@/hooks/useSocket';
import type { EmojiHistoryEntry } from '@/components/EmojiChatBox';

export interface EmojiReactionEvent {
  /** DDZ uses senderId; wuziqi uses senderUid — both are carried by the backend. */
  senderId?: string;
  senderUid?: string;
  senderNickname?: string;
  emoji: string;
}

const DEFAULT_HISTORY_LIMIT = 5;

interface UseEmojiChatOptions {
  /** Called with the emoji string on every received reaction (e.g. to play a sound). */
  onEmojiReceived?: (emoji: string) => void;
  /** How many recent entries to keep in history. */
  limit?: number;
}

/**
 * Socket-scoped emoji chat. The `emoji_reaction` channel is tied to room
 * membership on the backend (not to game phase), so this hook lives at the play
 * page level and stays mounted across the waiting lobby → game transition. That
 * keeps a single subscription and lets history persist across phases.
 */
export function useEmojiChat(
  game: 'ddz' | 'wuziqi',
  { onEmojiReceived, limit = DEFAULT_HISTORY_LIMIT }: UseEmojiChatOptions = {},
) {
  const socket = useSocket(game);
  const [history, setHistory] = useState<EmojiHistoryEntry[]>([]);
  const [selectedReaction, setSelectedReaction] = useState('🖕');
  const keyRef = useRef(0);

  // Latest-ref the callback so the subscription never needs to re-bind.
  const latestOnReceived = useRef(onEmojiReceived);
  latestOnReceived.current = onEmojiReceived;

  useEffect(() => {
    const handler = (data: EmojiReactionEvent) => {
      latestOnReceived.current?.(data.emoji);
      const key = ++keyRef.current;
      setHistory((prev) => [
        ...prev.slice(-(limit - 1)),
        { key, nickname: data.senderNickname ?? '玩家', emoji: data.emoji },
      ]);
    };
    socket.on('emoji_reaction', handler);
    return () => {
      socket.off('emoji_reaction', handler);
    };
  }, [socket, limit]);

  const reactEmoji = (emoji: string) => {
    socket.emit('react_emoji', { emoji });
  };

  return { history, selectedReaction, setSelectedReaction, reactEmoji };
}
