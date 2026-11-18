// CAPT-01 spike (2026-11-17): the C2 token, rcap1.PAYLOAD.MAC. Throwaway evidence, not production code.
// Node built-ins only. Refusal reasons are internal names; a real build would answer POLICY_DENIED for all of them.
import { Buffer } from 'node:buffer';
import { createHmac, timingSafeEqual } from 'node:crypto';

export const CAPABILITIES = ['daemon.attach', 'exec.argv', 'exec.shell', 'fs.list', 'fs.read', 'fs.write']; // sorted
// The 19 host ids minus omp (its integration is "extension", which this spike does not cover).
export const HOSTS = ['claude', 'opencode', 'kilo', 'codex', 'copilot', 'antigravity', 'cursor', 'windsurf', 'augment',
  'trae', 'qwen', 'hermes', 'codebuddy', 'cline', 'kimi', 'kimi-code', 'zcode', 'pi'];
const KEYS = ['v', 'kid', 'sid', 'host', 'caps', 'iat', 'exp'];
const SKEW = 60;
const MAX_LIFE = 86400;
const b64 = (bytes) => Buffer.from(bytes).toString('base64url');
const mac = (key, payload) => createHmac('sha256', key).update(Buffer.concat([Buffer.from('realm-capt-v1\0'), payload])).digest();
const int = (n) => Number.isSafeInteger(n);

// Strict base64url: the alphabet only, and the decoded bytes must re-encode to the same text.
function unb64(text) {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) return null;
  const bytes = Buffer.from(text, 'base64url');
  return bytes.toString('base64url') === text ? bytes : null;
}

// Signs any payload object as given (the experiments use it to forge a defect and still carry a valid MAC).
export function signPayload(key, payloadObject) {
  const payload = Buffer.from(JSON.stringify(payloadObject));
  return `rcap1.${b64(payload)}.${b64(mac(key, payload))}`;
}

// claims: { sid, host, caps, iat, exp }. The payload key order is fixed: v, kid, sid, host, caps, iat, exp.
export function mintToken(key, kid, claims) {
  return signPayload(key, { v: 1, kid, sid: claims.sid, host: claims.host, caps: claims.caps, iat: claims.iat, exp: claims.exp });
}

function schemaOk(p) {
  return Object.keys(p).join() === KEYS.join() && int(p.v) && typeof p.kid === 'string' && /^[a-z0-9]{1,16}$/.test(p.kid)
    && typeof p.sid === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(p.sid) && HOSTS.includes(p.host)
    && Array.isArray(p.caps) && p.caps.every((c, i) => CAPABILITIES.includes(c) && (i === 0 || p.caps[i - 1] < c))
    && int(p.iat) && int(p.exp);
}

// context: { sid, host, capability } (capability null when the tool needs none). Returns { ok, claims } or { ok: false, reason }.
export function verifyToken(text, keyTable, context, nowSeconds) {
  const no = (reason) => ({ ok: false, reason });
  const parts = typeof text === 'string' ? text.split('.') : [];
  const payload = parts.length === 3 && parts[0] === 'rcap1' ? unb64(parts[1]) : null;
  const tag = parts.length === 3 ? unb64(parts[2]) : null;
  if (payload === null || tag === null || tag.length !== 32) return no('format');
  let claims;
  try { claims = JSON.parse(payload.toString('utf8')); } catch { return no('format'); } // no kid can be read from it
  if (typeof claims !== 'object' || claims === null || Array.isArray(claims) || typeof claims.kid !== 'string') return no('format');
  const key = keyTable.get(claims.kid);
  if (key === undefined) return no('unknown-kid');
  if (!timingSafeEqual(mac(key, payload), tag)) return no('bad-mac');
  if (!schemaOk(claims)) return no('bad-payload');
  if (claims.v !== 1) return no('bad-version');
  if (claims.iat > nowSeconds + SKEW || claims.exp <= nowSeconds || claims.exp <= claims.iat || claims.exp - claims.iat > MAX_LIFE) return no('time-window');
  if (claims.sid !== context.sid) return no('wrong-session');
  if (claims.host !== context.host) return no('wrong-host');
  if (context.capability !== null && !claims.caps.includes(context.capability)) return no('capability-not-granted');
  return { ok: true, claims };
}
