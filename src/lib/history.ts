export type History<T> = { past: T[]; present: T; future: T[] };

export function historyInit<T>(present: T): History<T> {
  return { past: [], present, future: [] };
}

/** Push present onto past, set new present, clear future. Cap past at max (e.g. 50). */
export function historyPush<T>(h: History<T>, next: T, max = 50): History<T> {
  const past = [...h.past, h.present];
  while (past.length > max) {
    past.shift();
  }
  return { past, present: next, future: [] };
}

export function historyUndo<T>(h: History<T>): History<T> {
  if (h.past.length === 0) return h;
  const past = h.past.slice(0, -1);
  const present = h.past[h.past.length - 1];
  const future = [h.present, ...h.future];
  return { past, present, future };
}

export function historyRedo<T>(h: History<T>): History<T> {
  if (h.future.length === 0) return h;
  const [next, ...future] = h.future;
  return {
    past: [...h.past, h.present],
    present: next,
    future,
  };
}

export function canUndo<T>(h: History<T>): boolean {
  return h.past.length > 0;
}

export function canRedo<T>(h: History<T>): boolean {
  return h.future.length > 0;
}
