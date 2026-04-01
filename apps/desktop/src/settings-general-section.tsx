import type { RuntimeSnapshot } from "@pi-gui/session-driver/runtime-types";
import type { ModelSettingsScopeMode } from "./desktop-state";
import { SettingsGroup, SettingsInfoRow, SettingsRow } from "./settings-utils";

interface SettingsGeneralSectionProps {
  readonly runtime?: RuntimeSnapshot;
  readonly modelSettingsScopeMode: ModelSettingsScopeMode;
  readonly onSetModelSettingsScopeMode: (mode: ModelSettingsScopeMode) => void;
  readonly onToggleSkillCommands: (enabled: boolean) => void;
}

export function SettingsGeneralSection({
  runtime,
  modelSettingsScopeMode,
  onSetModelSettingsScopeMode,
  onToggleSkillCommands,
}: SettingsGeneralSectionProps) {
  const connectedCount = runtime?.providers.filter((p) => p.hasAuth).length ?? 0;

  return (
    <>
      <SettingsGroup title="General">
        <SettingsInfoRow
          label="Connected providers"
          value={connectedCount > 0 ? String(connectedCount) : "None"}
        />
        <SettingsInfoRow label="Discovered skills" value={String(runtime?.skills.length ?? 0)} />
        <SettingsRow title="Model settings scope" description="Choose whether model defaults apply everywhere or per repo.">
          <div className="settings-pill-row">
            <button
              className={`settings-pill${modelSettingsScopeMode === "app-global" ? " settings-pill--active" : ""}`}
              type="button"
              aria-pressed={modelSettingsScopeMode === "app-global"}
              onClick={() => onSetModelSettingsScopeMode("app-global")}
            >
              App global
            </button>
            <button
              className={`settings-pill${modelSettingsScopeMode === "per-repo" ? " settings-pill--active" : ""}`}
              type="button"
              aria-pressed={modelSettingsScopeMode === "per-repo"}
              onClick={() => onSetModelSettingsScopeMode("per-repo")}
            >
              Per repo
            </button>
          </div>
        </SettingsRow>
        <SettingsRow title="Enable skill slash commands" description="Keep skill slash commands available in the composer.">
          <input
            aria-label="Enable skill slash commands"
            checked={runtime?.settings.enableSkillCommands ?? true}
            type="checkbox"
            onChange={(event) => onToggleSkillCommands(event.target.checked)}
          />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="Shortcuts">
        <SettingsInfoRow label="New thread" value="Cmd+Shift+O" />
        <SettingsInfoRow label="Open settings" value="Cmd+," />
        <SettingsInfoRow label="Send message" value="Enter" />
        <SettingsInfoRow label="New line" value="Shift+Enter" />
      </SettingsGroup>
    </>
  );
}
