import { useSyncExternalStore } from 'react';
import { post } from './vscode';

/** Tiny per-file text store so one file arriving doesn't re-render every window. */
const texts = new Map<string, string>();
const listeners = new Map<string, Set<() => void>>();
const requested = new Set<string>();

const emit = (id: string) => listeners.get(id)?.forEach((fn) => fn());

export const fileStore = {
  set(id: string, text: string) { texts.set(id, text); requested.delete(id); emit(id); },
  invalidate(id: string, stillShown: boolean) {
    texts.delete(id);
    requested.delete(id);
    if (stillShown) fileStore.request(id);
    emit(id);
  },
  request(id: string) {
    if (texts.has(id) || requested.has(id)) return;
    requested.add(id);
    post({ type: 'getFile', id });
  },
};

export function useFileText(id: string): string | undefined {
  return useSyncExternalStore(
    (fn) => {
      let set = listeners.get(id);
      if (!set) listeners.set(id, (set = new Set()));
      set.add(fn);
      return () => { set!.delete(fn); };
    },
    () => texts.get(id)
  );
}
