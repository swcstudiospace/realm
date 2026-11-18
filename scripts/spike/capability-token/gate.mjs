// CAPT-01 spike: an in-process model of the daemon's admission. The capability names are copied as literals
// (nothing is imported from src), and the mapping mirrors CAPABILITY_FACTS and resolveCapabilities (request AND policy).
import { CAPABILITIES, verifyToken } from './token.mjs';

export { CAPABILITIES };
export const PROFILES = {
  'read-only': ['fs.list', 'fs.read'],
  'workspace-edit': ['fs.list', 'fs.read', 'fs.write'],
  full: CAPABILITIES,
};

// toolCall: { tool, shell? }. Returns the capability name, null (status needs none) or undefined (unknown tool).
export function requiredCapability(toolCall) {
  switch (toolCall.tool) {
    case 'read': return 'fs.read';
    case 'list': return 'fs.list';
    case 'write': return 'fs.write';
    case 'exec': return toolCall.shell === true ? 'exec.shell' : 'exec.argv';
    case 'retry': return 'daemon.attach';
    case 'status': return null;
    default: return undefined;
  }
}

// request: { token, sid, host (the host the caller claims), call }. Admitted only if the token grants the capability
// AND the loaded policy grants it. A valid token never widens the policy.
export function admit(request, policyCaps, keyTable, nowSeconds) {
  const needed = requiredCapability(request.call);
  if (needed === undefined) return { allow: false, reason: 'unknown-tool' };
  const verdict = verifyToken(request.token, keyTable, { sid: request.sid, host: request.host, capability: needed }, nowSeconds);
  if (!verdict.ok) return { allow: false, reason: verdict.reason };
  if (needed !== null && !policyCaps.includes(needed)) return { allow: false, reason: 'policy-denied' };
  return { allow: true, principal: { host: verdict.claims.host, kid: verdict.claims.kid } };
}

// The two audit-line models. The label is whatever the caller says; the token principal is what verification found.
export const auditLineLabel = (sid, call, declaredHost) => ({ sessionId: sid, tool: call.tool, host: declaredHost });
export const auditLineToken = (sid, call, admission) => ({ sessionId: sid, tool: call.tool, host: admission.principal.host, kid: admission.principal.kid });
