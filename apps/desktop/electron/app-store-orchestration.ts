import { randomUUID } from "node:crypto";
import type {
  DesktopAppState,
  OrchestrationChildThread,
  OrchestrationChildTranscriptMessage,
  SendChildThreadFollowUpInput,
  SpawnChildThreadInput,
} from "../src/desktop-state";
import type { AppStoreInternals } from "./app-store-internals";

const CHILD_TITLE_LIMIT = 56;
const MAX_MOCK_CHILD_TRANSCRIPT_MESSAGES = 40;

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

  return store.withErrorHandling(async () => {
    const now = new Date().toISOString();
    const transcript = retainRecentTranscriptMessages([
      {
        id: randomUUID(),
        role: "parent",
        text: prompt,
        createdAt: now,
      },
      {
        id: randomUUID(),
        role: "system",
        text: "Mock child thread created. Real spawning will attach here when the app thread service is wired.",
        createdAt: now,
      },
    ]);
    const child: OrchestrationChildThread = {
      id: randomUUID(),
      parentWorkspaceId: input.parentWorkspaceId,
      parentSessionId: input.parentSessionId,
      title: titleFromPrompt(prompt),
      goal: prompt,
      status: "running",
      latestTranscript: transcript.at(-1)?.text ?? prompt,
      transcript,
      mocked: true,
      createdAt: now,
      updatedAt: now,
    };

    store.state = {
      ...store.state,
      orchestrationChildren: [child, ...store.state.orchestrationChildren],
      lastError: undefined,
      revision: store.state.revision + 1,
    };
    await store.persistUiState();
    return store.emit();
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

  return store.withErrorHandling(async () => {
    let found = false;
    const now = new Date().toISOString();
    const nextChildren = store.state.orchestrationChildren.map((child) => {
      if (child.id !== input.childThreadId) {
        return child;
      }
      found = true;
      const transcript = retainRecentTranscriptMessages([
        ...child.transcript,
        {
          id: randomUUID(),
          role: "parent",
          text,
          createdAt: now,
        },
        {
          id: randomUUID(),
          role: "child",
          text: `Mock follow-up received: ${text}`,
          createdAt: now,
        },
      ]);
      return {
        ...child,
        status: "waiting" as const,
        latestTranscript: transcript.at(-1)?.text ?? text,
        transcript,
        updatedAt: now,
      };
    });

    if (!found) {
      return store.withError("Unknown child thread.");
    }

    store.state = {
      ...store.state,
      orchestrationChildren: nextChildren,
      lastError: undefined,
      revision: store.state.revision + 1,
    };
    await store.persistUiState();
    return store.emit();
  });
}

function retainRecentTranscriptMessages(
  transcript: readonly OrchestrationChildTranscriptMessage[],
): readonly OrchestrationChildTranscriptMessage[] {
  return transcript.slice(-MAX_MOCK_CHILD_TRANSCRIPT_MESSAGES);
}

function titleFromPrompt(prompt: string): string {
  const normalized = prompt.replace(/\s+/g, " ").trim();
  if (normalized.length <= CHILD_TITLE_LIMIT) {
    return normalized;
  }
  return `${normalized.slice(0, CHILD_TITLE_LIMIT - 3).trimEnd()}...`;
}
