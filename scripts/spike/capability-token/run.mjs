#!/usr/bin/env node
// CAPT-01 capability token spike (2026-11-17). Node built-ins only. Throwaway evidence, not production code:
// it imports nothing from src or dist, is not a test, and does not ship.
// Usage: node scripts/spike/capability-token/run.mjs --work SCRATCH [--only e1,e2,...]
// SCRATCH is required and never defaulted: an absolute path that does not exist or is an empty directory, outside the
// repository and the real home's dot-directories; created 0700, and every file written is inside it. Prints one JSON
// document with the scratch path as WORK, and never a token or key (a length and 8 hex of a sha256 at most).
// Exit status: 0 every selected expectation held; 1 one did not (or a child was not reaped, or the report failed its
// own checks); 2 bad arguments or a violated scratch guard.
import { Buffer } from 'node:buffer';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, chownSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { CAPABILITIES, mintToken, signPayload, verifyToken } from './token.mjs';
import { PROFILES, admit, auditLineLabel, auditLineToken } from './gate.mjs';
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..');
const NOW = 1_700_000_000;
const ALL = ['e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'e7', 'e8', 'e9'];
const sha8 = (v) => createHash('sha256').update(v).digest('hex').slice(0, 8);
const facts = (token) => ({ length: token.length, sha8: sha8(token) });
const claimsFor = (profile, over = {}) => ({ sid: 's1', host: 'cursor', caps: PROFILES[profile], iat: NOW - 10, exp: NOW + 3600, ...over });
const fresh = () => { const key = randomBytes(32); return { key, keys: new Map([['k1', key]]) }; };
const freshToken = () => mintToken(randomBytes(32), 'k1', { ...claimsFor('full'), iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 });
const reasonOf = (verdict) => (verdict.ok ? 'accepted' : verdict.reason);
// E1: round trip and refusal matrix. Each defect is re-signed where it lives in the payload, so the reason is its own.
function e1() {
  const { key, keys } = fresh();
  const c = claimsFor('read-only');
  const good = mintToken(key, 'k1', c);
  const [, payload, tag] = good.split('.');
  const canon = (over) => ({ v: 1, kid: 'k1', sid: c.sid, host: c.host, caps: c.caps, iat: c.iat, exp: c.exp, ...over });
  const mac = Buffer.from(tag, 'base64url');
  const badMac = `rcap1.${payload}.${Buffer.from(mac.map((b, i) => (i === 0 ? b ^ 1 : b))).toString('base64url')}`;
  const sidSwap = Buffer.from(Buffer.from(payload, 'base64url').toString().replace('"s1"', '"s2"')).toString('base64url');
  const s2 = { sid: 's2' };
  const rows = [
    ['valid token', 'accepted', good],
    ['tampered payload byte', 'bad-mac', `rcap1.${sidSwap}.${tag}`],
    ['tampered MAC byte', 'bad-mac', badMac],
    ['MAC truncated to 31 bytes', 'format', `rcap1.${payload}.${mac.subarray(0, 31).toString('base64url')}`],
    ['wrong key', 'bad-mac', mintToken(randomBytes(32), 'k1', c)],
    ['unknown kid', 'unknown-kid', mintToken(key, 'k9', c)],
    ['version 2', 'bad-version', signPayload(key, canon({ v: 2 }))],
    ['payload with an extra key', 'bad-payload', signPayload(key, { ...canon({}), extra: 1 })],
    ['exp as a string', 'bad-payload', signPayload(key, canon({ exp: String(c.exp) }))],
    ['caps unsorted', 'bad-payload', signPayload(key, canon({ caps: ['fs.read', 'fs.list'] }))],
    ['caps with a duplicate', 'bad-payload', signPayload(key, canon({ caps: ['fs.list', 'fs.list', 'fs.read'] }))],
    ['caps containing net.egress', 'bad-payload', signPayload(key, canon({ caps: ['fs.list', 'fs.read', 'net.egress'] }))],
    ['exp in the past', 'time-window', signPayload(key, canon({ iat: NOW - 7200, exp: NOW - 3600 }))],
    ['iat 120 s in the future', 'time-window', signPayload(key, canon({ iat: NOW + 120, exp: NOW + 3720 }))],
    ['lifetime 86401 s', 'time-window', signPayload(key, canon({ iat: NOW, exp: NOW + 86401 }))],
    ['presented for session s2', 'wrong-session', good, s2],
    ['presented as host claude', 'wrong-host', good, { host: 'claude' }],
    ['padded base64url MAC', 'format', `${good}=`],
    ['capability outside the token set', 'capability-not-granted', good, { capability: 'fs.write' }],
    ['no token', 'format', undefined],
    ['not a token', 'format', 'abc'],
    ['order: tampered MAC before wrong session', 'bad-mac', badMac, s2],
    ['order: unknown kid before MAC', 'unknown-kid', mintToken(key, 'k9', c).replace(/.$/, 'A')],
    ['order: version before time window', 'bad-version', signPayload(key, canon({ v: 2, iat: NOW - 7200, exp: NOW - 3600 }))],
    ['order: time window before session', 'time-window', signPayload(key, canon({ iat: NOW - 7200, exp: NOW - 3600 })), s2],
    ['order: session before host', 'wrong-session', good, { sid: 's2', host: 'claude' }],
  ];
  const seen = {};
  const bad = [];
  for (const [name, expected, text, over] of rows) {
    seen[name] = reasonOf(verifyToken(text, keys, { sid: 's1', host: 'cursor', capability: 'fs.read', ...over }, NOW));
    if (seen[name] !== expected) bad.push(`${name}: expected ${expected}, observed ${seen[name]}`);
  }
  return { expect: 'each defect refuses with its own reason in the fixed order; the valid token is accepted', observed: `${rows.length} rows, ${bad.length} mismatches`, ok: bad.length === 0, token: facts(good), reasons: [...new Set(Object.values(seen))].sort(), rows: seen, mismatches: bad };
}

// E2: capability enforcement. The expectation is computed here from the mapping and the sets, not by calling admit.
function e2() {
  const { key, keys } = fresh();
  const policies = { 'all-six': CAPABILITIES, 'no-shell-no-write': CAPABILITIES.filter((cap) => cap !== 'exec.shell' && cap !== 'fs.write') };
  const need = { read: 'fs.read', list: 'fs.list', write: 'fs.write', 'exec-argv': 'exec.argv', 'exec-shell': 'exec.shell', retry: 'daemon.attach', status: null };
  const calls = { read: { tool: 'read' }, list: { tool: 'list' }, write: { tool: 'write' }, 'exec-argv': { tool: 'exec' }, 'exec-shell': { tool: 'exec', shell: true }, retry: { tool: 'retry' }, status: { tool: 'status' } };
  const matrix = {};
  const row = {};
  const bad = [];
  for (const [profile, caps] of Object.entries(PROFILES)) {
    const token = mintToken(key, 'k1', claimsFor(profile));
    for (const [policy, pcaps] of Object.entries(policies)) {
      row[`${profile}/${policy}`] = {};
      for (const [name, call] of Object.entries(calls)) {
        const verdict = admit({ token, sid: 's1', host: 'cursor', call }, pcaps, keys, NOW);
        row[`${profile}/${policy}`][name] = verdict.allow ? 'allow' : verdict.reason;
        if (verdict.allow !== (need[name] === null || (caps.includes(need[name]) && pcaps.includes(need[name])))) bad.push(`${profile}/${policy}/${name}`);
      }
      matrix[`${profile}/${policy}`] = Object.entries(row[`${profile}/${policy}`]).map(([k, v]) => `${k}=${v}`).join(' ');
    }
  }
  const ro = row['read-only/all-six'];
  const full = row['full/no-shell-no-write'];
  const named = ['write', 'exec-argv', 'exec-shell', 'retry'].every((n) => ro[n] === 'capability-not-granted') && ['read', 'list', 'status'].every((n) => ro[n] === 'allow')
    && full.write === 'policy-denied' && full['exec-shell'] === 'policy-denied' && full['exec-argv'] === 'allow';
  return { expect: 'read-only denies write, both exec forms and retry; a token never widens the policy; shell form needs exec.shell', observed: `${Object.keys(matrix).length} profile/policy pairs, ${bad.length} mismatches against the mapping, named expectations ${named ? 'held' : 'FAILED'}`, ok: bad.length === 0 && named, matrix, mismatches: bad };
}

// Children: one inline ES module per role, spawned by this harness, never given a path inside the repository.
const P = "import { createHash } from 'node:crypto'; import { readFileSync, writeFileSync, statSync, openSync, closeSync } from 'node:fs';"
  + " const sha8 = (s) => createHash('sha256').update(s).digest('hex').slice(0, 8); const say = (o) => console.log(JSON.stringify(o)); const code = (e) => e.code ?? 'error';";
const HOLD_FILE = `${P} let t = ''; for await (const c of process.stdin) t += c;
try { writeFileSync(process.argv[1], t, { mode: 0o600 }); say({ length: t.length, sha8: sha8(t) }); } catch (e) { say({ error: code(e) }); }
setInterval(() => {}, 1000);`;
const HOLD_ENV = `${P} const t = process.env.REALM_SPIKE_TOKEN; say({ length: t.length, sha8: sha8(t) }); setInterval(() => {}, 1000);`;
const READ_FILE = `${P} try { say({ sha8: sha8(readFileSync(process.argv[1], 'utf8')) }); } catch (e) { say({ error: code(e) }); }`;
const READ_ENV = `${P} try { const kv = readFileSync('/proc/' + process.argv[1] + '/environ', 'latin1').split('\\0').find((x) => x.startsWith('REALM_SPIKE_TOKEN='));
say(kv === undefined ? { found: false } : { sha8: sha8(kv.slice(18)) }); } catch (e) { say({ error: code(e) }); }`;
const PROBE = `${P} const out = {}; const levels = JSON.parse(process.argv[1]);
for (const [name, path] of levels) { try { statSync(path); out[name] = 'ok'; } catch (e) { out[name] = code(e); } }
try { closeSync(openSync(levels.at(-1)[1], 'r')); out.open = 'ok'; } catch (e) { out.open = code(e); } say(out);`;

const children = [];
function start(src, args, { env = {}, uid, stdin = '' } = {}) {
  const proc = spawn(process.execPath, ['--input-type=module', '-e', src, ...args], { cwd: '/', env, stdio: ['pipe', 'pipe', 'ignore'], ...(uid === undefined ? {} : { uid, gid: uid }) });
  const closed = new Promise((done) => proc.once('close', done));
  const line = new Promise((done, fail) => {
    let buf = '';
    const timer = setTimeout(() => fail(new Error('child timeout')), 10_000);
    proc.stdout.on('data', (d) => { buf += d; if (buf.includes('\n')) { clearTimeout(timer); done(JSON.parse(buf.split('\n')[0])); } });
    proc.once('error', (e) => { clearTimeout(timer); fail(e); });
    proc.once('close', () => { clearTimeout(timer); fail(new Error('child exited without output')); });
  });
  line.catch(() => undefined);
  proc.stdin.on('error', () => undefined);
  proc.stdin.end(stdin);
  children.push({ proc, closed });
  return { proc, line };
}
async function reapAll() {
  for (const { proc } of children) proc.kill('SIGKILL');
  return (await Promise.race([Promise.all(children.map((c) => c.closed)), sleep(10_000, 'stuck', { ref: false })])) === 'stuck';
}

const rootAndNobody = () => process.getuid?.() === 0 && /^[^:]*:[^:]*:65534:/m.test(readFileSync('/etc/passwd', 'utf8'));
const traversable = (path) => { for (let p = path; ; p = dirname(p)) { if ((statSync(p).mode & 0o001) === 0) return false; if (p === dirname(p)) return true; } };
const NO_NOBODY = 'not run: needs root, uid 65534 in /etc/passwd and a scratch path that uid can traverse';
// Runs fn with the scratch root opened to traverse (0711) for uid 65534, then restores 0700. Null when it cannot run.
async function asNobody(work, fn) {
  if (!rootAndNobody()) return null;
  chmodSync(work, 0o711);
  try { return traversable(work) ? await fn() : null; } finally { chmodSync(work, 0o700); }
}

// E3: a same-uid sibling reads a token at rest. Run as the harness uid and, as root, again as uid 65534 for both children.
async function e3(work) {
  const variants = {};
  const run = async (name, dir, uid) => {
    mkdirSync(dir, { mode: 0o700 });
    if (uid !== undefined) chownSync(dir, uid, uid);
    const file = join(dir, 'token');
    const held = await start(HOLD_FILE, [file], { uid, stdin: freshToken() }).line;
    const read = await start(READ_FILE, [file], { uid }).line;
    variants[name] = { holder: held, siblingRead: read, fileMode: (statSync(file).mode & 0o777).toString(8), siblingObtainedToken: held.sha8 !== undefined && held.sha8 === read.sha8 };
  };
  await run('harness-uid', join(work, 'e3'));
  if ((await asNobody(work, () => run('uid-65534', join(work, 'e3n'), 65534))) === null) variants['uid-65534'] = NO_NOBODY;
  const ran = Object.values(variants).filter((v) => typeof v === 'object');
  return { expect: 'a same-uid sibling process reads a 0600 token file (the limit is real)', observed: ran.map((v) => (v.siblingObtainedToken ? 'sibling obtained the token' : `sibling did not obtain it (${v.siblingRead.error ?? 'digest differs'})`)).join('; '), ok: ran.every((v) => v.siblingObtainedToken), variants };
}

// E4: a non-descendant same-uid sibling reads a token held in another process's environment through /proc.
async function e4() {
  const scope = '/proc/sys/kernel/yama/ptrace_scope';
  if (process.platform !== 'linux' || !existsSync('/proc/self/environ')) return { expect: 'Linux only', observed: 'not run: no /proc on this platform', ok: true };
  const variants = {};
  const run = async (uid) => {
    const holder = start(HOLD_ENV, [], { env: { REALM_SPIKE_TOKEN: freshToken() }, uid });
    const held = await holder.line;
    const read = await start(READ_ENV, [String(holder.proc.pid)], { uid }).line;
    return { holder: held, siblingRead: read, siblingObtainedToken: held.sha8 !== undefined && held.sha8 === read.sha8 };
  };
  variants['harness-uid'] = await run(undefined);
  variants['uid-65534'] = rootAndNobody() ? await run(65534) : 'not run: needs root and uid 65534';
  const ran = Object.values(variants).filter((v) => typeof v === 'object');
  return { expect: 'a same-uid, non-descendant sibling reads the token from /proc/PID/environ on a default Linux (recorded as observed)', observed: ran.map((v) => (v.siblingObtainedToken ? 'sibling obtained the token' : `sibling did not obtain it (${v.siblingRead.error ?? v.siblingRead.found ?? 'digest differs'})`)).join('; '),
    ok: ran.every((v) => v.siblingObtainedToken), uid: process.getuid?.(), ptrace_scope: existsSync(scope) ? readFileSync(scope, 'utf8').trim() : 'absent', variants };
}

// E5: a different uid against a 0600 token file under a 0700 directory. Each path level is statted to say where it was refused.
async function e5(work) {
  const result = await asNobody(work, async () => {
    const d = join(work, 'e5');
    mkdirSync(join(d, 'dir'), { recursive: true });
    chmodSync(d, 0o711);
    chmodSync(join(d, 'dir'), 0o700);
    writeFileSync(join(d, 'dir', 'token'), freshToken(), { mode: 0o600 });
    const levels = [['WORK', work], ['e5', d], ['dir', join(d, 'dir')], ['token', join(d, 'dir', 'token')]];
    return start(PROBE, [JSON.stringify(levels)], { uid: 65534 }).line;
  });
  if (result === null) return { expect: 'EACCES or EPERM for another uid', observed: NO_NOBODY, ok: true };
  const first = ['WORK', 'e5', 'dir', 'token'].find((level) => result[level] !== 'ok');
  return { expect: 'the kernel refuses another uid with EACCES or EPERM (the case the 0600 socket already stops)', observed: `open of the token file: ${result.open}; first refused level: ${first}`, ok: result.open === 'EACCES' || result.open === 'EPERM', levels: result };
}

// E6: cost. Median over 20000 iterations each, in microseconds, via process.hrtime.bigint().
function e6() {
  const { key, keys } = fresh();
  const median = (xs) => Float64Array.from(xs).sort()[xs.length >> 1];
  const time = (fn) => { const t = []; for (let i = 0; i < 20000; i++) { const a = process.hrtime.bigint(); fn(); t.push(Number(process.hrtime.bigint() - a)); } return Math.round(median(t) / 10) / 100; };
  const lengths = Object.fromEntries(Object.keys(PROFILES).map((p) => [p, mintToken(key, 'k1', claimsFor(p)).length]));
  const token = mintToken(key, 'k1', claimsFor('full'));
  const ctx = { sid: 's1', host: 'cursor', capability: 'fs.read' };
  const texts = ['token.mjs', 'gate.mjs', 'run.mjs'].map((f) => readFileSync(join(HERE, f), 'utf8'));
  const specs = new Set(texts.flatMap((t) => [...t.matchAll(/(?:from\s+|import\s*\(\s*)['"]([^'"]+)['"]/g)].map((m) => m[1])));
  const external = [...specs].filter((s) => !s.startsWith('node:') && !s.startsWith('.'));
  return { expect: 'under 400 bytes; verify in microseconds; zero dependencies', observed: `token bytes ${JSON.stringify(lengths)}; mint ${time(() => mintToken(key, 'k1', claimsFor('full')))} us, verify ${time(() => verifyToken(token, keys, ctx, NOW))} us (median of 20000); ${external.length} dependencies`,
    ok: external.length === 0 && Math.max(...Object.values(lengths)) < 400, lines: texts.map((t) => t.split('\n').length - 1), dependencies: external.length, relativeImports: [...specs].filter((s) => s.startsWith('.')).length };
}

// E7 (a): the redaction patterns, copied from src/audit/redact.ts as literals and checked against that file's text.
const VALUE_PATTERNS = [/Bearer\s+\S+/gi, /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/g, /AKIA[0-9A-Z]{16}/g, /gh[pousr]_[A-Za-z0-9_]{20,}/g, /sk-[A-Za-z0-9_-]{20,}/g];
const KEY_PATTERN = /token|secret|password|passwd|api[_-]?key|authorization|cookie|credential|private[_-]?key/i;
const ASSIGN_PATTERN = /(?<![A-Za-z0-9_])(?=[A-Za-z0-9_]*(?:token|secret|password|key))([A-Za-z0-9_]+)=\S+/gi;
function e7() {
  const source = readFileSync(join(REPO, 'src', 'audit', 'redact.ts'), 'utf8');
  const copiesMatch = [...VALUE_PATTERNS, KEY_PATTERN, ASSIGN_PATTERN].every((re) => source.includes(re.source));
  const valueLayer = (s) => VALUE_PATTERNS.reduce((out, re) => out.replace(re, '[REDACTED]'), s);
  const shaped = 'rcap1.AbCdEfGhIjKlMnOpQrSt.uVwXyZ0123456789-_ab';
  const changes = (s) => valueLayer(s) !== s;
  const r = { patternsMatchSource: copiesMatch, valueLayerChangesShapedValue: changes(shaped), valueLayerChangesRealToken: changes(freshToken()), keyLayerRedactsKeyToken: KEY_PATTERN.test('token'), keyLayerRedactsKeyNote: KEY_PATTERN.test('note'),
    assignmentLayerRedactsEnvStyle: `REALM_SPIKE_TOKEN=${shaped}`.replace(ASSIGN_PATTERN, '$1=[REDACTED]') !== `REALM_SPIKE_TOKEN=${shaped}`, bearerRedacted: changes(`Bearer ${shaped}`) };
  return { expect: 'a rcap1 value under key note is not redacted by the value layer; under key token it is redacted by the key layer', observed: `value layer changes the token-shaped value: ${r.valueLayerChangesShapedValue}; key layer redacts key token: ${r.keyLayerRedactsKeyToken}, key note: ${r.keyLayerRedactsKeyNote}`,
    ok: r.patternsMatchSource && !r.valueLayerChangesShapedValue && r.keyLayerRedactsKeyToken && !r.keyLayerRedactsKeyNote, a: r, b: 'Biscuit probe is a manual shell sequence (npm view, install with --ignore-scripts, import); recorded in the plan summary, not here' };
}

// E8: rotation and revocation by kid.
function e8() {
  const keys = new Map([['k1', randomBytes(32)], ['k2', randomBytes(32)]]);
  const [t1, t2] = [mintToken(keys.get('k1'), 'k1', claimsFor('full')), mintToken(keys.get('k2'), 'k2', claimsFor('full'))];
  const ctx = { sid: 's1', host: 'cursor', capability: 'fs.read' };
  const before = reasonOf(verifyToken(t1, keys, ctx, NOW));
  keys.delete('k1');
  const [old, current] = [reasonOf(verifyToken(t1, keys, ctx, NOW)), reasonOf(verifyToken(t2, keys, ctx, NOW))];
  return { expect: 'revocation is key rotation by kid: a retired kid refuses, the active kid is accepted', observed: `k1 token before retiring: ${before}; after retiring k1: ${old}; k2 token: ${current}`, ok: before === 'accepted' && old === 'unknown-kid' && current === 'accepted' };
}

// E9: attribution, label versus token, for two hosts that share one session and one audit file model.
function e9() {
  const { key, keys } = fresh();
  const call = { tool: 'write' };
  const tokens = { cursor: mintToken(key, 'k1', claimsFor('full', { host: 'cursor' })), claude: mintToken(key, 'k1', claimsFor('full', { host: 'claude' })) };
  const audit = [auditLineLabel('s1', call, 'claude')]; // the caller is really cursor and says claude; nothing refuses it
  const forged = admit({ token: tokens.cursor, sid: 's1', host: 'claude', call }, CAPABILITIES, keys, NOW);
  const real = admit({ token: tokens.cursor, sid: 's1', host: 'cursor', call }, CAPABILITIES, keys, NOW);
  const holder = admit({ token: tokens.claude, sid: 's1', host: 'claude', call }, CAPABILITIES, keys, NOW);
  if (real.allow) audit.push(auditLineToken('s1', call, real));
  const line = audit[1] === undefined ? '' : JSON.stringify(audit[1]);
  const spoofed = audit[0].host === 'claude';
  return { expect: 'the self-declared label is spoofable; a token claim that does not match the token refuses', observed: `label line recorded host ${audit[0].host} for a cursor caller (spoofed: ${spoofed}); cursor token claiming claude: ${forged.reason}; valid cursor call recorded host ${audit[1]?.host} with kid ${audit[1]?.kid}`,
    ok: spoofed && forged.allow === false && forged.reason === 'wrong-host' && real.allow === true && audit[1]?.host === 'cursor' && audit[1]?.kid === 'k1' && !line.includes(tokens.cursor),
    limit: `holder of the claude token presented as claude: ${holder.allow ? 'admitted (possession, not identity)' : holder.reason}`, lines: audit };
}
const EXPERIMENTS = { e1, e2, e3, e4, e5, e6, e7, e8, e9 };
const usage = (msg) => { process.stderr.write(`${msg}\nusage: node scripts/spike/capability-token/run.mjs --work SCRATCH [--only e1,e2]\n`); return 2; };
function guard(work) {
  if (work === undefined) return '--work is required';
  if (!isAbsolute(work) || resolve(work) !== work) return '--work must be an absolute, normalised path';
  if (!existsSync(dirname(work))) return 'the parent of --work must exist';
  if (existsSync(work) && (!statSync(work).isDirectory() || readdirSync(work).length > 0)) return '--work must not exist or must be an empty directory';
  const real = existsSync(work) ? realpathSync(work) : join(realpathSync(dirname(work)), basename(work));
  const inside = (outer, path = real) => { const rel = relative(outer, path); return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel)); };
  if (inside(REPO) || inside(realpathSync(REPO))) return '--work must not be inside the repository';
  for (const home of new Set([homedir(), userInfo().homedir])) if (inside(home) && relative(home, real).split(sep)[0].startsWith('.')) return '--work must not be inside a dot-directory of the home directory';
  return null;
}

