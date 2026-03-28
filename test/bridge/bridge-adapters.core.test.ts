import { describe, expect, test } from "bun:test";

import {
  buildCompanionHealthPatch,
  shouldStopBridgeAfterCompanionDisconnect,
} from "../../src/bridge/bridge-adapters.core.ts";

describe("local companion proxy lifecycle", () => {
  test("persistent bridges stay alive after companion disconnect", () => {
    expect(shouldStopBridgeAfterCompanionDisconnect("persistent")).toBe(false);
  });

  test("companion-bound bridges stop after companion disconnect", () => {
    expect(shouldStopBridgeAfterCompanionDisconnect("companion_bound")).toBe(true);
  });

  test("undefined lifecycle keeps the historical persistent behavior", () => {
    expect(shouldStopBridgeAfterCompanionDisconnect(undefined)).toBe(false);
  });

  test("buildCompanionHealthPatch persists stopped worker state for auto-heal decisions", () => {
    expect(
      buildCompanionHealthPatch(
        {
          kind: "codex",
          status: "stopped",
          pid: undefined,
          cwd: "D:/work/project",
          command: "codex",
        },
        "2026-03-28T00:08:00.000Z",
      ),
    ).toEqual({
      companionStatus: "stopped",
      companionLastStateAt: "2026-03-28T00:08:00.000Z",
      companionWorkerPid: undefined,
    });
  });
});
