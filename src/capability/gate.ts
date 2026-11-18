// The capability gate (CAPT-06, CAPT-07, D-32-06, D-32-07, D-32-10): the only daemon-side code that touches the keyring and
// the token module. The daemon builds it when the policy mode is enforce and calls it from two places: attach, which mints a
// token for an admitted session and writes its audit line, and check, which verifies the token of a tool request before the
// dispatcher runs. Everything here fails closed. A refusal carries an internal class for the daemon log and nothing else:
// the wire answer is POLICY_DENIED with no cause and no detail, and the class never reaches a client.
//
// Privacy rule: no log line, audit line or error built here carries a token, a key or a payload. A log line names the
// host, the kid, the session id, the tool name and the refusal class only.

import { appendAudit as defaultAppendAudit } from "../audit/log.js";
import type { Policy } from "../contract/validate.js";
import { makeRealmError } from "../core/errors.js";
import { HOST_IDS, type HostId } from "../host/types.js";
import type { Logger } from "../observe/logger.js";
import { capabilityPolicyOf, profileFor, requiredCapability } from "./admit.js";
import {
  ensureKeyring,
  keyringIdentity,
  readKeyring,
  type KeyringOptions,
  type KeyringSnapshot,
} from "./keyring.js";
import { createLimiter } from "./limiter.js";
import { mintToken, verifyToken, type RefusalClass, type TokenPrincipal, type VerifyResult } from "./token.js";

// What a refused call is recorded under: its tool name when it names one of the six tools, `unknown` otherwise. A raw key
// from the wire is never echoed into the audit file, the log or the metrics.
const TOOL_NAMES: readonly string[] = ["read", "list", "write", "exec", "status", "retry"];
const UNKNOWN_TOOL = "unknown";

export interface CapabilityGateOptions {
  readonly stateDir: string;
  readonly policy: Policy;
  // Milliseconds. The daemon's clock; a test injects its own.
  readonly now: () => number;
  readonly logger: Logger;
  // Defaults to appendAudit. A test injects a failing one to prove the attach fails closed.
  readonly appendAudit?: typeof defaultAppendAudit;
  // Keyring test seams. The keyring clock defaults to the gate clock in whole seconds.
  readonly keyring?: KeyringOptions;
}

export type CapabilityVerdict =
  | { readonly ok: true; readonly principal: TokenPrincipal }
  | { readonly ok: false; readonly tool: string };

export interface CapabilityGate {
  // Mints a token for an admitted session. Throws POLICY_DENIED for a host outside HOST_IDS or an empty audit bound,
  // AUDIT_WRITE_FAILED when the attach line cannot be written, and the keyring's refusal when the keyring is unusable.
  attach(input: { readonly sessionId: string; readonly host: string }): { readonly token: string; readonly expiresAt: number };
  // Verifies the token of one tool request. Never throws.
  check(input: { readonly tool: unknown; readonly token: unknown; readonly sessionId: string }): CapabilityVerdict;
}

