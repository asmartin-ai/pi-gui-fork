import { type ClipboardEvent, type Dispatch, type DragEvent, type KeyboardEvent, type RefObject, type SetStateAction } from "react";
import type { RuntimeSnapshot } from "@pi-gui/session-driver/runtime-types";
import type { ComposerImageAttachment, SessionRecord } from "./desktop-state";
import { ArrowUpIcon, PlusIcon, StopSquareIcon } from "./icons";
import type {
  ComposerSlashCommand,
  ComposerSlashCommandSection,
  ComposerSlashOption,
  ComposerSlashOptionEmptyState,
} from "./composer-commands";
import { ComposerSurface } from "./composer-surface";
import { ModelSelector } from "./model-selector";
import type { ExtensionDockModel } from "./extension-session-ui";

interface ComposerPanelProps {
  readonly selectedSession: SessionRecord;
  readonly lastError?: string;
  readonly runtime?: RuntimeSnapshot;
  readonly activeSlashCommand?: ComposerSlashCommand;
  readonly activeSlashCommandMeta?: string;
  readonly composerDraft: string;
  readonly setComposerDraft: Dispatch<SetStateAction<string>>;
  readonly composerRef: RefObject<HTMLTextAreaElement | null>;
  readonly composerShellRef: RefObject<HTMLElement | null>;
  readonly runningLabel: string;
  readonly attachments: readonly ComposerImageAttachment[];
  readonly slashSections: readonly ComposerSlashCommandSection[];
  readonly slashOptions: readonly ComposerSlashOption[];
  readonly selectedSlashCommand?: ComposerSlashCommand;
  readonly selectedSlashOption?: ComposerSlashOption;
  readonly showSlashMenu: boolean;
  readonly showSlashOptionMenu: boolean;
  readonly slashOptionEmptyState?: ComposerSlashOptionEmptyState;
  readonly onClearSlashCommand: () => void;
  readonly onComposerKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  readonly onComposerPaste: (event: ClipboardEvent<HTMLDivElement>) => void;
  readonly onComposerDrop: (event: DragEvent<HTMLDivElement>) => void;
  readonly onPickImages: () => void;
  readonly onRemoveImage: (attachmentId: string) => void;
  readonly onSelectSlashCommand: (command: ComposerSlashCommand) => void;
  readonly onSelectSlashOption: (option: ComposerSlashOption) => void;
  readonly onSetModel: (provider: string, modelId: string) => void;
  readonly onSetThinking: (level: string) => void;
  readonly onSubmit: () => void;
  readonly showMentionMenu: boolean;
  readonly mentionOptions: readonly string[];
  readonly selectedMentionIndex: number;
  readonly onSelectMention: (filePath: string) => void;
  readonly extensionDock?: ExtensionDockModel;
  readonly extensionDockExpanded: boolean;
  readonly onToggleExtensionDock: () => void;
}

export function ComposerPanel({
  selectedSession,
  lastError,
  runtime,
  activeSlashCommand,
  activeSlashCommandMeta,
  composerDraft,
  setComposerDraft,
  composerRef,
  composerShellRef,
  runningLabel,
  attachments,
  slashSections,
  slashOptions,
  selectedSlashCommand,
  selectedSlashOption,
  showSlashMenu,
  showSlashOptionMenu,
  slashOptionEmptyState,
  onClearSlashCommand,
  onComposerKeyDown,
  onComposerPaste,
  onComposerDrop,
  onPickImages,
  onRemoveImage,
  onSelectSlashCommand,
  onSelectSlashOption,
  onSetModel,
  onSetThinking,
  onSubmit,
  showMentionMenu,
  mentionOptions,
  selectedMentionIndex,
  onSelectMention,
  extensionDock,
  extensionDockExpanded,
  onToggleExtensionDock,
}: ComposerPanelProps) {
  return (
    <footer className="composer">
      <div className="conversation conversation--composer">
        <ComposerSurface
          lastError={lastError}
          activeSlashCommand={activeSlashCommand}
          activeSlashCommandMeta={activeSlashCommandMeta}
          composerDraft={composerDraft}
          setComposerDraft={setComposerDraft}
          composerRef={composerRef}
          attachments={attachments}
          slashSections={slashSections}
          slashOptions={slashOptions}
          selectedSlashCommand={selectedSlashCommand}
          selectedSlashOption={selectedSlashOption}
          showSlashMenu={showSlashMenu}
          showSlashOptionMenu={showSlashOptionMenu}
          slashOptionEmptyState={slashOptionEmptyState}
          onClearSlashCommand={onClearSlashCommand}
          onComposerKeyDown={onComposerKeyDown}
          onComposerPaste={onComposerPaste}
          onComposerDrop={onComposerDrop}
          onRemoveImage={onRemoveImage}
          onSelectSlashCommand={onSelectSlashCommand}
          onSelectSlashOption={onSelectSlashOption}
          showMentionMenu={showMentionMenu}
          mentionOptions={mentionOptions}
          selectedMentionIndex={selectedMentionIndex}
          onSelectMention={onSelectMention}
          textareaLabel="Composer"
          textareaTestId="composer"
          textareaPlaceholder="Ask pi to inspect the repo, run a fix, or continue the current thread..."
          extensionDock={extensionDock}
          extensionDockExpanded={extensionDockExpanded}
          onToggleExtensionDock={onToggleExtensionDock}
          footer={(
            <>
              <div className="composer__hint">
                {selectedSession.status === "running" ? runningLabel : "Enter to send · Shift+Enter for newline"}
                {" · "}
                <ModelSelector
                  runtime={runtime}
                  provider={selectedSession.config?.provider}
                  modelId={selectedSession.config?.modelId}
                  thinkingLevel={selectedSession.config?.thinkingLevel}
                  disabled={selectedSession.status === "running"}
                  onSetModel={onSetModel}
                  onSetThinking={onSetThinking}
                />
              </div>
              <div className="composer__actions">
                <button
                  aria-label="Attach image"
                  className="icon-button composer__attach"
                  type="button"
                  disabled={selectedSession.status === "running"}
                  onClick={onPickImages}
                >
                  <PlusIcon />
                </button>
                <button
                  aria-label={selectedSession.status === "running" ? "Stop run" : "Send message"}
                  className="button button--primary button--cta-icon"
                  data-testid="send"
                  type="button"
                  disabled={!composerDraft.trim() && attachments.length === 0 && selectedSession.status !== "running"}
                  onClick={onSubmit}
                >
                  {selectedSession.status === "running" ? <StopSquareIcon /> : <ArrowUpIcon />}
                </button>
              </div>
            </>
          )}
        />
      </div>
    </footer>
  );
}
