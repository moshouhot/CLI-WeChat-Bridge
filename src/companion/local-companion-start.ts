#!/usr/bin/env node

import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  BRIDGE_LOG_FILE,
  CREDENTIALS_FILE,
  migrateLegacyChannelFiles,
} from "../wechat/channel-config.ts";
import {
  readBridgeLockFile,
  shouldAutoReclaimBridgeLock,
  type BridgeLockPayload,
} from "../bridge/bridge-state.ts";
import {
  clearLocalCompanionOccupancy,
  clearLocalCompanionEndpoint,
  readLocalCompanionEndpoint,
  type LocalCompanionEndpoint,
} from "./local-companion-link.ts";
import type { BridgeAdapterKind } from "../bridge/bridge-types.ts";

type LocalCompanionLaunchAdapter = Exclude<BridgeAdapterKind, "shell">;

type LocalCompanionStartCliOptions = {
  adapter: LocalCompanionLaunchAdapter;
  cwd: string;
  profile?: string;
  timeoutMs: number;
};

type EnsureBridgeReadyResult = {
  shouldOpenCompanion: boolean;
};

export type LocalCompanionLaunchDecision =
  | { kind: "already_active"; message: string }
  | { kind: "open_companion"; message: string }
  | { kind: "restart_unhealthy"; message: string }
  | {
      kind: "switch_workspace";
      fromCwd: string;
      toCwd: string;
      message: string;
      failureMessage: string;
    }
  | { kind: "start_bridge"; message: string };

type DecideLaunchActionInput = {
  requestedAdapter: LocalCompanionLaunchAdapter;
  requestedCwd: string;
  runningLock: BridgeLockPayload | null;
  lockIsAlive: boolean;
  lockShouldAutoReclaim: boolean;
  endpoint: LocalCompanionEndpoint | null;
  endpointIsReachable: boolean;
  companionIsAlive: boolean;
};

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_WAIT_TIMEOUT_MS = 15_000;
const DEFAULT_ADAPTER: LocalCompanionLaunchAdapter = "codex";

function log(adapter: LocalCompanionLaunchAdapter, message: string): void {
  process.stderr.write(`[wechat-${adapter}-start] ${message}\n`);
}

export function normalizeComparablePath(cwd: string): string {
  const normalized = path.resolve(cwd);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

export function isSameWorkspaceCwd(left: string, right: string): boolean {
  return normalizeComparablePath(left) === normalizeComparablePath(right);
}

export function formatAlreadyActiveMessage(cwd: string): string {
  return `Current workspace is already active: ${cwd}. Visible companion is already running, so nothing else was opened.`;
}

export function formatSwitchMessage(fromCwd: string, toCwd: string): string {
  return `Detected active workspace ${fromCwd}. Switching to ${toCwd}...`;
}

export function formatSwitchFailureMessage(cwd: string): string {
  return `Failed to stop the previous workspace bridge. Switch canceled; current workspace remains ${cwd}.`;
}

export function formatRestartUnhealthyMessage(cwd: string): string {
  return `Detected unhealthy companion state for ${cwd}. Restarting bridge...`;
}

export function decideLaunchAction(input: DecideLaunchActionInput): LocalCompanionLaunchDecision {
  const sameWorkspace =
    input.runningLock &&
    input.lockIsAlive &&
    input.runningLock.adapter === input.requestedAdapter &&
    isSameWorkspaceCwd(input.runningLock.cwd, input.requestedCwd);

  if (input.runningLock && input.lockIsAlive) {
    if (input.lockShouldAutoReclaim) {
      return {
        kind: "start_bridge",
        message: `Starting replacement bridge in background for ${input.requestedCwd}...`,
      };
    }

    if (!sameWorkspace) {
      return {
        kind: "switch_workspace",
        fromCwd: input.runningLock.cwd,
        toCwd: input.requestedCwd,
        message: formatSwitchMessage(input.runningLock.cwd, input.requestedCwd),
        failureMessage: formatSwitchFailureMessage(input.runningLock.cwd),
      };
    }

    if (
      input.endpoint &&
      input.endpointIsReachable &&
      input.companionIsAlive &&
      (input.endpoint.companionStatus === "stopped" || input.endpoint.companionStatus === "error")
    ) {
      return {
        kind: "restart_unhealthy",
        message: formatRestartUnhealthyMessage(input.requestedCwd),
      };
    }

    if (input.endpoint && input.endpointIsReachable && input.companionIsAlive) {
      return {
        kind: "already_active",
        message: formatAlreadyActiveMessage(input.requestedCwd),
      };
    }

    return {
      kind: "open_companion",
      message: `Found running bridge for ${input.requestedCwd}. Opening companion...`,
    };
  }

  if (input.endpoint && input.endpointIsReachable && input.companionIsAlive) {
    return {
      kind: "already_active",
      message: formatAlreadyActiveMessage(input.requestedCwd),
    };
  }

  if (input.endpoint && input.endpointIsReachable) {
    return {
      kind: "open_companion",
      message: `Reusing running bridge for ${input.requestedCwd}. Opening companion...`,
    };
  }

  return {
    kind: "start_bridge",
    message: `Starting bridge in background for ${input.requestedCwd}...`,
  };
}

export function parseCliArgs(argv: string[]): LocalCompanionStartCliOptions {
  let adapter: LocalCompanionLaunchAdapter = DEFAULT_ADAPTER;
  let cwd = process.cwd();
  let profile: string | undefined;
  let timeoutMs = DEFAULT_WAIT_TIMEOUT_MS;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];

    if (arg === "--help" || arg === "-h") {
      process.stdout.write(
        [
          "Usage: wechat-codex-start [--cwd <path>] [--profile <name-or-path>] [--timeout-ms <ms>]",
          "       wechat-claude-start [--cwd <path>] [--profile <name-or-path>] [--timeout-ms <ms>]",
          "       local-companion-start [--adapter <codex|claude>] [--cwd <path>] [--profile <name-or-path>] [--timeout-ms <ms>]",
          "",
          "Starts or reuses a transient Codex or Claude bridge for the current directory, waits for the local companion endpoint, then opens the visible local companion.",
          "Closing the visible local companion also stops that transient bridge.",
          "",
        ].join("\n"),
      );
      process.exit(0);
    }

    if (arg === "--adapter") {
      if (!next || !["codex", "claude"].includes(next)) {
        throw new Error(`Invalid adapter: ${next ?? "(missing)"}`);
      }
      adapter = next as LocalCompanionLaunchAdapter;
      i += 1;
      continue;
    }

    if (arg === "--cwd") {
      if (!next) {
        throw new Error("--cwd requires a value");
      }
      cwd = path.resolve(next);
      i += 1;
      continue;
    }

    if (arg === "--profile") {
      if (!next) {
        throw new Error("--profile requires a value");
      }
      profile = next;
      i += 1;
      continue;
    }

    if (arg === "--timeout-ms") {
      if (!next) {
        throw new Error("--timeout-ms requires a value");
      }
      const parsed = Number(next);
      if (!Number.isFinite(parsed) || parsed < 1000) {
        throw new Error("--timeout-ms must be a number >= 1000");
      }
      timeoutMs = Math.trunc(parsed);
      i += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return { adapter, cwd, profile, timeoutMs };
}

function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForProcessExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isPidAlive(pid)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return !isPidAlive(pid);
}

