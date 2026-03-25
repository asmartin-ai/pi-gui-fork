import type { SessionTranscriptMessage } from "@pi-gui/pi-sdk-driver";
import type { TimelineActivity, TimelineToolCall, TimelineSummary, TranscriptMessage } from "./timeline-types";
import { MessageMarkdown } from "./message-markdown";

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
  return (
    <article className={`timeline-tool timeline-tool--${item.status}`}>
      <div className="timeline-tool__label">{item.label}</div>
      {item.detail ? <div className="timeline-tool__detail">{item.detail}</div> : null}
      <div className="timeline-tool__meta">
        <span>{`${item.toolName} \u00b7 ${statusLabel(item.status)}`}</span>
        {item.metadata ? <span>{item.metadata}</span> : null}
      </div>
    </article>
  );
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
