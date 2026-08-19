import type { ModelStatusResponse } from "@openloop/shared";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";

import { AppSettingsSchema, type AppSettings } from "./app-settings.js";
import {
  formatPersonalDictionary,
  parsePersonalDictionary,
} from "./personal-dictionary.js";

interface SettingsDialogProps {
  modelStatus: ModelStatusResponse | null;
  onClose: () => void;
  onReset: () => void;
  onSave: (settings: AppSettings) => void;
  open: boolean;
  settings: AppSettings;
}

function NumberSetting({
  disabled = false,
  label,
  max,
  min,
  onChange,
  suffix,
  value,
}: {
  disabled?: boolean;
  label: string;
  max: number;
  min: number;
  onChange: (value: number) => void;
  suffix: string;
  value: number;
}) {
  return (
    <label className="number-setting">
      <span>{label}</span>
      <span className="number-input-wrap">
        <input
          disabled={disabled}
          max={max}
          min={min}
          onChange={(event) => {
            const next = event.currentTarget.valueAsNumber;
            if (Number.isFinite(next)) onChange(next);
          }}
          required
          type="number"
          value={value}
        />
        <span>{suffix}</span>
      </span>
    </label>
  );
}

function ToggleSetting({
  checked,
  children,
  onChange,
}: {
  checked: boolean;
  children: ReactNode;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="toggle-setting">
      <input
        checked={checked}
        onChange={(event) => onChange(event.currentTarget.checked)}
        type="checkbox"
      />
      <span>{children}</span>
    </label>
  );
}

export function SettingsDialog({
  modelStatus,
  onClose,
  onReset,
  onSave,
  open,
  settings,
}: SettingsDialogProps) {
  const [draft, setDraft] = useState(settings);
  const [dictionaryDraft, setDictionaryDraft] = useState(() =>
    formatPersonalDictionary(settings.dictionaryEntries),
  );
  const [dictionaryError, setDictionaryError] = useState<string>();

  useEffect(() => {
    if (open) {
      setDraft(settings);
      setDictionaryDraft(formatPersonalDictionary(settings.dictionaryEntries));
      setDictionaryError(undefined);
    }
  }, [open, settings]);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onClose, open]);

  if (!open) return null;

  const update = <Key extends keyof AppSettings>(
    key: Key,
    value: AppSettings[Key],
  ) => setDraft((current) => ({ ...current, [key]: value }));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    let dictionaryEntries;
    try {
      dictionaryEntries = parsePersonalDictionary(dictionaryDraft);
      setDictionaryError(undefined);
    } catch (error) {
      setDictionaryError(
        error instanceof Error ? error.message : "Invalid dictionary entry.",
      );
      return;
    }
    const result = AppSettingsSchema.safeParse({
      ...draft,
      dictionaryEntries,
    });
    if (!result.success) return;
    onSave(result.data);
    onClose();
  };

  return (
    <div
      className="dialog-backdrop settings-backdrop"
      onPointerDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <section
        aria-labelledby="settings-title"
        aria-modal="true"
        className="settings-dialog"
        role="dialog"
      >
        <div className="settings-heading">
          <div>
            <p className="eyebrow">Preferences</p>
            <h2 id="settings-title">Writing assistance</h2>
          </div>
          <button aria-label="Close settings" onClick={onClose} type="button">
            ×
          </button>
        </div>

        <form onSubmit={submit}>
          <fieldset>
            <legend>Automatic criticism</legend>
            <ToggleSetting
              checked={draft.criticIdleEnabled}
              onChange={(checked) => update("criticIdleEnabled", checked)}
            >
              Run after I stop writing
            </ToggleSetting>
            <NumberSetting
              disabled={!draft.criticIdleEnabled}
              label="Idle delay"
              max={300}
              min={10}
              onChange={(seconds) =>
                update("criticIdleDelayMs", seconds * 1_000)
              }
              suffix="seconds"
              value={draft.criticIdleDelayMs / 1_000}
            />
            <ToggleSetting
              checked={draft.criticParagraphEndEnabled}
              onChange={(checked) =>
                update("criticParagraphEndEnabled", checked)
              }
            >
              Run when I complete a paragraph
            </ToggleSetting>
            <ToggleSetting
              checked={draft.criticHeadingCreatedEnabled}
              onChange={(checked) =>
                update("criticHeadingCreatedEnabled", checked)
              }
            >
              Run when I create a heading
            </ToggleSetting>
            <ToggleSetting
              checked={draft.criticWordThresholdEnabled}
              onChange={(checked) =>
                update("criticWordThresholdEnabled", checked)
              }
            >
              Run after enough new words accumulate
            </ToggleSetting>
            <NumberSetting
              disabled={!draft.criticWordThresholdEnabled}
              label="New-word threshold"
              max={5_000}
              min={50}
              onChange={(words) => update("criticWordThreshold", words)}
              suffix="words"
              value={draft.criticWordThreshold}
            />
          </fieldset>

          <fieldset>
            <legend>Personal dictionary</legend>
            <ToggleSetting
              checked={draft.dictionaryEnabled}
              onChange={(checked) => update("dictionaryEnabled", checked)}
            >
              Suggest personal names, terms, phrases, and expansions before
              calling Qwen
            </ToggleSetting>
            <label className="dictionary-setting">
              <span>One entry per line</span>
              <textarea
                aria-describedby="dictionary-help"
                aria-invalid={dictionaryError ? "true" : "false"}
                disabled={!draft.dictionaryEnabled}
                onChange={(event) => {
                  setDictionaryDraft(event.currentTarget.value);
                  setDictionaryError(undefined);
                }}
                placeholder={"OpenTelemetry\nbtw => by the way"}
                rows={6}
                value={dictionaryDraft}
              />
            </label>
            <small id="dictionary-help">
              Plain entries complete matching text. Use “shortcut =&gt;
              expansion” to replace an abbreviation when accepted.
            </small>
            {dictionaryError ? (
              <p className="settings-error" role="alert">
                {dictionaryError}
              </p>
            ) : null}
          </fieldset>

          <fieldset>
            <legend>Editing</legend>
            <NumberSetting
              label="Autocomplete pause"
              max={5_000}
              min={100}
              onChange={(milliseconds) =>
                update("completionDebounceMs", milliseconds)
              }
              suffix="ms"
              value={draft.completionDebounceMs}
            />
            <NumberSetting
              label="Autosave pause"
              max={10_000}
              min={250}
              onChange={(milliseconds) =>
                update("autosaveDebounceMs", milliseconds)
              }
              suffix="ms"
              value={draft.autosaveDebounceMs}
            />
          </fieldset>

          <section className="model-settings-summary">
            <div>
              <p>Model configuration</p>
              <small>
                Managed by the server’s .env file; restart to apply.
              </small>
            </div>
            <dl>
              <div>
                <dt>Autocomplete</dt>
                <dd>
                  {modelStatus
                    ? `${modelStatus.provider} · ${modelStatus.completionModel}`
                    : "Unavailable"}
                </dd>
              </div>
              <div>
                <dt>Critic</dt>
                <dd>
                  {modelStatus
                    ? `${modelStatus.criticProvider} · ${modelStatus.criticModel}`
                    : "Unavailable"}
                </dd>
              </div>
            </dl>
          </section>

          <div className="dialog-actions settings-actions">
            <button
              onClick={() => {
                onReset();
                onClose();
              }}
              type="button"
            >
              Reset defaults
            </button>
            <span />
            <button onClick={onClose} type="button">
              Cancel
            </button>
            <button className="primary-button" type="submit">
              Save settings
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
