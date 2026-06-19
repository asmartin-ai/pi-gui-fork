import type { OrchestrationChildThread } from "./desktop-state";
import { DiffPanel, type DiffPanelFileRequest, type FileWorkbenchContext } from "./diff-panel";
import type { PiDesktopApi } from "./ipc";
import { OrchestrationWorkbench } from "./orchestration-workbench";
import { PreviewWorkbench } from "./preview-workbench";

export type OrchestratedWorkbenchMode = "children" | "files" | "preview";

interface OrchestratedWorkbenchProps {
  readonly mode: OrchestratedWorkbenchMode;
  readonly childrenThreads: readonly OrchestrationChildThread[];
  readonly workspaceId: string;
  readonly sessionId: string;
  readonly sessionStatus: string | undefined;
  readonly sessionTitle?: string;
  readonly api: PiDesktopApi;
  readonly fileRequest?: DiffPanelFileRequest | null;
  readonly fileContexts: readonly FileWorkbenchContext[];
  readonly onSelectMode: (mode: OrchestratedWorkbenchMode) => void;
  readonly onSendFollowUp: (childThreadId: string, text: string) => void;
  readonly onOpenChild: (child: OrchestrationChildThread) => void;
  readonly onAttachPreviewEvidence: (evidence: string) => void;
}

const MODE_LABELS: Readonly<Record<OrchestratedWorkbenchMode, string>> = {
  children: "Children",
  files: "Files",
  preview: "Preview",
};

export function OrchestratedWorkbench({
  mode,
  childrenThreads,
  workspaceId,
  sessionId,
  sessionStatus,
  sessionTitle,
  api,
  fileRequest,
  fileContexts,
  onSelectMode,
  onSendFollowUp,
  onOpenChild,
  onAttachPreviewEvidence,
}: OrchestratedWorkbenchProps) {
  return (
    <aside className="orchestrated-workbench" data-testid="orchestrated-workbench">
      <header className="orchestrated-workbench__header">
        <div>
          <div className="orchestrated-workbench__eyebrow">Orchestrated workbench</div>
          <h2>Thread control</h2>
        </div>
        <nav className="orchestrated-workbench__tabs" aria-label="Workbench modes">
          {(Object.keys(MODE_LABELS) as OrchestratedWorkbenchMode[]).map((candidate) => (
            <button
              key={candidate}
              className={`orchestrated-workbench__tab ${candidate === mode ? "orchestrated-workbench__tab--active" : ""}`}
              data-testid={`workbench-tab-${candidate}`}
              type="button"
              onClick={() => onSelectMode(candidate)}
            >
              {MODE_LABELS[candidate]}
            </button>
          ))}
        </nav>
      </header>
      <div className="orchestrated-workbench__body">
        {mode === "children" ? (
          <OrchestrationWorkbench
            childrenThreads={childrenThreads}
            onSendFollowUp={onSendFollowUp}
            onOpenChild={onOpenChild}
          />
        ) : null}
        {mode === "files" ? (
          <DiffPanel
            workspaceId={workspaceId}
            sessionId={sessionId}
            api={api}
            sessionStatus={sessionStatus}
            fileRequest={fileRequest}
            contexts={fileContexts}
          />
        ) : null}
        {mode === "preview" ? (
          <PreviewWorkbench
            selectedSessionTitle={sessionTitle}
            onOpenExternal={(url) => {
              void api.openExternal(url);
            }}
            onAttachEvidence={onAttachPreviewEvidence}
          />
        ) : null}
      </div>
    </aside>
  );
}
