import { randomUUID } from "node:crypto";
import { sessionKey } from "@pi-gui/pi-sdk-driver";
import type { SessionRef } from "@pi-gui/session-driver";
import type {
  DesktopAppState,
  OrchestrationChildThread,
  OrchestrationChildThreadStatus,
  OrchestrationChildTranscriptMessage,
  SendChildThreadFollowUpInput,
  SpawnChildThreadInput,
  TranscriptMessage,
} from "../src/desktop-state";
import { submitComposerToSession } from "./app-store-composer";
import type { AppStoreInternals } from "./app-store-internals";
import { latestSessionActivityAt, previewFromTranscript } from "./app-store-utils";

const CHILD_TITLE_LIMIT = 56;
const MAX_CHILD_TRANSCRIPT_MESSAGES = 40;

export async function spawnChildThread(
  store: AppStoreInternals,
  input: SpawnChildThreadInput,
): Promise<DesktopAppState> {
  await store.initialize();
  const prompt = input.prompt.trim();
  if (!prompt) {
    return store.withError("Child thread prompt cannot be empty.");
  }

  const parent = store.sessionFromState({
    workspaceId: input.parentWorkspaceId,
    sessionId: input.parentSessionId,
  });
  if (!parent) {
    return store.withError("Select a parent thread before spawning a child.");
  }

  const workspace = store.workspaceRefFromState(input.parentWorkspaceId);
  if (!workspace) {
    return store.withError(`Unknown workspace: ${input.parentWorkspaceId}`);
  }

  return store.withErrorHandling(async () => {
    const createOptions = await store.buildCreateSessionOptions(input.parentWorkspaceId);
    const session = await store.driver.createSession(workspace, {
      ...createOptions,
      title: titleFromPrompt(prompt),
    });
    const childRef = session.ref;
    const key = sessionKey(childRef);
    store.sessionState.transcriptCache.set(key, []);
    store.sessionState.loadedTranscriptKeys.add(key);
    store.updateSessionConfig(childRef, session.config);
    await store.ensureSessionSubscription(childRef);

    const now = new Date().toISOString();
    const child: OrchestrationChildThread = {
      id: randomUUID(),
      parentWorkspaceId: input.parentWorkspaceId,
      parentSessionId: input.parentSessionId,
      childWorkspaceId: childRef.workspaceId,
      childSessionId: childRef.sessionId,
      title: session.title || titleFromPrompt(prompt),
      goal: prompt,
      status: toOrchestrationStatus(session.status, childRef, store),
      latestTranscript: session.preview || prompt,
      transcript: [],
      createdAt: now,
      updatedAt: session.updatedAt || now,
    };

    store.state = {
      ...store.state,
      orchestrationChildren: projectOrchestrationChildren(store, [child, ...store.state.orchestrationChildren]),
    };
    const state = await store.refreshState({
      selectedWorkspaceId: input.parentWorkspaceId,
      selectedSessionId: input.parentSessionId,
      clearLastError: true,
      activeView: "threads",
    });

    void submitComposerToSession(store, childRef, prompt, [], {
      deliverAs: "followUp",
      allowCommands: false,
    }).catch((error) => {
      void store.withError(error);
    });

    return state;
  });
}

export async function sendChildThreadFollowUp(
  store: AppStoreInternals,
  input: SendChildThreadFollowUpInput,
): Promise<DesktopAppState> {
  await store.initialize();
  const text = input.text.trim();
  if (!text) {
    return store.withError("Child thread follow-up cannot be empty.");
  }

  const child = store.state.orchestrationChildren.find((entry) => entry.id === input.childThreadId);
  if (!child) {
    return store.withError("Unknown child thread.");
  }
  if (!child.childSessionId) {
    return store.withError("Legacy child thread records are read-only.");
  }

  const childRef = childSessionRef(child);
  if (!store.sessionFromState(childRef)) {
    return store.withError("Child thread session is no longer available.");
  }

  return submitComposerToSession(store, childRef, text, [], {
    deliverAs: "followUp",
    allowCommands: false,
  });
}

export function projectOrchestrationChildren(
  store: AppStoreInternals,
  children: readonly OrchestrationChildThread[] = store.state.orchestrationChildren,
): readonly OrchestrationChildThread[] {
  return children.map((child) => {
    if (!child.childSessionId) {
      return child;
    }
    const childRef = childSessionRef(child);
    const key = sessionKey(childRef);
    const session = store.sessionFromState(childRef);
    const rawTranscript = recentTranscriptItems(store.sessionState.transcriptCache.get(key) ?? []);
    const transcript = toChildTranscript(rawTranscript);
    const latestTranscript = session?.preview || previewFromTranscript(rawTranscript) || child.goal;
    const updatedAt = latestSessionActivityAt(session?.updatedAt ?? child.updatedAt, rawTranscript);

    return {
      ...child,
      title: session?.title || child.title,
      status: session ? toOrchestrationStatus(session.status, childRef, store) : child.status,
      latestTranscript,
      transcript,
      updatedAt,
    };
  });
}

