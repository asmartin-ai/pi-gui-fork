import { randomUUID } from "node:crypto";
import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import { sessionKey } from "@pi-gui/pi-sdk-driver";
import type { SessionDriverEvent, SessionRef } from "@pi-gui/session-driver";
import type {
  DesktopAppState,
  OrchestrationChildThread,
  OrchestrationChildThreadStatus,
  OrchestrationChildTranscriptMessage,
  SendChildThreadFollowUpInput,
  TimelineToolCall,
  TranscriptMessage,
} from "../src/desktop-state";
import { submitComposerToSession } from "./app-store-composer";
import type { AppStoreInternals } from "./app-store-internals";
import { latestSessionActivityAt, previewFromTranscript } from "./app-store-utils";
import {
  createChildThreadAction,
  createChildThreadPromptFromToolOutput,
  createChildThreadToolName,
  listThreadsAction,
  listThreadsRequestedFromToolOutput,
  listThreadsToolName,
  readThreadAction,
  readThreadIdFromToolOutput,
  readThreadToolName,
  sendMessageToThreadAction,
  sendMessageToThreadFromToolOutput,
  sendMessageToThreadToolName,
} from "./orchestration-runtime";
import type {
  CreateChildThreadToolDetails,
  ListThreadsToolDetails,
  OrchestrationThreadListEntry,
  ReadThreadToolDetails,
  SendMessageToThreadToolDetails,
} from "./orchestration-runtime";

const CHILD_TITLE_LIMIT = 56;
const MAX_CHILD_TRANSCRIPT_MESSAGES = 40;
const MAX_READ_THREAD_MESSAGES = 60;
const pendingCreateChildThreadToolCalls = new Set<string>();

interface SpawnChildThreadInput {
  readonly parentWorkspaceId: string;
  readonly parentSessionId: string;
  readonly prompt: string;
  readonly sourceToolCallId?: string;
}

async function spawnChildThread(
  store: AppStoreInternals,
  input: SpawnChildThreadInput,
): Promise<DesktopAppState> {
  try {
    await createChildThreadRecord(store, input);
    return structuredClone(store.state);
  } catch (error) {
    return store.withError(error);
  }
}

async function createChildThreadRecord(
  store: AppStoreInternals,
  input: SpawnChildThreadInput,
): Promise<OrchestrationChildThread> {
  await store.initialize();
  const prompt = input.prompt.trim();
  if (!prompt) {
    throw new Error("Child thread prompt cannot be empty.");
  }

  const parent = store.sessionFromState({
    workspaceId: input.parentWorkspaceId,
    sessionId: input.parentSessionId,
  });
  if (!parent) {
    throw new Error("Select a parent thread before spawning a child.");
  }

  const workspace = store.workspaceRefFromState(input.parentWorkspaceId);
  if (!workspace) {
    throw new Error(`Unknown workspace: ${input.parentWorkspaceId}`);
  }

  const pendingKey = input.sourceToolCallId ? childToolCallKey(input) : undefined;
  if (pendingKey && pendingCreateChildThreadToolCalls.has(pendingKey)) {
    throw new Error("Child thread creation is already in progress.");
  }

  const existing = input.sourceToolCallId ? childForToolCall(store, input) : undefined;
  if (existing) {
    return existing;
  }

  if (pendingKey) {
    pendingCreateChildThreadToolCalls.add(pendingKey);
  }
  try {
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
      ...(input.sourceToolCallId ? { sourceToolCallId: input.sourceToolCallId } : {}),
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
    await store.refreshState({
      selectedWorkspaceId: input.parentWorkspaceId,
      selectedSessionId: input.parentSessionId,
      clearLastError: true,
      activeView: "threads",
      emitState: false,
      persistState: false,
      publishSelectedTranscript: false,
    });

    void submitComposerToSession(store, childRef, prompt, [], {
      deliverAs: "followUp",
      allowCommands: false,
    }).catch((error) => {
      void store.withError(error);
    });

    return store.state.orchestrationChildren.find((entry) => entry.id === child.id) ?? child;
  } finally {
    if (pendingKey) {
      pendingCreateChildThreadToolCalls.delete(pendingKey);
    }
  }
}

