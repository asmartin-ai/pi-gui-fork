import type {
  AppView,
  ExtensionCommandCompatibilityRecord,
  ModelSettingsScopeMode,
  NotificationPreferences,
  OrchestrationChildThread,
  OrchestrationChildTranscriptMessage,
} from "../src/desktop-state";
import type { ModelSettingsSnapshot } from "@pi-gui/session-driver/runtime-types";
import { readFile } from "node:fs/promises";
import { writeFileAtomicQueued } from "./atomic-file-write";

export interface PersistedUiState {
  readonly version?: 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11;
  readonly selectedWorkspaceId?: string;
  readonly selectedSessionId?: string;
  readonly activeView?: AppView;
  readonly composerDraft?: string;
  readonly composerDraftsBySession?: Record<string, string>;
  readonly extensionCommandCompatibilityByWorkspace?: Record<string, readonly ExtensionCommandCompatibilityRecord[]>;
  readonly notificationPreferences?: NotificationPreferences;
  readonly integratedTerminalShell?: string;
  readonly lastViewedAtBySession?: Record<string, string>;
  readonly workspaceOrder?: readonly string[];
  readonly modelSettingsScopeMode?: ModelSettingsScopeMode;
  readonly appGlobalModelSettings?: ModelSettingsSnapshot;
  readonly sidebarCollapsed?: boolean;
  readonly allowMultiple?: boolean;
  readonly enableTransparency?: boolean;
  readonly orchestrationChildren?: readonly OrchestrationChildThread[];
}

export interface LegacyPersistedUiState extends PersistedUiState {
  readonly composerAttachmentsBySession?: Record<string, readonly unknown[]>;
  readonly transcripts?: Record<string, readonly unknown[]>;
}

export async function readPersistedUiState(uiStateFilePath: string): Promise<LegacyPersistedUiState> {
  try {
    const raw = await readFile(uiStateFilePath, "utf8");
    const parsed = JSON.parse(raw) as LegacyPersistedUiState;
    return {
      version:
        parsed.version === 11
          ? 11
          : parsed.version === 10
          ? 10
          : parsed.version === 9
          ? 9
          : parsed.version === 8
            ? 8
            : parsed.version === 7
            ? 7
            : parsed.version === 6
              ? 6
              : parsed.version === 5
                ? 5
                : parsed.version === 4
                  ? 4
                  : parsed.version === 3
                    ? 3
                    : parsed.version === 2
                      ? 2
                      : undefined,
      selectedWorkspaceId: parsed.selectedWorkspaceId,
      selectedSessionId: parsed.selectedSessionId,
      activeView: parsed.activeView,
      composerDraft: parsed.composerDraft ?? "",
      composerDraftsBySession: parsed.composerDraftsBySession,
      extensionCommandCompatibilityByWorkspace: parsed.extensionCommandCompatibilityByWorkspace,
      notificationPreferences: parsed.notificationPreferences,
      integratedTerminalShell:
        typeof parsed.integratedTerminalShell === "string" ? parsed.integratedTerminalShell : undefined,
      lastViewedAtBySession: parsed.lastViewedAtBySession,
      workspaceOrder: Array.isArray(parsed.workspaceOrder) ? parsed.workspaceOrder : undefined,
      modelSettingsScopeMode:
        parsed.modelSettingsScopeMode === "per-repo" || parsed.modelSettingsScopeMode === "app-global"
          ? parsed.modelSettingsScopeMode
          : undefined,
      appGlobalModelSettings: toPersistedModelSettingsSnapshot(parsed.appGlobalModelSettings),
      sidebarCollapsed: typeof parsed.sidebarCollapsed === "boolean" ? parsed.sidebarCollapsed : undefined,
      allowMultiple: typeof parsed.allowMultiple === "boolean" ? parsed.allowMultiple : undefined,
      enableTransparency: typeof parsed.enableTransparency === "boolean" ? parsed.enableTransparency : undefined,
      orchestrationChildren: toPersistedOrchestrationChildren(parsed.orchestrationChildren),
      composerAttachmentsBySession: parsed.composerAttachmentsBySession,
      transcripts: parsed.transcripts,
    };
  } catch {
    return {};
  }
}

