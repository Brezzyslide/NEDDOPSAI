/**
 * Desktop App Router
 * Sprint 14
 *
 * Simple screen-based state machine — no URL routing needed in Electron.
 * Screens:
 *   welcome → activation → permissions → browser-select → folder-select
 *   → discovery → connecting → ready
 * After activation: jumps straight to connecting → ready.
 */

import { useState, useEffect } from "react";
import WelcomeScreen from "./screens/WelcomeScreen";
import ActivationScreen from "./screens/ActivationScreen";
import PermissionsScreen from "./screens/PermissionsScreen";
import BrowserSelectScreen from "./screens/BrowserSelectScreen";
import FolderSelectScreen from "./screens/FolderSelectScreen";
import DiscoveryScreen from "./screens/DiscoveryScreen";
import ConnectingScreen from "./screens/ConnectingScreen";
import ReadyScreen from "./screens/ReadyScreen";
import SettingsScreen from "./screens/SettingsScreen";

export type Screen =
  | "welcome"
  | "activation"
  | "permissions"
  | "browser-select"
  | "folder-select"
  | "discovery"
  | "connecting"
  | "ready"
  | "settings";

export default function App() {
  const [screen, setScreen] = useState<Screen>("welcome");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Check if already activated — skip to ready screen
    window.needsops?.credentials?.isActivated?.().then((activated) => {
      if (activated) setScreen("ready");
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const go = (s: Screen) => setScreen(s);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-[#64748B] text-sm">Loading…</div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {screen === "welcome" && <WelcomeScreen onContinue={() => go("activation")} />}
      {screen === "activation" && (
        <ActivationScreen
          onSuccess={() => go("permissions")}
          onBack={() => go("welcome")}
        />
      )}
      {screen === "permissions" && (
        <PermissionsScreen
          onContinue={() => go("browser-select")}
          onBack={() => go("activation")}
        />
      )}
      {screen === "browser-select" && (
        <BrowserSelectScreen
          onContinue={() => go("folder-select")}
          onBack={() => go("permissions")}
        />
      )}
      {screen === "folder-select" && (
        <FolderSelectScreen
          onContinue={() => go("discovery")}
          onBack={() => go("browser-select")}
        />
      )}
      {screen === "discovery" && (
        <DiscoveryScreen
          onContinue={() => go("connecting")}
          onSkip={() => go("connecting")}
        />
      )}
      {screen === "connecting" && (
        <ConnectingScreen
          onSuccess={() => go("ready")}
          onError={() => go("ready")}
        />
      )}
      {screen === "ready" && (
        <ReadyScreen onSettings={() => go("settings")} />
      )}
      {screen === "settings" && (
        <SettingsScreen
          onBack={() => go("ready")}
          onSignOut={async () => {
            await window.needsops?.credentials?.clear?.();
            await window.needsops?.broker?.stop?.();
            go("welcome");
          }}
        />
      )}
    </div>
  );
}
