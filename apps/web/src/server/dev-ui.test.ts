import { describe, expect, it } from "vitest";
import { devUiEnabled } from "./dev-ui";

describe("UI test pages", () => {
  it("are on in development", () => {
    expect(devUiEnabled({ NODE_ENV: "development" })).toBe(true);
  });

  it("are off in a production build", () => {
    expect(devUiEnabled({ NODE_ENV: "production" })).toBe(false);
    expect(devUiEnabled({ NODE_ENV: "production", RECALINO_DEV_UI: "true" })).toBe(false);
  });

  it("are on in a production build only with RECALINO_DEV_UI=1", () => {
    expect(devUiEnabled({ NODE_ENV: "production", RECALINO_DEV_UI: "1" })).toBe(true);
  });
});
