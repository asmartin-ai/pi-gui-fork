import { useState } from "react";
import type { SessionTranscriptMessage } from "@pi-gui/pi-sdk-driver";
import type { TimelineActivity, TimelineToolCall, TimelineSummary, TranscriptMessage } from "./timeline-types";
import { MessageMarkdown } from "./message-markdown";
import { InlineDiff, extractDiffFromOutput } from "./diff-inline";
import { ChevronRightIcon, CopyIcon } from "./icons";

export function TimelineItem({
  item,
}: {
  readonly item: TranscriptMessage;
}) {
  switch (item.kind) {
    case "message":
      return <TimelineMessage item={item} />;
    case "activity":
      return <TimelineActivityItem item={item} />;
    case "tool":
      return <TimelineToolCallItem item={item} />;
    case "summary":
      return <TimelineSummaryItem item={item} />;
    default:
      return null;
  }
}

function TimelineMessage({ item }: { readonly item: SessionTranscriptMessage }) {
  if (item.role === "user") {
    return (
      <article className="timeline-item timeline-item--user">
        <div className="timeline-item__bubble">
          {item.attachments?.length ? (
            <div className="timeline-item__attachments">
              {item.attachments.map((attachment, index) => (
                <img
                  alt={attachment.name ?? `Attachment ${index + 1}`}
                  className="timeline-item__attachment"
                  key={`${item.id}:${index}`}
                  src={`data:${attachment.mimeType};base64,${attachment.data}`}
                />
              ))}
            </div>
          ) : null}
          <MessageMarkdown text={item.text} />
        </div>
      </article>
    );
  }

  return (
    <article className="timeline-item timeline-item--assistant">
      <MessageMarkdown text={item.text} />
    </article>
  );
}

function TimelineActivityItem({ item }: { readonly item: TimelineActivity }) {
  return (
    <div className={`timeline-activity timeline-activity--${item.tone ?? "neutral"}`}>
      <span className="timeline-activity__label">{item.label}</span>
      {item.detail ? <span className="timeline-activity__detail">{item.detail}</span> : null}
      {item.metadata ? <span className="timeline-activity__meta">{item.metadata}</span> : null}
    </div>
  );
}

function TimelineToolCallItem({ item }: { readonly item: TimelineToolCall }) {
  const [expanded, setExpanded] = useState(false);
  const hasContent = item.input !== undefined || item.output !== undefined;
  const diffText = isWriteTool(item.toolName) ? extractDiffFromOutput(item.output) : undefined;

  const handleCopy = () => {
    const text = diffText ?? formatToolContent(item.input, item.output);
    void navigator.clipboard.writeText(text);
  };

  return (
    <article className={`timeline-tool timeline-tool--${item.status}`}>
      <button
        className="timeline-tool__header"
        type="button"
        disabled={!hasContent}
        onClick={() => setExpanded((prev) => !prev)}
      >
        {hasContent ? (
          <span className={`timeline-tool__chevron ${expanded ? "timeline-tool__chevron--expanded" : ""}`}>
            <ChevronRightIcon />
          </span>
        ) : null}
        <span className="timeline-tool__label">{item.label}</span>
        <span className="timeline-tool__meta-inline">{`${item.toolName} \u00b7 ${statusLabel(item.status)}`}</span>
      </button>
      {expanded && hasContent ? (
        <div className="timeline-tool__body">
          <div className="timeline-tool__body-actions">
            <button className="icon-button timeline-tool__copy" type="button" onClick={handleCopy} aria-label="Copy">
              <CopyIcon />
            </button>
          </div>
          {diffText ? (
            <InlineDiff diff={diffText} />
          ) : (
            <pre className="timeline-tool__pre">{formatToolContent(item.input, item.output)}</pre>
          )}
        </div>
      ) : null}
      {!expanded && item.detail ? <div className="timeline-tool__detail">{item.detail}</div> : null}
    </article>
  );
}

function isWriteTool(toolName: string): boolean {
  return /write|edit|patch|apply/i.test(toolName);
}

function formatToolContent(input: unknown, output: unknown): string {
  const parts: string[] = [];
  if (input !== undefined) {
    parts.push(`--- Input ---\n${typeof input === "string" ? input : JSON.stringify(input, null, 2)}`);
  }
  if (output !== undefined) {
    parts.push(`--- Output ---\n${typeof output === "string" ? output : JSON.stringify(output, null, 2)}`);
  }
  return parts.join("\n\n");
}

function statusLabel(status: "running" | "success" | "error") {
  if (status === "running") return "running";
  if (status === "success") return "done";
  return "failed";
}

function TimelineSummaryItem({ item }: { readonly item: TimelineSummary }) {
  if (item.presentation === "divider") {
    return (
      <div className="timeline-summary">
        <span>{item.label}</span>
        {item.metadata ? <span className="timeline-summary__meta">{item.metadata}</span> : null}
      </div>
    );
  }

  return (
    <div className="timeline-activity timeline-activity--summary">
      <span className="timeline-activity__label">{item.label}</span>
      {item.metadata ? <span className="timeline-activity__meta">{item.metadata}</span> : null}
    </div>
  );
}