async function stopExistingBridge(
  lock: BridgeLockPayload,
  requestedAdapter: LocalCompanionLaunchAdapter,
): Promise<void> {
  const { pid, cwd } = lock;
  log(requestedAdapter, `Stopping existing bridge for ${cwd} (pid=${pid})...`);

  try {
    process.kill(pid);
  } catch (error) {
    if (isPidAlive(pid)) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to stop existing bridge pid=${pid}: ${message}`);
    }
  }

  if (!(await waitForProcessExit(pid, 10_000))) {
    throw new Error(`Timed out waiting for existing bridge pid=${pid} to exit.`);
  }

  clearLocalCompanionEndpoint(cwd);
  log(
    requestedAdapter,
    `Cleared stale local companion endpoint for previous workspace ${cwd}.`,
  );
}

async function isEndpointReachable(endpoint: LocalCompanionEndpoint): Promise<boolean> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));

  return await new Promise<boolean>((resolve) => {
    const socket = net.connect({
      host: "127.0.0.1",
      port: endpoint.port,
    });

    let done = false;
    const finish = (result: boolean) => {
      if (done) {
        return;
      }
      done = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(400);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

async function readUsableEndpoint(
  cwd: string,
  adapter: LocalCompanionLaunchAdapter,
): Promise<LocalCompanionEndpoint | null> {
  const endpoint = readLocalCompanionEndpoint(cwd);
  if (!endpoint || endpoint.kind !== adapter) {
    return null;
  }

  if (await isEndpointReachable(endpoint)) {
    return endpoint;
  }

  clearLocalCompanionEndpoint(cwd);
  log(adapter, `Removed stale local companion endpoint for ${cwd}.`);
  return null;
}

function isCompanionAlive(endpoint: LocalCompanionEndpoint | null): boolean {
  if (!endpoint?.companionPid) {
    return false;
  }

  if (isPidAlive(endpoint.companionPid)) {
    return true;
  }

  clearLocalCompanionOccupancy(endpoint.cwd, endpoint.instanceId);
  return false;
}

export function buildBackgroundBridgeArgs(
  entryPath: string,
  options: LocalCompanionStartCliOptions,
): string[] {
  const args = [
    "--no-warnings",
    "--experimental-strip-types",
    entryPath,
    "--adapter",
    options.adapter,
    "--cwd",
    options.cwd,
    "--lifecycle",
    "companion_bound",
  ];

  if (options.profile) {
    args.push("--profile", options.profile);
  }

  return args;
}

function startBridgeInBackground(options: LocalCompanionStartCliOptions): void {
  const entryPath = path.resolve(MODULE_DIR, "..", "bridge", "wechat-bridge.ts");
  const args = buildBackgroundBridgeArgs(entryPath, options);

  const child = spawn(process.execPath, args, {
    cwd: options.cwd,
    env: process.env,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });

  child.unref();
}

async function waitForEndpoint(
  cwd: string,
  adapter: LocalCompanionLaunchAdapter,
  timeoutMs: number,
): Promise<LocalCompanionEndpoint> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const endpoint = await readUsableEndpoint(cwd, adapter);
    if (endpoint) {
      return endpoint;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(
    `Timed out waiting for the ${adapter} bridge endpoint for ${cwd}. Check ${BRIDGE_LOG_FILE}.`,
  );
}

async function ensureBridgeReady(
  options: LocalCompanionStartCliOptions,
): Promise<EnsureBridgeReadyResult> {
  const lock = readBridgeLockFile();
  const lockIsAlive = Boolean(lock && isPidAlive(lock.pid));
  const endpoint = await readUsableEndpoint(options.cwd, options.adapter);
  const decision = decideLaunchAction({
    requestedAdapter: options.adapter,
    requestedCwd: options.cwd,
    runningLock: lock,
    lockIsAlive,
    lockShouldAutoReclaim: lockIsAlive && lock ? shouldAutoReclaimBridgeLock(lock) : false,
    endpoint,
    endpointIsReachable: Boolean(endpoint),
    companionIsAlive: isCompanionAlive(endpoint),
  });

  log(options.adapter, decision.message);

  if (decision.kind === "already_active") {
    return { shouldOpenCompanion: false };
  }

  if (decision.kind === "open_companion") {
    if (!endpoint) {
      await waitForEndpoint(options.cwd, options.adapter, options.timeoutMs);
    }
    return { shouldOpenCompanion: true };
  }

  if (decision.kind === "restart_unhealthy") {
    if (!lock || !lockIsAlive) {
      throw new Error("Cannot restart unhealthy workspace because the active bridge lock is missing.");
    }

    await stopExistingBridge(lock, options.adapter);
    log(options.adapter, `Starting replacement bridge in background for ${options.cwd}...`);
    startBridgeInBackground(options);
    await waitForEndpoint(options.cwd, options.adapter, options.timeoutMs);
    return { shouldOpenCompanion: true };
  }

  if (decision.kind === "switch_workspace") {
    if (!lock || !lockIsAlive) {
      throw new Error("Cannot switch workspace because the active bridge lock is missing.");
    }

    try {
      await stopExistingBridge(lock, options.adapter);
    } catch (error) {
      log(options.adapter, decision.failureMessage);
      throw error;
    }

    log(options.adapter, `Starting replacement bridge in background for ${options.cwd}...`);
    startBridgeInBackground(options);
    await waitForEndpoint(options.cwd, options.adapter, options.timeoutMs);
    return { shouldOpenCompanion: true };
  }

  startBridgeInBackground(options);
  await waitForEndpoint(options.cwd, options.adapter, options.timeoutMs);
  return { shouldOpenCompanion: true };
}

async function runCompanion(options: LocalCompanionStartCliOptions): Promise<number> {
  const entryPath = path.resolve(MODULE_DIR, "local-companion.ts");
  const args = [
    "--no-warnings",
    "--experimental-strip-types",
    entryPath,
    "--adapter",
    options.adapter,
    "--cwd",
    options.cwd,
  ];

  return await new Promise<number>((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: options.cwd,
      env: process.env,
      stdio: "inherit",
    });

    child.once("error", (error) => reject(error));
    child.once("exit", (code, signal) => {
      if (signal) {
        process.kill(process.pid, signal);
        return;
      }
      resolve(code ?? 0);
    });
  });
}

async function main(): Promise<void> {
  const options = parseCliArgs(process.argv.slice(2));
  migrateLegacyChannelFiles((message) => log(options.adapter, message));

  if (!fs.existsSync(CREDENTIALS_FILE)) {
    throw new Error(`Missing WeChat credentials. Run "bun run setup" first. (${CREDENTIALS_FILE})`);
  }

  const ready = await ensureBridgeReady(options);
  if (!ready.shouldOpenCompanion) {
    process.exit(0);
  }
  const exitCode = await runCompanion(options);
  process.exit(exitCode);
}

const isDirectRun = Boolean((import.meta as ImportMeta & { main?: boolean }).main);
if (isDirectRun) {
  main().catch((error) => {
    const adapter = (() => {
      try {
        return parseCliArgs(process.argv.slice(2)).adapter;
      } catch {
        return DEFAULT_ADAPTER;
      }
    })();
    log(adapter, error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
