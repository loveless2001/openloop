import { z } from "zod";

export const APP_SETTINGS_STORAGE_KEY = "openloop.appSettings.v3";

export const AppSettingsSchema = z.object({
  dictionaryEnabled: z.boolean(),
  dictionaryEntries: z
    .array(
      z.object({
        trigger: z.string().trim().min(1).max(80),
        replacement: z.string().trim().min(1).max(240),
      }),
    )
    .max(500),
  criticIdleEnabled: z.boolean(),
  criticIdleDelayMs: z.number().int().min(10_000).max(300_000),
  criticParagraphEndEnabled: z.boolean(),
  criticHeadingCreatedEnabled: z.boolean(),
  criticWordThresholdEnabled: z.boolean(),
  criticWordThreshold: z.number().int().min(50).max(5_000),
  manualCriticWordLimit: z.number().int().min(100).max(20_000),
  completionDebounceMs: z.number().int().min(100).max(5_000),
  autosaveDebounceMs: z.number().int().min(250).max(10_000),
});

export type AppSettings = z.infer<typeof AppSettingsSchema>;

export const DEFAULT_APP_SETTINGS: AppSettings = {
  dictionaryEnabled: true,
  dictionaryEntries: [],
  criticIdleEnabled: true,
  criticIdleDelayMs: 10_000,
  criticParagraphEndEnabled: true,
  criticHeadingCreatedEnabled: true,
  criticWordThresholdEnabled: true,
  criticWordThreshold: 250,
  manualCriticWordLimit: 1_000,
  completionDebounceMs: 300,
  autosaveDebounceMs: 750,
};

export function loadAppSettings(storage: Storage): AppSettings {
  const raw = storage.getItem(APP_SETTINGS_STORAGE_KEY);
  if (!raw) return { ...DEFAULT_APP_SETTINGS };
  try {
    const parsed = JSON.parse(raw) as unknown;
    const result = AppSettingsSchema.safeParse(parsed);
    return result.success ? result.data : { ...DEFAULT_APP_SETTINGS };
  } catch {
    return { ...DEFAULT_APP_SETTINGS };
  }
}

export function saveAppSettings(storage: Storage, settings: AppSettings): void {
  storage.setItem(
    APP_SETTINGS_STORAGE_KEY,
    JSON.stringify(AppSettingsSchema.parse(settings)),
  );
}
