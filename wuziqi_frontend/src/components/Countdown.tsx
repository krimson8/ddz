'use client';

import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

interface CountdownProps {
  from?: number;
  onComplete?: () => void;
}

export function Countdown({ from = 3, onComplete }: CountdownProps) {
  const [count, setCount] = useState(from);

  useEffect(() => {
    if (count <= 0) {
      onComplete?.();
      return;
    }
    const id = setTimeout(() => setCount((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [count, onComplete]);

  return (
    <div className="flex items-center justify-center w-full h-full">
      <AnimatePresence mode="wait">
        {count > 0 && (
          <motion.span
            key={count}
            initial={{ opacity: 0, scale: 2 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.5 }}
            transition={{ duration: 0.4 }}
            className="text-8xl font-black text-yellow-400 drop-shadow-lg"
          >
            {count}
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  );
}
