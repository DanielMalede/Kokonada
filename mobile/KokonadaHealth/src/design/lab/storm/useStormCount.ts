// The storm scenes' JS timer (B8-7): the count of the script's changes so far, from the moment `running` turns true.
// The timer only says when to look again; what the count is comes from the elapsed time (stormCountAt), so a late timer
// catches up with the script instead of drifting from it. One pending timeout at most, cleared on unmount.

import { useEffect, useState } from 'react';
import { nextChangeAfter, stormCountAt, type StormScript } from './stormScript';

export function useStormCount(script: StormScript, running: boolean): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!running) return undefined;
    const start = performance.now();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = (elapsed: number) => {
      timer = setTimeout(look, Math.max(0, nextChangeAfter(script, elapsed) - elapsed));
    };
    const look = () => {
      const elapsed = performance.now() - start;
      setCount(stormCountAt(script, elapsed));
      schedule(elapsed);
    };
    setCount(0);
    schedule(0);
    return () => {
      if (timer !== null) clearTimeout(timer);
    };
  }, [script, running]);
  return count;
}
