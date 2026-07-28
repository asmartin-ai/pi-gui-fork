import { useCallback, useEffect, useRef, useState, type SetStateAction } from "react";
import type { DesktopAppState } from "../desktop-state";
import type { PiDesktopApi } from "../ipc";

interface UseComposerDraftSyncParams {
  readonly api: PiDesktopApi | undefined;
  readonly snapshot: DesktopAppState | null;
  readonly selectedSessionKey: string;
}

/**
 * Owns the session composer draft: local state mirrored into a ref, hydration from the
 * persisted snapshot (respecting the sync nonce/source), a debounced write-back, and a
 * flush so a pending write lands before the active session changes.
 */
export function useComposerDraftSync(params: UseComposerDraftSyncParams) {
  const { api, snapshot, selectedSessionKey } = params;
  const [composerDraft, setComposerDraftState] = useState("");
  const composerDraftRef = useRef("");
  const hydratedComposerSessionKeyRef = useRef("");
  const handledComposerSyncNonceRef = useRef(0);
  const hasPendingLocalEditRef = useRef(false);
  const pendingComposerDraftRef = useRef<string | null>(null);
  const composerDraftWriteTimerRef = useRef<number | null>(null);
  const flushComposerDraftRef = useRef<() => void>(() => {});

  composerDraftRef.current = composerDraft;
  const persistedComposerDraft = snapshot?.composerDraft ?? "";
  const setComposerDraft = useCallback((nextDraft: SetStateAction<string>) => {
    setComposerDraftState((currentDraft) => {
      const resolvedDraft = typeof nextDraft === "function" ? nextDraft(currentDraft) : nextDraft;
      if (resolvedDraft !== currentDraft) {
        hasPendingLocalEditRef.current = true;
      }
      return resolvedDraft;
    });
  }, []);

  useEffect(() => {
    if (!snapshot) {
      return;
    }

    if (hydratedComposerSessionKeyRef.current !== selectedSessionKey) {
      hydratedComposerSessionKeyRef.current = selectedSessionKey;
      handledComposerSyncNonceRef.current = snapshot.composerDraftSyncNonce;
      hasPendingLocalEditRef.current = false;
      pendingComposerDraftRef.current = null;
      setComposerDraftState(snapshot.composerDraft);
      return;
    }

    if (snapshot.composerDraftSyncNonce === handledComposerSyncNonceRef.current) {
      return;
    }

    handledComposerSyncNonceRef.current = snapshot.composerDraftSyncNonce;
    if (
      hasPendingLocalEditRef.current &&
      (snapshot.composerDraftSyncSource === "persist" || snapshot.composerDraftSyncSource === "state")
    ) {
      return;
    }

    hasPendingLocalEditRef.current = false;
    pendingComposerDraftRef.current = null;
    setComposerDraftState(snapshot.composerDraft);
  }, [
    selectedSessionKey,
    snapshot?.composerDraft,
    snapshot?.composerDraftSyncNonce,
    snapshot?.composerDraftSyncSource,
  ]);

  useEffect(() => {
    if (composerDraft === persistedComposerDraft) {
      hasPendingLocalEditRef.current = false;
      pendingComposerDraftRef.current = null;
      return undefined;
    }
    if (!api || !hasPendingLocalEditRef.current) {
      return undefined;
    }

    pendingComposerDraftRef.current = composerDraft;
    const timeout = window.setTimeout(() => {
      composerDraftWriteTimerRef.current = null;
      pendingComposerDraftRef.current = null;
      void api.updateComposerDraft(composerDraft);
    }, 350);
    composerDraftWriteTimerRef.current = timeout;

    // Only the timer is cancelled here (each keystroke reschedules it); the pending value stays in
    // pendingComposerDraftRef so a session switch can flush it before the active session changes.
    return () => {
      window.clearTimeout(timeout);
      composerDraftWriteTimerRef.current = null;
    };
  }, [api, composerDraft, persistedComposerDraft]);

  useEffect(() => () => flushComposerDraftRef.current(), []);

  const flushComposerDraft = () => {
    if (composerDraftWriteTimerRef.current !== null) {
      window.clearTimeout(composerDraftWriteTimerRef.current);
      composerDraftWriteTimerRef.current = null;
    }
    const pending = pendingComposerDraftRef.current;
    pendingComposerDraftRef.current = null;
    if (pending !== null && api) {
      void api.updateComposerDraft(pending);
    }
  };
  flushComposerDraftRef.current = flushComposerDraft;

  return { composerDraft, setComposerDraft, composerDraftRef, flushComposerDraft };
}
