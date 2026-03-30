import { useState } from "react";
import type { RuntimeSnapshot } from "@pi-gui/session-driver/runtime-types";
import { filterProviders, ProviderRow, SettingsGroup } from "./settings-utils";

interface SettingsProvidersSectionProps {
  readonly runtime?: RuntimeSnapshot;
  readonly onLoginProvider: (providerId: string) => void;
  readonly onLogoutProvider: (providerId: string) => void;
}

export function SettingsProvidersSection({ runtime, onLoginProvider, onLogoutProvider }: SettingsProvidersSectionProps) {
  const [providerQuery, setProviderQuery] = useState("");

  const providers = runtime?.providers ?? [];
  const connectedProviders = providers.filter((p) => p.hasAuth);
  const oauthProviders = providers.filter((p) => p.oauthSupported);
  const filteredProviders = filterProviders(providers, providerQuery);

  return (
    <>
      <SettingsGroup title="Connected" description="Connected providers are used first for picking models.">
        {connectedProviders.length > 0 ? (
          connectedProviders.map((provider) => (
            <ProviderRow
              key={provider.id}
              provider={provider}
              onLoginProvider={onLoginProvider}
              onLogoutProvider={onLogoutProvider}
            />
          ))
        ) : (
          <div className="settings-row">
            <span className="settings-row__description">No providers connected yet.</span>
          </div>
        )}
      </SettingsGroup>

      <SettingsGroup title="Sign in" description="OAuth-capable providers can sign in directly from the desktop app.">
        {oauthProviders.map((provider) => (
          <ProviderRow
            key={provider.id}
            provider={provider}
            onLoginProvider={onLoginProvider}
            onLogoutProvider={onLogoutProvider}
          />
        ))}
      </SettingsGroup>

      <SettingsGroup title="All providers" description="Browse the full provider inventory.">
        <details className="settings-disclosure">
          <summary className="settings-disclosure__summary">
            <span>Browse all providers</span>
            <span>{filteredProviders.length}</span>
          </summary>
          <div className="settings-disclosure__body">
            <input
              aria-label="Search providers"
              className="settings-search"
              placeholder="Search providers"
              value={providerQuery}
              onChange={(event) => setProviderQuery(event.target.value)}
            />
            <div className="settings-list">
              {filteredProviders.map((provider) => (
                <ProviderRow
                  key={provider.id}
                  provider={provider}
                  onLoginProvider={onLoginProvider}
                  onLogoutProvider={onLogoutProvider}
                />
              ))}
            </div>
          </div>
        </details>
      </SettingsGroup>
    </>
  );
}
