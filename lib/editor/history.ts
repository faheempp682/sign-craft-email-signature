/** Linear undo/redo. Pure: every function returns a new History. Rapid edits with the same key (typing, dragging a slider) collapse into one step. */
export type History<T> = { past: T[]; present: T; future: T[]; key?: string; at?: number };

export const COALESCE_MS = 800;
export const MAX_HISTORY = 100;

export const createHistory = <T>(present: T): History<T> => ({ past: [], present, future: [] });

export function commit<T>(h: History<T>, next: T, key?: string, now = Date.now()): History<T> {
  if (Object.is(next, h.present)) return h;
  if (key && h.key === key && h.at !== undefined && now - h.at < COALESCE_MS && h.past.length) {
    return { ...h, present: next, future: [], at: now };
  }
  return { past: [...h.past, h.present].slice(-MAX_HISTORY), present: next, future: [], key, at: now };
}

/** Replace everything without recording a step (loading a draft, reverting). */
export const reset = <T>(present: T): History<T> => createHistory(present);

export function undo<T>(h: History<T>): History<T> {
  if (!h.past.length) return h;
  const prev = h.past[h.past.length - 1];
  return { past: h.past.slice(0, -1), present: prev, future: [h.present, ...h.future] };
}

export function redo<T>(h: History<T>): History<T> {
  if (!h.future.length) return h;
  const [next, ...rest] = h.future;
  return { past: [...h.past, h.present], present: next, future: rest };
}

export const canUndo = <T>(h: History<T>) => h.past.length > 0;
export const canRedo = <T>(h: History<T>) => h.future.length > 0;
