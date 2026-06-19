import { useMemo, useState } from "react";

type PreviewStatus = "idle" | "blocked" | "loading" | "ready" | "error";

interface PreviewWorkbenchProps {
  readonly selectedSessionTitle?: string;
  readonly onOpenExternal: (url: string) => void;
  readonly onAttachEvidence: (evidence: string) => void;
}

interface SafePreviewUrl {
  readonly url: string;
  readonly error?: string;
}

const DEFAULT_PREVIEW_URL = "http://localhost:3000";

export function PreviewWorkbench({
  selectedSessionTitle,
  onOpenExternal,
  onAttachEvidence,
}: PreviewWorkbenchProps) {
  const [urlInput, setUrlInput] = useState(DEFAULT_PREVIEW_URL);
  const [loadedUrl, setLoadedUrl] = useState("");
  const [reloadNonce, setReloadNonce] = useState(0);
  const [status, setStatus] = useState<PreviewStatus>("idle");
  const [statusMessage, setStatusMessage] = useState("Enter a localhost URL to start previewing.");
  const [lastLoadedAt, setLastLoadedAt] = useState("");
  const [observation, setObservation] = useState("");

  const candidate = useMemo(() => normalizeSafeLocalUrl(urlInput), [urlInput]);
  const canLoad = Boolean(candidate.url);
  const canAttachEvidence = Boolean(loadedUrl) && (status === "ready" || status === "error");

  const loadPreview = () => {
    if (!candidate.url) {
      setStatus("blocked");
      setLoadedUrl("");
      setStatusMessage(candidate.error ?? "Only loopback HTTP URLs can be embedded.");
      return;
    }

    setLoadedUrl(candidate.url);
    setStatus("loading");
    setStatusMessage("Loading local preview...");
    setReloadNonce((current) => current + 1);
  };

  const refreshPreview = () => {
    if (!loadedUrl) {
      loadPreview();
      return;
    }
    setStatus("loading");
    setStatusMessage("Refreshing local preview...");
    setReloadNonce((current) => current + 1);
  };

  const attachEvidence = () => {
    if (!loadedUrl) {
      return;
    }

    const capturedAt = new Date().toISOString();
    const statusLabel = status === "ready" ? "loaded" : status;
    const note = observation.trim();
    onAttachEvidence(
      [
        "Preview evidence",
        `- URL: ${loadedUrl}`,
        `- Status: ${statusLabel}`,
        `- Captured: ${capturedAt}`,
        note ? `- Notes: ${note}` : undefined,
      ].filter(Boolean).join("\n"),
    );
  };

  return (
    <section className="preview-workbench" data-testid="preview-workbench">
      <header className="preview-workbench__header">
        <div>
          <p className="preview-workbench__eyebrow">Loopback preview</p>
          <h2>Preview</h2>
        </div>
        <div className={`preview-workbench__status preview-workbench__status--${status}`} data-testid="preview-status">
          {statusText(status)}
        </div>
      </header>

      <div className="preview-workbench__controls">
        <label className="preview-workbench__field">
          <span>Local URL</span>
          <input
            aria-label="Preview URL"
            spellCheck={false}
            value={urlInput}
            onChange={(event) => setUrlInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                loadPreview();
              }
            }}
          />
        </label>
        <div className="preview-workbench__actions">
          <button className="button button--primary" type="button" disabled={!canLoad} onClick={loadPreview}>
            Load
          </button>
          <button className="button" type="button" disabled={!loadedUrl} onClick={refreshPreview}>
            Refresh
          </button>
          <button className="button" type="button" disabled={!candidate.url} onClick={() => onOpenExternal(candidate.url)}>
            Open
          </button>
        </div>
        {candidate.error ? <p className="preview-workbench__validation">{candidate.error}</p> : null}
      </div>

      <div className="preview-workbench__meta">
        <div>
          <span>Thread</span>
          <strong>{selectedSessionTitle ?? "No selected thread"}</strong>
        </div>
        <div>
          <span>Status</span>
          <strong>{statusMessage}</strong>
        </div>
        {lastLoadedAt ? (
          <div>
            <span>Loaded</span>
            <strong>{lastLoadedAt}</strong>
          </div>
        ) : null}
      </div>

      <div className="preview-workbench__frame-shell">
        {loadedUrl ? (
          <iframe
            key={`${loadedUrl}:${reloadNonce}`}
            className="preview-workbench__frame"
            data-testid="preview-frame"
            referrerPolicy="no-referrer"
            sandbox="allow-forms allow-modals allow-same-origin allow-scripts"
            src={loadedUrl}
            title="Local preview"
            onLoad={() => {
              const loadedAt = new Date().toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              });
              setStatus("ready");
              setLastLoadedAt(loadedAt);
              setStatusMessage("Preview loaded from loopback.");
            }}
            onError={() => {
              setStatus("error");
              setStatusMessage("The preview frame reported a load error.");
            }}
          />
        ) : (
          <div className="preview-workbench__empty">
            <p>Loopback HTTP previews only.</p>
          </div>
        )}
      </div>

      <section className="preview-workbench__evidence">
        <label className="preview-workbench__field">
          <span>Observation</span>
          <textarea
            aria-label="Preview evidence observation"
            rows={3}
            value={observation}
            onChange={(event) => setObservation(event.target.value)}
          />
        </label>
        <button className="button" type="button" disabled={!canAttachEvidence} onClick={attachEvidence}>
          Attach evidence
        </button>
      </section>
    </section>
  );
}

function normalizeSafeLocalUrl(input: string): SafePreviewUrl {
  const trimmed = input.trim();
  if (!trimmed) {
    return { url: "", error: "Enter a localhost or loopback URL." };
  }

  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return { url: "", error: "Enter a valid URL, for example localhost:3000." };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { url: "", error: "Only HTTP and HTTPS previews are supported." };
  }

  if (!isLoopbackHost(parsed.hostname)) {
    return { url: "", error: "Only localhost, 127.0.0.1, or ::1 can be embedded." };
  }

  return { url: parsed.toString() };
}

function isLoopbackHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
  if (normalized === "localhost" || normalized === "::1") {
    return true;
  }

  const octets = normalized.split(".");
  return octets.length === 4 && octets[0] === "127" && octets.every(isIpv4Octet);
}

function isIpv4Octet(value: string): boolean {
  if (!/^\d{1,3}$/.test(value)) {
    return false;
  }
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric >= 0 && numeric <= 255;
}

function statusText(status: PreviewStatus): string {
  switch (status) {
    case "blocked":
      return "Blocked";
    case "loading":
      return "Loading";
    case "ready":
      return "Ready";
    case "error":
      return "Error";
    case "idle":
    default:
      return "Idle";
  }
}
