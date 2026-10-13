import { expect, it } from "vitest";
import { createLogger } from "../plt";
import { DEFAULT_VOICE_SETTINGS, readVoiceSettings, VOICE_SETTINGS_FALLBACK } from "./settings";

it("D64: class confirmation and line choices are on by default; wider coverage stays off", () => {
  expect(readVoiceSettings({})).toEqual(DEFAULT_VOICE_SETTINGS);
  expect(DEFAULT_VOICE_SETTINGS).toMatchObject({
    classConfirmation: true,
    targetTurns: true,
    backgroundCoverage: null,
  });
  // Publishing before the voice result was rejected (owner decision 2026-10-12): no such switch.
  expect(
    readVoiceSettings({ VOICE_SETTINGS_JSON: '{"publishBeforeVoice":true}' }, () => {}),
  ).toEqual(VOICE_SETTINGS_FALLBACK);
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

it("S3: an unreadable VOICE_SETTINGS_JSON falls back to the safe defaults with one event, never a throw", () => {
  const lines: string[] = [];
  const log = createLogger((line) => lines.push(line));
  const broken = { VOICE_SETTINGS_JSON: '{"classConfirmation": tru' };
  expect(readVoiceSettings(broken, log)).toEqual(VOICE_SETTINGS_FALLBACK);
  expect(VOICE_SETTINGS_FALLBACK).toMatchObject({ classConfirmation: false, targetTurns: false });
  // The same bad value is reported once, not on every request.
  expect(readVoiceSettings(broken, log)).toEqual(VOICE_SETTINGS_FALLBACK);
  expect(lines).toHaveLength(1);
  expect(lines[0]).toContain('"event":"voice_settings_invalid"');
  expect(lines[0]).toContain('"reason":"not_valid_json"');
  expect(lines[0]).not.toContain("tru");
  // A schema failure names only the setting, never its value.
  expect(readVoiceSettings({ VOICE_SETTINGS_JSON: '{"targetTurnMinMs":500}' }, log)).toEqual(
    VOICE_SETTINGS_FALLBACK,
  );
  expect(lines[1]).toContain('"reason":"targetTurnMinMs"');
  expect(lines[1]).not.toContain("500");
  expect(readVoiceSettings({ VOICE_SETTINGS_JSON: '{"autoAccept":true}' }, log)).toEqual(
    VOICE_SETTINGS_FALLBACK,
  );
  expect(readVoiceSettings({ VOICE_SETTINGS_JSON: "[]" }, log)).toEqual(VOICE_SETTINGS_FALLBACK);
  expect(lines.at(-1)).toContain('"reason":"not_an_object"');
  expect(
    readVoiceSettings(
      { VOICE_SETTINGS_JSON: '{"backgroundCoverage":{"windowMs":58000,"maxWindows":99}}' },
      log,
    ),
  ).toEqual(VOICE_SETTINGS_FALLBACK);
  expect(lines.at(-1)).toContain('"reason":"backgroundCoverage.maxWindows"');
});