async function handleCreateChildThreadToolResult(
  store: AppStoreInternals,
  event: Extract<SessionDriverEvent, { type: "toolFinished" }>,
): Promise<boolean> {
  if (!event.success) {
    return false;
  }

  const tool = toolCallForFinishedEvent(store, event);
  if (!tool || tool.toolName !== createChildThreadToolName) {
    return false;
  }

  const finalOutput = finalThreadToolProjectionFromOutput(event.output);
  if (finalOutput) {
    updateThreadToolOutput(store, event, finalOutput);
    return true;
  }

  const prompt = createChildThreadPromptFromToolOutput(event.output);
  if (!prompt) {
    return false;
  }

  await spawnChildThread(store, {
    parentWorkspaceId: event.sessionRef.workspaceId,
    parentSessionId: event.sessionRef.sessionId,
    prompt,
    sourceToolCallId: event.callId,
  });

  const child = childForToolCall(store, {
    parentWorkspaceId: event.sessionRef.workspaceId,
    parentSessionId: event.sessionRef.sessionId,
    sourceToolCallId: event.callId,
  });
  if (!child) {
    return false;
  }

  updateCreateChildThreadToolOutput(store, event, prompt, child);
  return true;
}

export async function handleOrchestrationThreadToolResult(
  store: AppStoreInternals,
  event: Extract<SessionDriverEvent, { type: "toolFinished" }>,
): Promise<boolean> {
  if (!event.success) {
    return false;
  }

  const tool = toolCallForFinishedEvent(store, event);
  if (!tool) {
    return false;
  }

  if (tool.toolName === createChildThreadToolName) {
    return handleCreateChildThreadToolResult(store, event);
  }

  if (tool.toolName === listThreadsToolName && listThreadsRequestedFromToolOutput(event.output)) {
    updateListThreadsToolOutput(store, event);
    return true;
  }

  if (tool.toolName === readThreadToolName) {
    await updateReadThreadToolOutput(store, event);
    return true;
  }

  if (tool.toolName === sendMessageToThreadToolName) {
    await updateSendMessageToThreadToolOutput(store, event);
    return true;
  }

  return false;
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

export async function createChildThreadToolResult(
  store: AppStoreInternals,
  parentRef: SessionRef,
  input: { readonly prompt: string; readonly toolCallId: string },
): Promise<AgentToolResult<CreateChildThreadToolDetails>> {
  const child = await createChildThreadRecord(store, {
    parentWorkspaceId: parentRef.workspaceId,
    parentSessionId: parentRef.sessionId,
    prompt: input.prompt,
    sourceToolCallId: input.toolCallId,
  });
  const details: CreateChildThreadToolDetails = {
    action: createChildThreadAction,
    prompt: input.prompt.trim(),
    childThreadId: child.id,
    childWorkspaceId: child.childWorkspaceId,
    childSessionId: child.childSessionId,
    title: child.title,
  };

  return {
    content: [{ type: "text", text: formatCreateChildThreadResult(details) }],
    details,
  };
}

function updateListThreadsToolOutput(
  store: AppStoreInternals,
  event: Extract<SessionDriverEvent, { type: "toolFinished" }>,
): void {
  updateThreadToolOutput(
    store,
    event,
    finalThreadToolProjectionFromOutput(event.output) ??
      projectionFromToolResult(listThreadsToolResult(store, event.sessionRef)),
  );
}

async function updateReadThreadToolOutput(
  store: AppStoreInternals,
  event: Extract<SessionDriverEvent, { type: "toolFinished" }>,
): Promise<void> {
  const finalOutput = finalThreadToolProjectionFromOutput(event.output);
  if (finalOutput) {
    updateThreadToolOutput(store, event, finalOutput);
    return;
  }

  const threadId = readThreadIdFromToolOutput(event.output);
  if (!threadId) {
    updateThreadToolOutput(
      store,
      event,
      projectionFromToolResult(readThreadErrorResult("", "read_thread requires a thread_id.")),
    );
    return;
  }

  updateThreadToolOutput(
    store,
    event,
    projectionFromToolResult(await readThreadToolResult(store, event.sessionRef, threadId)),
  );
}

async function updateSendMessageToThreadToolOutput(
  store: AppStoreInternals,
  event: Extract<SessionDriverEvent, { type: "toolFinished" }>,
): Promise<void> {
  const finalOutput = finalThreadToolProjectionFromOutput(event.output);
  if (finalOutput) {
    updateThreadToolOutput(store, event, finalOutput);
    return;
  }

  const request = sendMessageToThreadFromToolOutput(event.output);
  if (!request) {
    updateThreadToolOutput(
      store,
      event,
      projectionFromToolResult(sendMessageToThreadErrorResult("", "", "send_message_to_thread requires thread_id and message.")),
    );
    return;
  }

  updateThreadToolOutput(
    store,
    event,
    projectionFromToolResult(await sendMessageToThreadToolResult(store, event.sessionRef, request)),
  );
}

export function listThreadsToolResult(
  store: AppStoreInternals,
  parentRef: SessionRef,
): AgentToolResult<ListThreadsToolDetails> {
  const threads = listThreadsForContext(store, parentRef);
  return {
    content: [{ type: "text", text: formatThreadList(threads) }],
    details: {
      action: listThreadsAction,
      threads,
    },
  };
}

export async function readThreadToolResult(
  store: AppStoreInternals,
  parentRef: SessionRef,
  threadId: string,
): Promise<AgentToolResult<ReadThreadToolDetails>> {
  const target = resolveThreadTarget(store, parentRef, threadId);
  if (!target) {
    return readThreadErrorResult(threadId, `Unknown thread: ${threadId}`);
  }

  await store.ensureSessionReady(target.sessionRef);
  const transcript = store.sessionState.transcriptCache.get(sessionKey(target.sessionRef)) ?? [];
  const session = store.sessionFromState(target.sessionRef);
  const messages = toThreadReadMessages(transcript);
  const title = session?.title ?? target.child?.title ?? target.sessionRef.sessionId;
  const status = target.child?.status ?? session?.status ?? "unknown";
  const details: ReadThreadToolDetails = {
    action: readThreadAction,
    threadId,
    workspaceId: target.sessionRef.workspaceId,
    sessionId: target.sessionRef.sessionId,
    title,
    status,
    ...(target.child
      ? {
          childThreadId: target.child.id,
          goal: target.child.goal,
        }
      : {}),
    messages,
  };

  return {
    content: [{ type: "text", text: formatThreadReadResult({ ...details, title, status, messages }) }],
    details,
  };
}

export async function sendMessageToThreadToolResult(
  store: AppStoreInternals,
  parentRef: SessionRef,
  input: { readonly threadId: string; readonly message: string },
): Promise<AgentToolResult<SendMessageToThreadToolDetails>> {
  const target = resolveThreadTarget(store, parentRef, input.threadId);
  if (!target) {
    return sendMessageToThreadErrorResult(input.threadId, input.message, `Unknown thread: ${input.threadId}`);
  }

  await submitComposerToSession(store, target.sessionRef, input.message, [], {
    deliverAs: "followUp",
    allowCommands: false,
  });

  const queuedMessages = store.getQueuedComposerMessages(target.sessionRef);
  const status = queuedMessages.length > 0 ? "queued" : "sent";
  const details: SendMessageToThreadToolDetails = {
    action: sendMessageToThreadAction,
    threadId: input.threadId,
    workspaceId: target.sessionRef.workspaceId,
    sessionId: target.sessionRef.sessionId,
    status,
    queuedMessageCount: queuedMessages.length,
    message: input.message,
  };

  return {
    content: [{ type: "text", text: formatSendMessageToThreadResult(details) }],
    details,
  };
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
    const transcript = toChildTranscript(rawTranscript, MAX_CHILD_TRANSCRIPT_MESSAGES);
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

function updateCreateChildThreadToolOutput(
  store: AppStoreInternals,
  event: Extract<SessionDriverEvent, { type: "toolFinished" }>,
  prompt: string,
  child: OrchestrationChildThread,
): void {
  updateThreadToolOutput(store, event, {
    detail: `Created child thread: ${child.title}`,
    text: `Created child thread: ${child.title}`,
    details: {
      action: createChildThreadAction,
      prompt,
      childThreadId: child.id,
      childWorkspaceId: child.childWorkspaceId,
      childSessionId: child.childSessionId,
      title: child.title,
    },
  });
}

function updateThreadToolOutput(
  store: AppStoreInternals,
  event: Extract<SessionDriverEvent, { type: "toolFinished" }>,
  output: {
    readonly detail: string;
    readonly text: string;
    readonly details: Readonly<Record<string, unknown>>;
    readonly status?: TimelineToolCall["status"];
  },
): void {
  const key = sessionKey(event.sessionRef);
  const transcript = [...(store.sessionState.transcriptCache.get(key) ?? [])];
  const index = transcript.findIndex((item) => item.kind === "tool" && item.callId === event.callId);
  const item = transcript[index];
  if (!item || !isTimelineToolCall(item)) {
    return;
  }
  transcript[index] = {
    ...item,
    status: output.status ?? item.status,
    detail: output.detail,
    output: {
      content: [
        {
          type: "text",
          text: output.text,
        },
      ],
      details: output.details,
    },
  };
  store.sessionState.transcriptCache.set(key, transcript);
}

function toolCallForFinishedEvent(
  store: AppStoreInternals,
  event: Extract<SessionDriverEvent, { type: "toolFinished" }>,
): TimelineToolCall | undefined {
  const transcript = store.sessionState.transcriptCache.get(sessionKey(event.sessionRef));
  return transcript?.find(
    (item): item is TimelineToolCall => isTimelineToolCall(item) && item.callId === event.callId,
  );
}

type ThreadListEntry = OrchestrationThreadListEntry;

interface ResolvedThreadTarget {
  readonly sessionRef: SessionRef;
  readonly child?: OrchestrationChildThread;
}

function readThreadErrorResult(
  threadId: string,
  error: string,
): AgentToolResult<ReadThreadToolDetails> {
  return {
    content: [{ type: "text", text: error }],
    details: {
      action: readThreadAction,
      threadId,
      error,
    },
  };
}

function sendMessageToThreadErrorResult(
  threadId: string,
  message: string,
  error: string,
): AgentToolResult<SendMessageToThreadToolDetails> {
  return {
    content: [{ type: "text", text: error }],
    details: {
      action: sendMessageToThreadAction,
      threadId,
      message,
      error,
    },
  };
}

function projectionFromToolResult(
  result: AgentToolResult<
    CreateChildThreadToolDetails | ListThreadsToolDetails | ReadThreadToolDetails | SendMessageToThreadToolDetails
  >,
): {
  readonly detail: string;
  readonly text: string;
  readonly details: Readonly<Record<string, unknown>>;
  readonly status?: TimelineToolCall["status"];
} {
  const details = result.details as unknown as Readonly<Record<string, unknown>>;
  return {
    detail: detailFromThreadToolDetails(details),
    text: textFromAgentToolResult(result),
    details,
    ...(typeof details.error === "string" ? { status: "error" as const } : {}),
  };
}

function finalThreadToolProjectionFromOutput(output: unknown):
  | {
      readonly detail: string;
      readonly text: string;
      readonly details: Readonly<Record<string, unknown>>;
      readonly status?: TimelineToolCall["status"];
    }
  | undefined {
  if (!isRecord(output) || !isRecord(output.details) || !isFinalThreadToolDetails(output.details)) {
    return undefined;
  }
  return {
    detail: detailFromThreadToolDetails(output.details),
    text: textFromToolOutput(output),
    details: output.details,
    ...(typeof output.details.error === "string" ? { status: "error" as const } : {}),
  };
}

function isFinalThreadToolDetails(details: Record<string, unknown>): boolean {
  if (typeof details.error === "string") {
    return true;
  }
  if (details.action === listThreadsAction) {
    return Array.isArray(details.threads);
  }
  if (details.action === createChildThreadAction) {
    return typeof details.childThreadId === "string";
  }
  if (details.action === readThreadAction) {
    return Array.isArray(details.messages);
  }
  if (details.action === sendMessageToThreadAction) {
    return details.status === "queued" || details.status === "sent";
  }
  return false;
}

function detailFromThreadToolDetails(details: Readonly<Record<string, unknown>>): string {
  if (typeof details.error === "string") {
    return details.error;
  }
  if (details.action === listThreadsAction) {
    const count = Array.isArray(details.threads) ? details.threads.length : 0;
    return `Listed ${count} thread${count === 1 ? "" : "s"}`;
  }
  if (details.action === createChildThreadAction) {
    const title = typeof details.title === "string"
      ? details.title
      : typeof details.prompt === "string"
        ? details.prompt
        : "unknown";
    return `Created child thread: ${title}`;
  }
  if (details.action === readThreadAction) {
    const title = typeof details.title === "string"
      ? details.title
      : typeof details.threadId === "string"
        ? details.threadId
        : "unknown";
    return `Read thread: ${title}`;
  }
  if (details.action === sendMessageToThreadAction) {
    const verb = details.status === "queued" ? "Queued" : "Sent";
    return `${verb} message to thread: ${typeof details.threadId === "string" ? details.threadId : "unknown"}`;
  }
  return "Thread tool result";
}

function textFromAgentToolResult(result: AgentToolResult<unknown>): string {
  return result.content
    .map((item) => item.type === "text" ? item.text : "")
    .filter(Boolean)
    .join("\n");
}

function textFromToolOutput(output: { readonly content?: unknown }): string {
  if (!Array.isArray(output.content)) {
    return "";
  }
  return output.content
    .map((item) => (isRecord(item) && item.type === "text" && typeof item.text === "string" ? item.text : ""))
    .filter(Boolean)
    .join("\n");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function listThreadsForContext(store: AppStoreInternals, parentRef: SessionRef): readonly ThreadListEntry[] {
  const entries = new Map<string, ThreadListEntry>();
  const parentChildren = store.state.orchestrationChildren.filter(
    (child) => child.parentWorkspaceId === parentRef.workspaceId && child.parentSessionId === parentRef.sessionId,
  );
  const childSessionKeys = new Map(
    parentChildren.map((child) => [sessionKey(childSessionRef(child)), child] as const),
  );

  for (const workspace of store.state.workspaces) {
    if (workspace.id !== parentRef.workspaceId && !parentChildren.some((child) => child.childWorkspaceId === workspace.id)) {
      continue;
    }
    for (const session of workspace.sessions) {
      if (session.archivedAt) {
        continue;
      }
      const key = sessionKey({ workspaceId: workspace.id, sessionId: session.id });
      const child = childSessionKeys.get(key);
      entries.set(key, {
        threadId: child?.id ?? session.id,
        workspaceId: workspace.id,
        sessionId: session.id,
        title: child?.title ?? session.title,
        status: child?.status ?? session.status,
        relationship: child ? "child" : session.id === parentRef.sessionId && workspace.id === parentRef.workspaceId ? "current" : "workspace",
        updatedAt: child?.updatedAt ?? session.updatedAt,
        preview: child?.latestTranscript ?? session.preview,
        ...(child ? { childThreadId: child.id } : {}),
      });
    }
  }

  for (const child of parentChildren) {
    const key = sessionKey(childSessionRef(child));
    if (entries.has(key)) {
      continue;
    }
    entries.set(key, {
      threadId: child.id,
      workspaceId: child.childWorkspaceId,
      sessionId: child.childSessionId,
      title: child.title,
      status: child.status,
      relationship: "child",
      updatedAt: child.updatedAt,
      preview: child.latestTranscript,
      childThreadId: child.id,
    });
  }

  return [...entries.values()].sort((left, right) => {
    const rank = relationshipRank(left.relationship) - relationshipRank(right.relationship);
    if (rank !== 0) {
      return rank;
    }
    if (left.updatedAt !== right.updatedAt) {
      return right.updatedAt.localeCompare(left.updatedAt);
    }
    return left.title.localeCompare(right.title);
  });
}

function relationshipRank(relationship: ThreadListEntry["relationship"]): number {
  if (relationship === "current") {
    return 0;
  }
  if (relationship === "child") {
    return 1;
  }
  return 2;
}

function resolveThreadTarget(
  store: AppStoreInternals,
  parentRef: SessionRef,
  threadId: string,
): ResolvedThreadTarget | undefined {
  const normalized = threadId.trim();
  if (!normalized) {
    return undefined;
  }

  const visibleThread = listThreadsForContext(store, parentRef).find(
    (thread) =>
      thread.threadId === normalized ||
      thread.sessionId === normalized ||
      thread.childThreadId === normalized ||
      `${thread.workspaceId}:${thread.sessionId}` === normalized,
  );
  if (!visibleThread) {
    return undefined;
  }

  const child = visibleThread.childThreadId
    ? store.state.orchestrationChildren.find((entry) => entry.id === visibleThread.childThreadId)
    : undefined;
  return {
    sessionRef: {
      workspaceId: visibleThread.workspaceId,
      sessionId: visibleThread.sessionId,
    },
    ...(child ? { child } : {}),
  };
}

function formatThreadList(threads: readonly ThreadListEntry[]): string {
  if (threads.length === 0) {
    return "No visible threads.";
  }
  return [
    "Visible threads:",
    ...threads.map((thread) =>
      `- ${thread.threadId} (${thread.relationship}, ${thread.status}): ${thread.title}` +
      (thread.preview ? ` - ${thread.preview}` : ""),
    ),
  ].join("\n");
}

function formatThreadReadResult(result: {
  readonly threadId: string;
  readonly title: string;
  readonly status: string;
  readonly goal?: string;
  readonly messages: readonly OrchestrationChildTranscriptMessage[];
}): string {
  const lines = [
    `Thread ${result.threadId}: ${result.title}`,
    `Status: ${result.status}`,
    ...(result.goal ? [`Goal: ${result.goal}`] : []),
    "Transcript:",
  ];
  if (result.messages.length === 0) {
    lines.push("- No transcript messages loaded.");
  } else {
    lines.push(...result.messages.map((message) => `- ${message.role}: ${message.text}`));
  }
  return lines.join("\n");
}

function formatCreateChildThreadResult(result: CreateChildThreadToolDetails): string {
  return `Created child thread: ${result.title ?? result.prompt}\n` +
    `childThreadId: ${result.childThreadId ?? ""}\n` +
    `childWorkspaceId: ${result.childWorkspaceId ?? ""}\n` +
    `childSessionId: ${result.childSessionId ?? ""}`;
}

function formatSendMessageToThreadResult(result: SendMessageToThreadToolDetails): string {
  const verb = result.status === "queued" ? "Queued" : "Sent";
  return `${verb} message to thread ${result.threadId}.` +
    (result.queuedMessageCount && result.queuedMessageCount > 0 ? ` Pending messages: ${result.queuedMessageCount}.` : "");
}

function toThreadReadMessages(transcript: readonly TranscriptMessage[]): readonly OrchestrationChildTranscriptMessage[] {
  return toChildTranscript(transcript, MAX_READ_THREAD_MESSAGES);
}

function childForToolCall(
  store: AppStoreInternals,
  input: Pick<SpawnChildThreadInput, "parentWorkspaceId" | "parentSessionId" | "sourceToolCallId">,
): OrchestrationChildThread | undefined {
  if (!input.sourceToolCallId) {
    return undefined;
  }
  return store.state.orchestrationChildren.find(
    (child) =>
      child.sourceToolCallId === input.sourceToolCallId &&
      child.parentWorkspaceId === input.parentWorkspaceId &&
      child.parentSessionId === input.parentSessionId,
  );
}

function childToolCallKey(
  input: Pick<SpawnChildThreadInput, "parentWorkspaceId" | "parentSessionId" | "sourceToolCallId">,
): string {
  return `${input.parentWorkspaceId}\0${input.parentSessionId}\0${input.sourceToolCallId ?? ""}`;
}

function isTimelineToolCall(value: TranscriptMessage): value is TimelineToolCall {
  return (
    value.kind === "tool" &&
    "callId" in value &&
    "toolName" in value &&
    "status" in value &&
    typeof value.callId === "string" &&
    typeof value.toolName === "string"
  );
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
  limit: number,
): readonly OrchestrationChildTranscriptMessage[] {
  const messages: OrchestrationChildTranscriptMessage[] = [];
  for (let index = transcript.length - 1; index >= 0 && messages.length < limit; index -= 1) {
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
