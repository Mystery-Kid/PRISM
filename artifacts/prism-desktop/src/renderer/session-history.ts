export type SessionHistoryState<T> = {
  snapshots: T[];
  index: number;
};

export function createSessionHistory<T>(initial: T): SessionHistoryState<T> {
  return { snapshots: [structuredClone(initial)], index: 0 };
}

export function recordSessionSnapshot<T>(
  history: SessionHistoryState<T>,
  value: T,
  limit = 50,
): SessionHistoryState<T> {
  if (JSON.stringify(history.snapshots[history.index]) === JSON.stringify(value)) return history;
  let snapshots = history.snapshots.slice(0, history.index + 1);
  snapshots.push(structuredClone(value));
  if (snapshots.length > limit) snapshots = snapshots.slice(snapshots.length - limit);
  return { snapshots, index: snapshots.length - 1 };
}

export function undoSessionHistory<T>(
  history: SessionHistoryState<T>,
): { history: SessionHistoryState<T>; value: T | null } {
  if (history.index <= 0) return { history, value: null };
  const index = history.index - 1;
  return { history: { ...history, index }, value: structuredClone(history.snapshots[index]) };
}

export function redoSessionHistory<T>(
  history: SessionHistoryState<T>,
): { history: SessionHistoryState<T>; value: T | null } {
  if (history.index >= history.snapshots.length - 1) return { history, value: null };
  const index = history.index + 1;
  return { history: { ...history, index }, value: structuredClone(history.snapshots[index]) };
}

export function sessionHistoryAvailability<T>(history: SessionHistoryState<T>) {
  return {
    canUndo: history.index > 0,
    canRedo: history.index < history.snapshots.length - 1,
  };
}
