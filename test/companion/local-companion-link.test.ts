import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test } from "bun:test";

const tempDirs: string[] = [];

function makeTempDataDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wechat-link-test-"));
  tempDirs.push(dir);
  return dir;
}

async function loadLocalCompanionLinkModule(dataDir: string) {
  const previous = process.env.CLAUDE_WECHAT_CHANNEL_DATA_DIR;
  process.env.CLAUDE_WECHAT_CHANNEL_DATA_DIR = dataDir;

  try {
    return await import(`../../src/companion/local-companion-link.ts?test=${Date.now()}-${Math.random()}`);
  } finally {
    if (previous === undefined) {
      delete process.env.CLAUDE_WECHAT_CHANNEL_DATA_DIR;
    } else {
      process.env.CLAUDE_WECHAT_CHANNEL_DATA_DIR = previous;
    }
  }
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("local companion endpoint occupancy", () => {
  test("readLocalCompanionEndpoint preserves companion occupancy metadata", async () => {
    const dataDir = makeTempDataDir();
    const cwd = "D:/work/project-a";
    const link = await loadLocalCompanionLinkModule(dataDir);

    link.writeLocalCompanionEndpoint({
      instanceId: "bridge-1",
      kind: "codex",
      port: 8123,
      token: "token-1",
      cwd,
      command: "codex",
      startedAt: "2026-03-28T00:00:00.000Z",
      companionPid: 456,
      companionConnectedAt: "2026-03-28T00:01:00.000Z",
    });

    expect(link.readLocalCompanionEndpoint(cwd)).toEqual({
      instanceId: "bridge-1",
      kind: "codex",
      port: 8123,
      token: "token-1",
      cwd,
      command: "codex",
      startedAt: "2026-03-28T00:00:00.000Z",
      companionPid: 456,
      companionConnectedAt: "2026-03-28T00:01:00.000Z",
      profile: undefined,
      sharedSessionId: undefined,
      sharedThreadId: undefined,
      resumeConversationId: undefined,
      transcriptPath: undefined,
    });
  });

  test("clearLocalCompanionOccupancy removes only companion metadata", async () => {
    const dataDir = makeTempDataDir();
    const cwd = "D:/work/project-b";
    const link = await loadLocalCompanionLinkModule(dataDir);

    link.writeLocalCompanionEndpoint({
      instanceId: "bridge-2",
      kind: "codex",
      port: 9001,
      token: "token-2",
      cwd,
      command: "codex",
      startedAt: "2026-03-28T00:02:00.000Z",
      companionPid: 789,
      companionConnectedAt: "2026-03-28T00:03:00.000Z",
    });

    link.clearLocalCompanionOccupancy(cwd);

    expect(link.readLocalCompanionEndpoint(cwd)).toEqual({
      instanceId: "bridge-2",
      kind: "codex",
      port: 9001,
      token: "token-2",
      cwd,
      command: "codex",
      startedAt: "2026-03-28T00:02:00.000Z",
      companionPid: undefined,
      companionConnectedAt: undefined,
      profile: undefined,
      sharedSessionId: undefined,
      sharedThreadId: undefined,
      resumeConversationId: undefined,
      transcriptPath: undefined,
    });
  });

  test("updateLocalCompanionOccupancy stores companion metadata without touching endpoint identity", async () => {
    const dataDir = makeTempDataDir();
    const cwd = "D:/work/project-c";
    const link = await loadLocalCompanionLinkModule(dataDir);

    link.writeLocalCompanionEndpoint({
      instanceId: "bridge-3",
      kind: "codex",
      port: 9010,
      token: "token-3",
      cwd,
      command: "codex",
      startedAt: "2026-03-28T00:04:00.000Z",
    });

    link.updateLocalCompanionOccupancy(cwd, {
      companionPid: 1001,
      companionConnectedAt: "2026-03-28T00:05:00.000Z",
    });

    expect(link.readLocalCompanionEndpoint(cwd)).toEqual({
      instanceId: "bridge-3",
      kind: "codex",
      port: 9010,
      token: "token-3",
      cwd,
      command: "codex",
      startedAt: "2026-03-28T00:04:00.000Z",
      companionPid: 1001,
      companionConnectedAt: "2026-03-28T00:05:00.000Z",
      profile: undefined,
      sharedSessionId: undefined,
      sharedThreadId: undefined,
      resumeConversationId: undefined,
      transcriptPath: undefined,
    });
  });
});
