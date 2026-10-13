import { expect, it } from "vitest";
import { DEFAULT_VOICE_SETTINGS, readVoiceSettings } from "./settings";

it("D64: class confirmation and line choices are on by default; wider coverage stays off", () => {
  expect(readVoiceSettings({})).toEqual(DEFAULT_VOICE_SETTINGS);
  expect(DEFAULT_VOICE_SETTINGS).toMatchObject({
    classConfirmation: true,
    targetTurns: true,
    backgroundCoverage: null,
  });
  // Publishing before the voice result was rejected (owner decision 2026-10-12): no such switch.
  expect(() => readVoiceSettings({ VOICE_SETTINGS_JSON: '{"publishBeforeVoice":true}' })).toThrow();
});

it("D64: each approved behaviour has a kill switch", () => {
  expect(
    readVoiceSettings({
      VOICE_SETTINGS_JSON: JSON.stringify({ classConfirmation: false, targetTurns: false }),
    }),
  ).toMatchObject({ classConfirmation: false, targetTurns: false });
});

it("workstream 4: a deployment overrides switches with VOICE_SETTINGS_JSON", () => {
  expect(
    readVoiceSettings({
      VOICE_SETTINGS_JSON: JSON.stringify({
        classConfirmation: false,
        backgroundCoverage: { windowMs: 58000, maxWindows: 16 },
      }),
    }),
  ).toEqual({
    ...DEFAULT_VOICE_SETTINGS,
    classConfirmation: false,
    backgroundCoverage: { windowMs: 58000, maxWindows: 16 },
  });
});

it("workstream 4: invalid or unknown settings are refused, naming only the setting", () => {
  expect(() => readVoiceSettings({ VOICE_SETTINGS_JSON: "{" })).toThrow(/not valid JSON/);
  expect(() => readVoiceSettings({ VOICE_SETTINGS_JSON: '{"targetTurnMinMs":500}' })).toThrow(
    /targetTurnMinMs/,
  );
  expect(() => readVoiceSettings({ VOICE_SETTINGS_JSON: '{"autoAccept":true}' })).toThrow(
    /Invalid VOICE_SETTINGS_JSON/,
  );
  expect(() => readVoiceSettings({ VOICE_SETTINGS_JSON: "[]" })).toThrow(/root/);
  expect(() =>
    readVoiceSettings({
      VOICE_SETTINGS_JSON: '{"backgroundCoverage":{"windowMs":58000,"maxWindows":99}}',
    }),
  ).toThrow(/backgroundCoverage/);
});