async function main() {
  const argv = process.argv.slice(2);
  const take = (flag) => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : undefined);
  if (argv.some((a, i) => !['--work', '--only'].includes(a) && !['--work', '--only'].includes(argv[i - 1]))) return usage('unknown argument');
  const selected = take('--only') === undefined ? ALL : take('--only').split(',');
  if (selected.some((id) => !ALL.includes(id))) return usage('--only takes a comma-separated list of e1 to e9');
  const work = take('--work');
  const problem = guard(work);
  if (problem !== null) return usage(problem);
  if (!existsSync(work)) mkdirSync(work, { mode: 0o700 });
  chmodSync(work, 0o700);
  const experiments = {};
  let stuck;
  try {
    for (const id of selected) {
      try { experiments[id] = await EXPERIMENTS[id](work); } catch (error) { experiments[id] = { expect: 'the experiment runs', observed: `threw: ${error instanceof Error ? error.message : String(error)}`, ok: false }; }
    }
  } finally { stuck = await reapAll(); }
  const text = JSON.stringify({ node: process.version, platform: process.platform, experiments }, null, 2).split(realpathSync(work)).join('WORK').split(work).join('WORK');
  const violated = [selected.some((id) => !(id in experiments)) && 'missing experiment id', /\/(root|tmp|home|Users)\//.test(text) && 'absolute path prefix in the report', /[0-9a-f]{16,}/i.test(text) && 'hex run of 16 or more characters in the report'].find(Boolean);
  if (violated) { process.stdout.write(`${violated}\n`); return 1; }
  process.stdout.write(`${text}\n`);
  return !stuck && selected.every((id) => experiments[id].ok === true) ? 0 : 1;
}
process.exitCode = await main();
