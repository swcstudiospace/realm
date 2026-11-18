// The one-time diagnostic of a refused capability token (Phase 34, D-34-05). realm mcp and realm acp observe each tool outcome;
// on the first POLICY_DENIED of the process they write one stderr line that names the likely cause and the fix, and never again.
// The wire stays frozen: the refusal itself carries no reason, so this line is the only place a stale or unlabelled session
// learns why. The two texts are constants: they carry no token, key, path or policy value, and the labelled one names only the
// host id the operator already typed.

import type { ToolOutcome } from "../tools/dispatch.js";
import type { HostId } from "./types.js";

export interface RefusalHint {
  // Observes one outcome. Writes the diagnostic on the first refused POLICY_DENIED outcome, nothing afterwards.
  readonly observe: (outcome: ToolOutcome) => void;
}

const UNLABELLED_TEXT =
  "realm: this session has no host id, so it carries no capability token; capability tokens are enforced by default; " +
  "add the host flag with an id to the realm mcp launcher (realm host list names the ids) or set capabilityTokens.mode to off " +
  "in the policy file; see docs/integration/mcp.md, Q10.\n";

function labelledText(hostId: HostId): string {
  return (
    `realm: the daemon refused a call from host ${hostId} with POLICY_DENIED; when the policy is not the cause, the key was ` +
    "revoked or rotated (reconnect the host), the token expired, or the host profile lacks the capability " +
    "(capabilityTokens.profiles); run realm doctor.\n"
  );
}

export function createRefusalHint(hostId: HostId | null, write: (text: string) => void): RefusalHint {
  let written = false;
  return {
    observe(outcome) {
      if (written || outcome.outcome !== "refused" || outcome.code !== "POLICY_DENIED") {
        return;
      }
      written = true;
      write(hostId === null ? UNLABELLED_TEXT : labelledText(hostId));
    },
  };
}