export async function hydrateOrchestrationChildren(store: AppStoreInternals): Promise<void> {
  await hydrateVisibleOrchestrationChildren(store);
}

export async function hydrateVisibleOrchestrationChildren(store: AppStoreInternals): Promise<void> {
  const visibleChildren = store.state.orchestrationChildren.filter(
    (child) =>
      child.parentWorkspaceId === store.state.selectedWorkspaceId &&
      child.parentSessionId === store.state.selectedSessionId,
  );
  const seen = new Set<string>();
  const hydrationTasks: Promise<unknown>[] = [];
  for (const child of visibleChildren) {
    if (!child.childSessionId) {
      continue;
    }
    const childRef = childSessionRef(child);
    const key = sessionKey(childRef);
    if (seen.has(key) || !store.sessionFromState(childRef) || store.sessionState.loadedTranscriptKeys.has(key)) {
      continue;
    }
    seen.add(key);
    hydrationTasks.push(
      store.ensureSessionReady(childRef).catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        store.sessionState.sessionErrorsBySession.set(key, message);
      }),
    );
  }
  await Promise.all(hydrationTasks);
}

export function hasOrchestrationChildSession(
  children: readonly OrchestrationChildThread[],
  sessionRef: SessionRef,
): boolean {
  return children.some(
    (child) =>
      Boolean(child.childSessionId) &&
      child.childWorkspaceId === sessionRef.workspaceId &&
      child.childSessionId === sessionRef.sessionId,
  );
}

export function toPersistedOrchestrationChildren(
  children: readonly OrchestrationChildThread[],
): readonly OrchestrationChildThread[] | undefined {
  if (children.length === 0) {
    return undefined;
  }
  return children.map((child) => ({
    ...child,
    latestTranscript: child.childSessionId ? child.goal : child.latestTranscript,
    transcript: child.childSessionId ? [] : child.transcript,
  }));
}

function childSessionRef(child: OrchestrationChildThread): SessionRef {
  return {
    workspaceId: child.childWorkspaceId,
    sessionId: child.childSessionId,
  };
}

function toOrchestrationStatus(
  status: string,
  sessionRef: SessionRef,
  store: AppStoreInternals,
): OrchestrationChildThreadStatus {
  if (store.getQueuedComposerMessages(sessionRef).length > 0) {
    return "waiting";
  }
  if (status === "failed") {
    return "failed";
  }
  if (status === "running") {
    return "running";
  }
  return "complete";
}

function toChildTranscript(
  transcript: readonly TranscriptMessage[],
): readonly OrchestrationChildTranscriptMessage[] {
  const messages: OrchestrationChildTranscriptMessage[] = [];
  for (let index = transcript.length - 1; index >= 0 && messages.length < MAX_CHILD_TRANSCRIPT_MESSAGES; index -= 1) {
    const message = transcript[index];
    if (!message) {
      continue;
    }
    const text = transcriptText(message);
    if (!text) {
      continue;
    }
    messages.push({
      id: message.id,
      role: transcriptRole(message),
      text,
      createdAt: message.createdAt,
    });
  }
  return messages.reverse();
}

function recentTranscriptItems(transcript: readonly TranscriptMessage[]): readonly TranscriptMessage[] {
  return transcript.slice(-MAX_CHILD_TRANSCRIPT_MESSAGES);
}

function transcriptText(message: TranscriptMessage): string {
  if (message.kind === "message") {
    return message.text;
  }
  if (message.kind === "activity") {
    return message.detail ? `${message.label}: ${message.detail}` : message.label;
  }
  if (message.kind === "tool") {
    return message.detail ? `${message.label}: ${message.detail}` : message.label;
  }
  return message.metadata ? `${message.label}: ${message.metadata}` : message.label;
}

function transcriptRole(message: TranscriptMessage): OrchestrationChildTranscriptMessage["role"] {
  if (message.kind !== "message") {
    return "system";
  }
  if (message.role === "user") {
    return "parent";
  }
  if (message.role === "assistant") {
    return "child";
  }
  return "system";
}

function titleFromPrompt(prompt: string): string {
  const normalized = prompt.replace(/\s+/g, " ").trim();
  if (normalized.length <= CHILD_TITLE_LIMIT) {
    return normalized;
  }
  return `${normalized.slice(0, CHILD_TITLE_LIMIT - 3).trimEnd()}...`;
}
