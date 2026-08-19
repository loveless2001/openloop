import { useCallback, useState } from "react";

import {
  type AppSettings,
  DEFAULT_APP_SETTINGS,
  loadAppSettings,
  saveAppSettings,
} from "./app-settings.js";

export function useAppSettings() {
  const [settings, setSettingsState] = useState<AppSettings>(() =>
    loadAppSettings(window.localStorage),
  );

  const setSettings = useCallback((next: AppSettings) => {
    saveAppSettings(window.localStorage, next);
    setSettingsState(next);
  }, []);

  const resetSettings = useCallback(() => {
    const defaults = { ...DEFAULT_APP_SETTINGS };
    saveAppSettings(window.localStorage, defaults);
    setSettingsState(defaults);
  }, []);

  return { resetSettings, settings, setSettings };
}
