import type {
  DesktopComputerUsePrivacyPane,
  DesktopComputerUseStatus,
  DesktopComputerUseStatusValue,
} from "./ipc";
import { SettingsGroup, SettingsInfoRow, SettingsRow } from "./settings-utils";

interface SettingsComputerUseSectionProps {
  readonly status?: DesktopComputerUseStatus;
  readonly pending: boolean;
  readonly onRefresh: () => void;
  readonly onOpenPrivacySettings: (pane: DesktopComputerUsePrivacyPane) => void;
}

export function SettingsComputerUseSection({
  status,
  pending,
  onRefresh,
  onOpenPrivacySettings,
}: SettingsComputerUseSectionProps) {
  return (
    <>
      <SettingsGroup title="Status">
        <SettingsRow title="Helper" description={status?.helperPath}>
          <span className="settings-row__value">{helperLabel(status, pending)}</span>
        </SettingsRow>
        <SettingsInfoRow label="Desktop" value={desktopLabel(status?.desktop)} />
        <SettingsInfoRow label="Locked computer use" value={lockedUseLabel(status?.lockedUse)} />
        {status?.message ? <SettingsRow title="Details" description={status.message} /> : null}
        <SettingsRow title="Refresh status">
          <button className="button button--secondary" disabled={pending} type="button" onClick={onRefresh}>
            Refresh
          </button>
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="macOS access">
        <SettingsRow title="Accessibility" description="Required for inspecting controls and using accessibility actions.">
          <PermissionControl
            status={status?.accessibility}
            onOpen={() => onOpenPrivacySettings("accessibility")}
          />
        </SettingsRow>
        <SettingsRow title="Screen Recording" description="Required for screenshots returned by get_app_state.">
          <PermissionControl
            status={status?.screenRecording}
            onOpen={() => onOpenPrivacySettings("screen-recording")}
          />
        </SettingsRow>
      </SettingsGroup>
    </>
  );
}

function PermissionControl({
  status,
  onOpen,
}: {
  readonly status?: DesktopComputerUseStatusValue;
  readonly onOpen: () => void;
}) {
  return (
    <div className="settings-row__actions">
      <span className="settings-row__value">{permissionLabel(status)}</span>
      {status !== "granted" ? (
        <button className="button button--secondary" type="button" onClick={onOpen}>
          Open Settings
        </button>
      ) : null}
    </div>
  );
}

function desktopLabel(value: DesktopComputerUseStatus["desktop"] | undefined): string {
  switch (value) {
    case "locked":
      return "Locked";
    case "unlocked":
      return "Unlocked";
    default:
      return "Unknown";
  }
}

function helperLabel(status: DesktopComputerUseStatus | undefined, pending: boolean): string {
  if (!status) {
    return pending ? "Checking..." : "Unknown";
  }
  return status.helperAvailable ? "Available" : "Unavailable";
}

function lockedUseLabel(value: DesktopComputerUseStatus["lockedUse"] | undefined): string {
  switch (value) {
    case "enabled":
      return "Enabled";
    case "not_enabled":
      return "Not enabled";
    default:
      return "Unknown";
  }
}

function permissionLabel(value: DesktopComputerUseStatusValue | undefined): string {
  switch (value) {
    case "granted":
      return "Enabled";
    case "denied":
      return "Turned off";
    default:
      return "Unknown";
  }
}
