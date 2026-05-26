import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import type { RuntimeExtensionRecord, RuntimeSnapshot } from "@pi-gui/session-driver/runtime-types";
import type { PiDesktopApi } from "../ipc";
import { nextMenuIndex } from "./use-slash-menu";

const computerUseExtensionSlug = "computer-use-extension";

export type MentionOption =
  | {
      readonly kind: "extension";
      readonly id: string;
      readonly displayName: string;
      readonly description: string;
      readonly enabled: boolean;
      readonly path: string;
    }
  | {
      readonly kind: "file";
      readonly id: string;
      readonly filePath: string;
    };

interface UseMentionMenuParams {
  readonly composerDraft: string;
  readonly setComposerDraft: (draft: string) => void;
  readonly composerRef: RefObject<HTMLTextAreaElement | null>;
  readonly workspaceId: string | undefined;
  readonly runtime?: RuntimeSnapshot;
  readonly api: PiDesktopApi | undefined;
  readonly onEnableExtension?: (filePath: string) => Promise<void>;
}

export interface MentionMenuState {
  readonly showMentionMenu: boolean;
  readonly mentionOptions: readonly MentionOption[];
  readonly selectedIndex: number;
  readonly handleMentionKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => boolean;
  readonly insertMention: (option: MentionOption) => void;
  readonly enableMentionExtension: (option: Extract<MentionOption, { kind: "extension" }>) => void;
}

// Match @<query> at end of string (or preceded by whitespace)
function extractMentionQuery(text: string): { query: string; atIndex: number } | null {
  // Find the last @ that could be a mention trigger
  const match = /(?:^|\s)@([^\s]*)$/.exec(text);
  if (!match) {
    return null;
  }
  const query = match[1] ?? "";
  const atIndex = text.length - query.length - 1; // position of @
  return { query, atIndex };
}

export function useMentionMenu({
  composerDraft,
  setComposerDraft,
  composerRef,
  workspaceId,
  runtime,
  api,
  onEnableExtension,
}: UseMentionMenuParams): MentionMenuState {
  const [allFiles, setAllFiles] = useState<readonly string[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [suppressed, setSuppressed] = useState(false);

  // Fetch file list when workspace changes
  useEffect(() => {
    if (!api || !workspaceId) {
      setAllFiles([]);
      return;
    }
    void api.listWorkspaceFiles(workspaceId).then(setAllFiles).catch(() => setAllFiles([]));
  }, [api, workspaceId]);

  // Reset suppression when draft changes
  useEffect(() => {
    setSuppressed(false);
  }, [composerDraft]);

  // Detect active @ mention from the draft text
  const mentionMatch = useMemo(() => {
    if (suppressed) {
      return null;
    }
    return extractMentionQuery(composerDraft);
  }, [composerDraft, suppressed]);

  const mentionOptions = useMemo<MentionOption[]>(() => {
    if (!mentionMatch) {
      return [];
    }
    const lowerQuery = mentionMatch.query.toLowerCase();
    const extensionOptions = buildExtensionMentionOptions(runtime?.extensions ?? [], lowerQuery);
    const fileOptions = allFiles
      .filter((file) => file.toLowerCase().includes(lowerQuery))
      .slice(0, 10)
      .map<MentionOption>((filePath) => ({
        kind: "file",
        id: `file:${filePath}`,
        filePath,
      }));
    return [...extensionOptions, ...fileOptions];
  }, [allFiles, mentionMatch, runtime?.extensions]);

  const showMentionMenu = mentionOptions.length > 0;

  // Reset selection when options change
  useEffect(() => {
    setSelectedIndex(0);
  }, [mentionOptions.length]);

  const insertMention = useCallback(
    (option: MentionOption) => {
      if (!mentionMatch) {
        return;
      }
      const before = composerDraft.slice(0, mentionMatch.atIndex);
      const afterCursor = composerDraft.slice(mentionMatch.atIndex + 1 + mentionMatch.query.length);
      const inserted = `@${mentionOptionText(option)} `;
      const newDraft = `${before}${inserted}${afterCursor}`;
      setComposerDraft(newDraft);
      setSuppressed(true);
      requestAnimationFrame(() => {
        const textarea = composerRef.current;
        if (textarea) {
          const newPos = before.length + inserted.length;
          textarea.setSelectionRange(newPos, newPos);
        }
      });
    },
    [composerDraft, composerRef, setComposerDraft, mentionMatch],
  );

  const enableMentionExtension = useCallback(
    (option: Extract<MentionOption, { kind: "extension" }>) => {
      if (option.enabled || !onEnableExtension) {
        insertMention(option);
        return;
      }

      void onEnableExtension(option.path)
        .then(() => {
          insertMention(option);
        })
        .catch(() => undefined);
    },
    [insertMention, onEnableExtension],
  );

  const handleMentionKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
      if (!showMentionMenu) {
        return false;
      }

      if (event.key === "ArrowDown") {
        event.preventDefault();
        setSelectedIndex((prev) => nextMenuIndex(prev, 1, mentionOptions.length));
        return true;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setSelectedIndex((prev) => nextMenuIndex(prev, -1, mentionOptions.length));
        return true;
      }
      if (event.key === "Tab" || event.key === "Enter") {
        event.preventDefault();
        const selected = mentionOptions[selectedIndex];
        if (selected) {
          if (selected.kind === "extension" && !selected.enabled) {
            enableMentionExtension(selected);
          } else {
            insertMention(selected);
          }
        }
        return true;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setSuppressed(true);
        return true;
      }

      return false;
    },
    [showMentionMenu, mentionOptions, selectedIndex, enableMentionExtension, insertMention],
  );

  return {
    showMentionMenu,
    mentionOptions,
    selectedIndex,
    handleMentionKeyDown,
    insertMention,
    enableMentionExtension,
  };
}

