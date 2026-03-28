import { describe, expect, test } from "bun:test";
import path from "node:path";

import {
  buildBackgroundBridgeArgs,
  decideLaunchAction,
  formatAlreadyActiveMessage,
  formatSwitchFailureMessage,
  formatSwitchMessage,
  isSameWorkspaceCwd,
  normalizeComparablePath,
  parseCliArgs,
} from "../../src/companion/local-companion-start.ts";

describe("local-companion-start helpers", () => {
  test("parseCliArgs uses current working directory by default", () => {
    const options = parseCliArgs([]);
    expect(options.adapter).toBe("codex");
    expect(options.cwd).toBe(process.cwd());
    expect(options.timeoutMs).toBe(15000);
  });

  test("parseCliArgs parses adapter, cwd, profile, and timeout", () => {
    const options = parseCliArgs([
      "--adapter",
      "claude",
      "--cwd",
      "./tmp/project",
      "--profile",
      "work",
      "--timeout-ms",
      "25000",
    ]);

    expect(options.adapter).toBe("claude");
    expect(options.cwd).toBe(path.resolve("./tmp/project"));
    expect(options.profile).toBe("work");
    expect(options.timeoutMs).toBe(25000);
  });

  test("buildBackgroundBridgeArgs binds codex background bridge to the launcher lifetime", () => {
    const args = buildBackgroundBridgeArgs("/tmp/wechat-bridge.ts", {
      adapter: "codex",
      cwd: path.resolve("./tmp/project"),
      profile: "work",
      timeoutMs: 15000,
    });

    expect(args).toEqual([
      "--no-warnings",
      "--experimental-strip-types",
      "/tmp/wechat-bridge.ts",
      "--adapter",
      "codex",
      "--cwd",
      path.resolve("./tmp/project"),
      "--lifecycle",
      "companion_bound",
      "--profile",
      "work",
    ]);
  });

  test("buildBackgroundBridgeArgs can launch claude in the background", () => {
    const args = buildBackgroundBridgeArgs("/tmp/wechat-bridge.ts", {
      adapter: "claude",
      cwd: path.resolve("./tmp/project"),
      timeoutMs: 15000,
    });

    expect(args).toEqual([
      "--no-warnings",
      "--experimental-strip-types",
      "/tmp/wechat-bridge.ts",
      "--adapter",
      "claude",
      "--cwd",
      path.resolve("./tmp/project"),
      "--lifecycle",
      "companion_bound",
    ]);
  });

  test("normalizeComparablePath is stable for the same logical cwd", () => {
    const first = normalizeComparablePath(".");
    const second = normalizeComparablePath(process.cwd());
    expect(first).toBe(second);
  });

  test("isSameWorkspaceCwd matches equivalent directory paths", () => {
    expect(isSameWorkspaceCwd(".", process.cwd())).toBe(true);
  });

  test("same workspace with live companion is already active", () => {
    const decision = decideLaunchAction({
      requestedAdapter: "codex",
      requestedCwd: "D:/work/project",
      runningLock: {
        pid: 123,
        parentPid: 321,
        instanceId: "bridge-1",
        adapter: "codex",
        command: "codex",
        cwd: "D:/work/project",
        startedAt: "2026-03-28T00:00:00.000Z",
        lifecycle: "companion_bound",
      },
      lockIsAlive: true,
      lockShouldAutoReclaim: false,
      endpoint: {
        instanceId: "bridge-1",
        kind: "codex",
        port: 8123,
        token: "token",
        cwd: "D:/work/project",
        command: "codex",
        startedAt: "2026-03-28T00:01:00.000Z",
        companionPid: 456,
        companionConnectedAt: "2026-03-28T00:02:00.000Z",
      },
      endpointIsReachable: true,
      companionIsAlive: true,
    });

    expect(decision).toEqual({
      kind: "already_active",
      message: formatAlreadyActiveMessage("D:/work/project"),
    });
  });

  test("same workspace reopens companion when bridge is alive but companion is gone", () => {
    const decision = decideLaunchAction({
      requestedAdapter: "codex",
      requestedCwd: "D:/work/project",
      runningLock: {
        pid: 123,
        parentPid: 321,
        instanceId: "bridge-1",
        adapter: "codex",
        command: "codex",
        cwd: "D:/work/project",
        startedAt: "2026-03-28T00:00:00.000Z",
        lifecycle: "companion_bound",
      },
      lockIsAlive: true,
      lockShouldAutoReclaim: false,
      endpoint: {
        instanceId: "bridge-1",
        kind: "codex",
        port: 8123,
        token: "token",
        cwd: "D:/work/project",
        command: "codex",
        startedAt: "2026-03-28T00:01:00.000Z",
      },
      endpointIsReachable: true,
      companionIsAlive: false,
    });

    expect(decision).toEqual({
      kind: "open_companion",
      message: "Found running bridge for D:/work/project. Opening companion...",
    });
  });

  test("different workspace requests an explicit switch", () => {
    const decision = decideLaunchAction({
      requestedAdapter: "codex",
      requestedCwd: "D:/work/project-b",
      runningLock: {
        pid: 123,
        parentPid: 321,
        instanceId: "bridge-1",
        adapter: "codex",
        command: "codex",
        cwd: "D:/work/project-a",
        startedAt: "2026-03-28T00:00:00.000Z",
        lifecycle: "companion_bound",
      },
      lockIsAlive: true,
      lockShouldAutoReclaim: false,
      endpoint: null,
      endpointIsReachable: false,
      companionIsAlive: false,
    });

    expect(decision).toEqual({
      kind: "switch_workspace",
      fromCwd: "D:/work/project-a",
      toCwd: "D:/work/project-b",
      message: formatSwitchMessage("D:/work/project-a", "D:/work/project-b"),
      failureMessage: formatSwitchFailureMessage("D:/work/project-a"),
    });
  });
});