export async function writePersistedUiState(
  uiStateFilePath: string,
  payload: PersistedUiState,
): Promise<void> {
  const serialized = `${JSON.stringify(
    {
      ...payload,
      version: 11,
    } satisfies PersistedUiState,
    null,
    2,
  )}\n`;
  await writeFileAtomicQueued(uiStateFilePath, serialized);
}

function toPersistedOrchestrationChildren(value: unknown): OrchestrationChildThread[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  return value.flatMap((entry): OrchestrationChildThread[] => {
    if (!entry || typeof entry !== "object") {
      return [];
    }
    const candidate = entry as Record<string, unknown>;
    const id = stringValue(candidate.id);
    const parentWorkspaceId = stringValue(candidate.parentWorkspaceId);
    const parentSessionId = stringValue(candidate.parentSessionId);
    const childWorkspaceId = stringValue(candidate.childWorkspaceId) ?? parentWorkspaceId ?? "";
    const childSessionId = stringValue(candidate.childSessionId) ?? "";
    const title = stringValue(candidate.title);
    const goal = stringValue(candidate.goal);
    const createdAt = stringValue(candidate.createdAt);
    const updatedAt = stringValue(candidate.updatedAt);
    if (!id || !parentWorkspaceId || !parentSessionId || !title || !goal || !createdAt || !updatedAt) {
      return [];
    }

    const transcript = Array.isArray(candidate.transcript)
      ? candidate.transcript.flatMap((message): OrchestrationChildTranscriptMessage[] => {
          if (!message || typeof message !== "object") {
            return [];
          }
          const record = message as Record<string, unknown>;
          const messageId = stringValue(record.id);
          const role =
            record.role === "parent" || record.role === "child" || record.role === "system"
              ? record.role
              : undefined;
          const text = stringValue(record.text);
          const messageCreatedAt = stringValue(record.createdAt);
          if (!messageId || !role || !text || !messageCreatedAt) {
            return [];
          }
          return [{ id: messageId, role, text, createdAt: messageCreatedAt }];
        })
      : [];
    const retainedTranscript = transcript.slice(-MAX_PERSISTED_ORCHESTRATION_TRANSCRIPT_MESSAGES);

    return [
      {
        id,
        parentWorkspaceId,
        parentSessionId,
        childWorkspaceId,
        childSessionId,
        title,
        goal,
        status: toOrchestrationStatus(candidate.status),
        latestTranscript: stringValue(candidate.latestTranscript) || retainedTranscript.at(-1)?.text || goal,
        transcript: retainedTranscript,
        createdAt,
        updatedAt,
      },
    ];
  });
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function toOrchestrationStatus(value: unknown): OrchestrationChildThread["status"] {
  return value === "waiting" || value === "complete" || value === "failed" ? value : "running";
}

function toPersistedModelSettingsSnapshot(value: unknown): ModelSettingsSnapshot | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const candidate = value as Record<string, unknown>;
  const enabledModelPatterns = Array.isArray(candidate.enabledModelPatterns)
    ? candidate.enabledModelPatterns.filter((entry): entry is string => typeof entry === "string")
    : [];
  return {
    ...(typeof candidate.defaultProvider === "string" ? { defaultProvider: candidate.defaultProvider } : {}),
    ...(typeof candidate.defaultModelId === "string" ? { defaultModelId: candidate.defaultModelId } : {}),
    ...(typeof candidate.defaultThinkingLevel === "string"
      ? { defaultThinkingLevel: candidate.defaultThinkingLevel as ModelSettingsSnapshot["defaultThinkingLevel"] }
      : {}),
    enabledModelPatterns,
  };
}
const MAX_PERSISTED_ORCHESTRATION_TRANSCRIPT_MESSAGES = 40;
