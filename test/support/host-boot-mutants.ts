// Seeded defects for the production boot driver (Phase 26, TEST-HOST-04). A patch wraps a hook and breaks exactly one of its
// methods, so the conformance harness (host-boot-conformance.ts) can be shown to fail on the real driver as well as on the
// reference hook's own faults (reference-boot-hook.ts). Test support only: nothing in src imports this file.

import { bootHookOf } from "../../src/host/boot-driver.js";
import type { HostBootHook, HostBootHookFactory, HostRuntimeEntry } from "../../src/host/types.js";

// Receives the inner hook and returns the decorated one.
export type HookPatch = (inner: HostBootHook) => HostBootHook;

// The production factory of a table row, or a thrown error when the row has no driver (an extension host).
export function driverFactoryOf(entry: HostRuntimeEntry): HostBootHookFactory {
  const factory = bootHookOf(entry);
  if (factory === null) {
    throw new Error(`${entry.id} has no production boot driver`);
  }
  return (deps, manifest) => factory(deps, manifest);
}

// Wraps every hook the factory builds with the patch.
export function decorateDriver(factory: HostBootHookFactory, patch: HookPatch): HostBootHookFactory {
  return (deps, manifest) => patch(factory(deps, manifest));
}

// The guard resolves undefined for every tool name, so nothing is refused (C5).
export const guardOpen: HookPatch = (inner) => ({
  start: (workspaceRoot) => inner.start(workspaceRoot),
  switchWorkspace: (workspaceRoot) => inner.switchWorkspace(workspaceRoot),
  status: () => inner.status(),
  guard: () => Promise.resolve(undefined),
  retry: () => inner.retry(),
  shutdown: () => inner.shutdown(),
});

// A switch of workspace resolves without calling the inner hook, so nothing re-attaches (C9).
export const switchNoop: HookPatch = (inner) => ({
  start: (workspaceRoot) => inner.start(workspaceRoot),
  switchWorkspace: () => Promise.resolve(),
  status: () => inner.status(),
  guard: (toolName) => inner.guard(toolName),
  retry: () => inner.retry(),
  shutdown: () => inner.shutdown(),
});

// A retry resolves without calling the inner hook, so no new attach happens (C3, C4).
export const retryNoop: HookPatch = (inner) => ({
  start: (workspaceRoot) => inner.start(workspaceRoot),
  switchWorkspace: (workspaceRoot) => inner.switchWorkspace(workspaceRoot),
  status: () => inner.status(),
  guard: (toolName) => inner.guard(toolName),
  retry: () => Promise.resolve(),
  shutdown: () => inner.shutdown(),
});
