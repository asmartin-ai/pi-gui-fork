import type { NotificationPreferences } from "./desktop-state";
import { SettingsGroup, SettingsRow } from "./settings-utils";

interface SettingsNotificationsSectionProps {
  readonly notificationPreferences: NotificationPreferences;
  readonly onSetNotificationPreferences: (preferences: Partial<NotificationPreferences>) => void;
}

export function SettingsNotificationsSection({
  notificationPreferences,
  onSetNotificationPreferences,
}: SettingsNotificationsSectionProps) {
  return (
    <SettingsGroup title="Notifications">
      <SettingsRow title="Background completion" description="Notify when a background session finishes.">
        <input
          checked={notificationPreferences.backgroundCompletion}
          type="checkbox"
          onChange={(event) => onSetNotificationPreferences({ backgroundCompletion: event.target.checked })}
        />
      </SettingsRow>
      <SettingsRow title="Background failures" description="Notify when a background session fails.">
        <input
          checked={notificationPreferences.backgroundFailure}
          type="checkbox"
          onChange={(event) => onSetNotificationPreferences({ backgroundFailure: event.target.checked })}
        />
      </SettingsRow>
      <SettingsRow title="Needs input or approval" description="Notify when input is needed to continue.">
        <input
          checked={notificationPreferences.attentionNeeded}
          type="checkbox"
          onChange={(event) => onSetNotificationPreferences({ attentionNeeded: event.target.checked })}
        />
      </SettingsRow>
    </SettingsGroup>
  );
}
