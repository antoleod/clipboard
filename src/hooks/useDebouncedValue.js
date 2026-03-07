import { useEffect, useState } from 'react';

export function useDebouncedValue(value, delayMs = 250) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), Math.max(0, Number(delayMs) || 0));
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