// The gate for the policy, or undefined when the mode is off: nothing is minted, checked or logged then.
export function createCapabilityGate(options: CapabilityGateOptions): CapabilityGate | undefined {
  const { stateDir, policy, now, logger } = options;
  const settings = capabilityPolicyOf(policy);
  if (settings.mode !== "enforce") {
    return undefined;
  }
  const write = options.appendAudit ?? defaultAppendAudit;
  const keyringOptions: KeyringOptions = { now: () => Math.floor(now() / 1000), ...options.keyring };
  const limiter = createLimiter(now);
  const held: { snapshot: KeyringSnapshot | undefined; dropped: number } = { snapshot: undefined, dropped: 0 };

  // The keyring as it is now: the held snapshot while the file identity is unchanged, a fresh read when it changed. The
  // verify path never creates the file (a missing keyring refuses); the mint path creates it.
  const keyring = (create: boolean): KeyringSnapshot => {
    const identity = keyringIdentity(stateDir);
    const current = held.snapshot;
    if (
      identity !== null &&
      current !== undefined &&
      current.identity.ino === identity.ino &&
      current.identity.mtimeMs === identity.mtimeMs &&
      current.identity.size === identity.size
    ) {
      return current;
    }
    const read = identity === null ? undefined : readKeyring(stateDir, keyringOptions);
    if (read?.present === true) {
      held.snapshot = read.snapshot;
      return read.snapshot;
    }
    held.snapshot = undefined;
    if (!create) {
      throw makeRealmError("POLICY_DENIED");
    }
    held.snapshot = ensureKeyring(stateDir, keyringOptions);
    return held.snapshot;
  };

  // Counts a line the bound refused and logs the running count.
  const drop = (): void => {
    held.dropped += 1;
    logger.warn("capability.audit_dropped", { dropped: held.dropped });
  };

  // One capability audit line within the bound. A line over the bound is not written and counted; a line that cannot be
  // written is logged and dropped, because a refusal is never turned into a different answer by its own audit failure.
  const auditRefusal = (sessionId: string, tool: string, principal: TokenPrincipal | undefined): void => {
    if (!limiter.take()) {
      drop();
      return;
    }
    try {
      write(stateDir, {
        sessionId,
        tool,
        outcome: "POLICY_DENIED",
        ...(principal === undefined ? {} : { host: principal.host, kid: principal.kid }),
      });
    } catch {
      logger.warn("capability.audit_failed", { tool });
    }
  };

  const refuse = (
    sessionId: string,
    tool: string,
    refusal: RefusalClass | "keyring",
    principal: TokenPrincipal | undefined,
  ): CapabilityVerdict => {
    logger.warn("capability.refused", { refusal, tool, sessionId });
    auditRefusal(sessionId, tool, principal);
    return { ok: false, tool };
  };

  return {
    attach: ({ sessionId, host }) => {
      const hostId: HostId | undefined = HOST_IDS.find((known) => known === host);
      if (hostId === undefined) {
        throw makeRealmError("POLICY_DENIED");
      }
      // An attach over the bound is refused: the attach line is the detection trail for a process that attaches as a host
      // it is not, so an attach that would leave no line is not granted.
      if (!limiter.take()) {
        drop();
        throw makeRealmError("POLICY_DENIED");
      }
      const snapshot = keyring(true);
      const key = snapshot.lookup(snapshot.active);
      if (key === undefined) {
        throw makeRealmError("POLICY_DENIED");
      }
      const iat = Math.floor(now() / 1000);
      const exp = iat + settings.ttlSeconds;
      const token = mintToken(key, {
        kid: snapshot.active,
        sid: sessionId,
        host: hostId,
        caps: profileFor(policy, hostId),
        iat,
        exp,
      });
      try {
        write(stateDir, {
          sessionId,
          tool: "capability.attach",
          outcome: "ok",
          host: hostId,
          kid: snapshot.active,
        });
      } catch {
        throw makeRealmError("AUDIT_WRITE_FAILED");
      }
      logger.info("capability.attached", { host: hostId, kid: snapshot.active, sessionId });
      return { token, expiresAt: exp };
    },

    check: ({ tool, token, sessionId }) => {
      const name = toolNameOf(tool);
      let verdict: VerifyResult;
      try {
        const needed = requiredCapability(tool);
        verdict = verifyToken(
          token,
          keyring(false).lookup,
          sessionId,
          needed === "none" || needed === "unmapped" ? null : needed,
          Math.floor(now() / 1000),
        );
      } catch {
        // An absent, unreadable or unsafe keyring refuses every verification: fail closed.
        return refuse(sessionId, name, "keyring", undefined);
      }
      if (verdict.ok) {
        return { ok: true, principal: { host: verdict.claims.host, kid: verdict.claims.kid } };
      }
      return refuse(sessionId, name, verdict.refusal, verdict.principal);
    },
  };
}

function toolNameOf(tool: unknown): string {
  if (typeof tool !== "object" || tool === null || Array.isArray(tool)) {
    return UNKNOWN_TOOL;
  }
  const names = Object.keys(tool);
  const only = names[0];
  return names.length === 1 && only !== undefined && TOOL_NAMES.includes(only) ? only : UNKNOWN_TOOL;
}
