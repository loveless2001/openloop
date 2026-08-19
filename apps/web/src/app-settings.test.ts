// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from "vitest";

import {
  APP_SETTINGS_STORAGE_KEY,
  DEFAULT_APP_SETTINGS,
  loadAppSettings,
  saveAppSettings,
} from "./app-settings.js";

let values: Map<string, string>;
let storage: Storage;

beforeEach(() => {
  values = new Map();
  storage = {
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    get length() {
      return values.size;
    },
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
});

describe("app settings", () => {
  it("defaults to a ten-second critic idle delay and 250-word threshold", () => {
    expect(loadAppSettings(storage)).toMatchObject({
      criticIdleDelayMs: 10_000,
      criticWordThreshold: 250,
      manualCriticWordLimit: 1_000,
      criticIdleEnabled: true,
      criticParagraphEndEnabled: true,
      criticWordThresholdEnabled: true,
    });
  });

  it("persists valid writer preferences outside the model environment", () => {
    saveAppSettings(storage, {
      ...DEFAULT_APP_SETTINGS,
      criticIdleDelayMs: 20_000,
      criticWordThreshold: 400,
      manualCriticWordLimit: 1_500,
    });

    expect(loadAppSettings(storage)).toMatchObject({
      criticIdleDelayMs: 20_000,
      criticWordThreshold: 400,
      manualCriticWordLimit: 1_500,
    });
  });

  it("falls back safely when stored settings violate current limits", () => {
    storage.setItem(
      APP_SETTINGS_STORAGE_KEY,
      JSON.stringify({ ...DEFAULT_APP_SETTINGS, criticIdleDelayMs: 1_800 }),
    );

    expect(loadAppSettings(storage)).toEqual(DEFAULT_APP_SETTINGS);
  });
});
