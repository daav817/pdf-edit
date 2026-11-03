import { useCallback, useRef, useState } from "react";

const MAX_HISTORY = 80;
/** Edits closer together than this (a typing burst, a drag) undo as one step. */
const COALESCE_MS = 700;

/**
 * `mergeKey(prev, next)` names the kind of change (e.g. "typing in box 3").
 * Quick runs of changes with the same key undo as one step; null means the
 * change always gets its own step.
 */
export function useUndoRedo<T>(
  initial: T,
  mergeKey: (prev: T, next: T) => string | null = () => null
) {
  const [state, setStateInternal] = useState(initial);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const pastRef = useRef<T[]>([]);
  const futureRef = useRef<T[]>([]);
  const stateRef = useRef(state);
  const lastChangeAtRef = useRef(0);
  const lastKeyRef = useRef<string | null>(null);
  const mergeKeyRef = useRef(mergeKey);
  mergeKeyRef.current = mergeKey;

  const refreshFlags = useCallback(() => {
    setCanUndo(pastRef.current.length > 0);
    setCanRedo(futureRef.current.length > 0);
  }, []);

  const commit = useCallback(
    (next: T) => {
      stateRef.current = next;
      setStateInternal(next);
      refreshFlags();
    },
    [refreshFlags]
  );

  // History is recorded here, outside React's state updater, so StrictMode's
  // double-invoked updaters cannot push the same step twice.
  const setState = useCallback(
    (next: T | ((prev: T) => T)) => {
      const prev = stateRef.current;
      const resolved =
        typeof next === "function" ? (next as (p: T) => T)(prev) : next;
      if (resolved === prev) return;
      const now = Date.now();
      const key = mergeKeyRef.current(prev, resolved);
      const continuing =
        key !== null &&
        key === lastKeyRef.current &&
        now - lastChangeAtRef.current < COALESCE_MS &&
        pastRef.current.length > 0;
      if (!continuing) {
        pastRef.current = [...pastRef.current.slice(-MAX_HISTORY + 1), prev];
      }
      lastChangeAtRef.current = now;
      lastKeyRef.current = key;
      futureRef.current = [];
      commit(resolved);
    },
    [commit]
  );

  const replaceState = useCallback(
    (next: T) => {
      pastRef.current = [];
      futureRef.current = [];
      lastChangeAtRef.current = 0;
      lastKeyRef.current = null;
      commit(next);
    },
    [commit]
  );

  const undo = useCallback(() => {
    const past = pastRef.current;
    if (past.length === 0) return false;
    const previous = past[past.length - 1];
    pastRef.current = past.slice(0, -1);
    futureRef.current = [stateRef.current, ...futureRef.current];
    lastChangeAtRef.current = 0;
    lastKeyRef.current = null;
    commit(previous);
    return true;
  }, [commit]);

  const redo = useCallback(() => {
    const future = futureRef.current;
    if (future.length === 0) return false;
    const next = future[0];
    futureRef.current = future.slice(1);
    pastRef.current = [...pastRef.current, stateRef.current];
    lastChangeAtRef.current = 0;
    lastKeyRef.current = null;
    commit(next);
    return true;
  }, [commit]);

  return {
    state,
    setState,
    replaceState,
    undo,
    redo,
    canUndo,
    canRedo,
  };
}