function buildExtensionMentionOptions(
  extensions: readonly RuntimeExtensionRecord[],
  lowerQuery: string,
): MentionOption[] {
  return extensions
    .filter((extension) => {
      if (!lowerQuery) {
        return true;
      }
      return [
        extension.displayName,
        extension.sourceInfo.source,
      ].some((value) => value.toLowerCase().includes(lowerQuery));
    })
    .slice(0, 8)
      .map((extension) => ({
        kind: "extension",
        id: `extension:${extension.path}`,
        displayName: extensionMentionDisplayName(extension),
        description: describeExtension(extension),
        enabled: extension.enabled,
        path: extension.path,
      }));
}

function describeExtension(extension: RuntimeExtensionRecord): string {
  if (isComputerUseExtension(extension)) {
    return "Control Mac apps from pi";
  }

  const contributionParts = [
    extension.commands.length > 0 ? pluralizeContribution(extension.commands.length, "command") : undefined,
    extension.tools.length > 0 ? pluralizeContribution(extension.tools.length, "tool") : undefined,
  ].filter(Boolean);
  if (contributionParts.length > 0) {
    return contributionParts.join(" · ");
  }
  return `${extension.sourceInfo.scope} ${extension.sourceInfo.origin}`;
}

function extensionMentionDisplayName(extension: RuntimeExtensionRecord): string {
  return isComputerUseExtension(extension) ? "Computer Use" : extension.displayName;
}

function isComputerUseExtension(extension: RuntimeExtensionRecord): boolean {
  return [
    extension.displayName,
    extension.path,
    extension.sourceInfo.source,
  ].some((value) => value.toLowerCase().includes(computerUseExtensionSlug));
}

function pluralizeContribution(count: number, label: string): string {
  return `${count} ${label}${count === 1 ? "" : "s"}`;
}

function mentionOptionText(option: MentionOption): string {
  return option.kind === "extension" ? option.displayName : option.filePath;
}
