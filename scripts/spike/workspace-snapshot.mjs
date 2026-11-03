#!/usr/bin/env node
// RES-04 workspace snapshot spike (2026-11-03). Node built-ins only.
//
// Usage: node scripts/spike/workspace-snapshot.mjs --work <workspace-dir>
//
// <workspace-dir> is required and is never defaulted. It must not exist, or
// it must be an empty directory. The script builds a synthetic ~64 MiB tree
// there and writes its siblings "<workspace-dir>.outside", ".snapshot-3",
// ".snapshot-4", ".stage" and ".backup". Use a throwaway directory only.
//
// Runs experiments 3 to 6 and prints one JSON document on stdout.
// Exit status: 0 when every check holds, 1 when a manifest mismatch or a
// failed check is found, 2 on bad arguments.
//
// The manifest of a tree is the sorted list of { path, type, mode } plus
// size and sha256 for files and target for symlinks. Two trees are the same
// only when their manifests are identical.

import { spawn } from 'node:child_process';
import { once } from 'node:events';
import {
  appendFileSync,
  chmodSync,
  constants,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  renameSync,
  rmdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { performance } from 'node:perf_hooks';

const MiB = 1024 * 1024;
const DEEP_DEPTH = 9;

// Child process that appends one line every 10 ms until it gets SIGTERM.
const WRITER_SOURCE = `
const fs = require('node:fs');
const fd = fs.openSync(process.argv[1], 'a');
let n = 0;
const timer = setInterval(() => { fs.writeSync(fd, 'tick ' + (n++) + '\\n'); }, 10);
process.on('SIGTERM', () => { clearInterval(timer); fs.closeSync(fd); process.exit(0); });
process.stdout.write('ready\\n');
`;

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const digestOf = (value) => sha256(JSON.stringify(value));
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const modeString = (mode) => '0' + (mode & 0o7777).toString(8).padStart(3, '0');

function manifest(root) {
  const out = [];
  const visit = (rel) => {
    const dir = rel === '' ? root : join(root, rel);
    for (const name of readdirSync(dir).sort()) {
      const path = rel === '' ? name : `${rel}/${name}`;
      const abs = join(root, path);
      const st = lstatSync(abs);
      const mode = modeString(st.mode);
      if (st.isDirectory()) {
        out.push({ path, type: 'dir', mode });
        visit(path);
      } else if (st.isSymbolicLink()) {
        out.push({ path, type: 'symlink', mode, target: readlinkSync(abs) });
      } else if (st.isFile()) {
        const data = readFileSync(abs);
        out.push({ path, type: 'file', mode, size: data.length, sha256: sha256(data) });
      } else {
        throw new Error(`unsupported file type at ${path}`);
      }
    }
  };
  visit('');
  return out;
}

function diffSample(a, b, limit = 10) {
  const ka = new Map(a.map((e) => [e.path, JSON.stringify(e)]));
  const kb = new Map(b.map((e) => [e.path, JSON.stringify(e)]));
  const changed = [...new Set([...ka.keys(), ...kb.keys()])]
    .filter((p) => ka.get(p) !== kb.get(p))
    .sort();
  return { count: changed.length, sample: changed.slice(0, limit) };
}

const same = (a, b) => diffSample(a, b).count === 0;

function summarise(m) {
  let files = 0;
  let dirs = 0;
  let links = 0;
  let bytes = 0;
  for (const e of m) {
    if (e.type === 'file') {
      files += 1;
      bytes += e.size;
    } else if (e.type === 'dir') dirs += 1;
    else links += 1;
  }
  return { entries: m.length, files, dirs, symlinks: links, fileBytes: bytes, manifestSha256: digestOf(m) };
}

// The scripted copy: regular files, directories and symlinks. Symlinks are
// recreated with their stored target string and never followed.
function copyTree(src, dst) {
  mkdirSync(dst);
  copyDir(src, dst);
  chmodSync(dst, lstatSync(src).mode & 0o7777);
}

function copyDir(srcDir, dstDir) {
  for (const name of readdirSync(srcDir).sort()) {
    const s = join(srcDir, name);
    const d = join(dstDir, name);
    const st = lstatSync(s);
    if (st.isDirectory()) {
      mkdirSync(d);
      copyDir(s, d);
      chmodSync(d, st.mode & 0o7777);
    } else if (st.isSymbolicLink()) {
      symlinkSync(readlinkSync(s), d);
    } else if (st.isFile()) {
      copyFileSync(s, d, constants.COPYFILE_EXCL);
      chmodSync(d, st.mode & 0o7777);
    } else {
      throw new Error(`unsupported file type at ${s}`);
    }
  }
}

// Quiescence rule: accept only when the source manifest is identical before
// and after the copy, and the copy manifest equals the before manifest.
async function snapshotByRule(src, dst) {
  const before = manifest(src);
  const t0 = performance.now();
  copyTree(src, dst);
  const copyMs = performance.now() - t0;
  const after = manifest(src);
  const copied = manifest(dst);
  const sourceStable = same(before, after);
  const copyExact = same(copied, before);
  return {
    accepted: sourceStable && copyExact,
    sourceStable,
    copyExact,
    copyMs,
    beforeDigest: digestOf(before),
    afterDigest: digestOf(after),
    copiedDigest: digestOf(copied),
    beforeVsAfter: diffSample(before, after),
    beforeVsCopy: diffSample(before, copied),
    before,
  };
}

// Staging guard for the restore. The staging directory must be outside the
// workspace root and on the same device as the root, so each entry move is a
// rename(2) and never a copy. The root is never renamed.
function assertStageAllowed(rootPath, stagePath) {
  const rel = relative(rootPath, stagePath);
  const inside = rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
  if (inside) {
    const err = new Error(`staging directory is inside the workspace root: ${stagePath}`);
    err.code = 'STAGE_INSIDE_ROOT';
    throw err;
  }
  const rootDev = statSync(rootPath).dev;
  const parentDev = statSync(dirname(stagePath)).dev;
  if (rootDev !== parentDev) {
    const err = new Error(`staging directory device ${parentDev} differs from workspace root device ${rootDev}`);
    err.code = 'EXDEV';
    throw err;
  }
}

// Restore by entry moves. The root directory is kept, so its st_dev and st_ino
// do not change. Each existing root entry moves to the backup directory, then
// each staged entry moves into the root. The backup is deleted only after the
// restored manifest equals the snapshot manifest. On any failure, the moved
// entries go back, so the original tree returns.
// The swap of entries is not atomic across the tree: each rename is atomic,
// and the rollback covers a failure part way through.
function restoreByEntryMove(rootPath, stagePath, backupPath, snapshotManifest) {
  const rootBefore = statSync(rootPath);
  const originalNames = readdirSync(rootPath).sort();
  const stagedNames = readdirSync(stagePath).sort();
  const preRestore = manifest(rootPath);
  const moved = { toBackup: [], toRoot: [] };
  const t0 = performance.now();
  mkdirSync(backupPath);
  let moveMs;
  let verifyMs;
  try {
    for (const name of originalNames) {
      renameSync(join(rootPath, name), join(backupPath, name));
      moved.toBackup.push(name);
    }
    for (const name of stagedNames) {
      renameSync(join(stagePath, name), join(rootPath, name));
      moved.toRoot.push(name);
    }
    moveMs = performance.now() - t0;
    const tVerify = performance.now();
    const restored = manifest(rootPath);
    verifyMs = performance.now() - tVerify;
    if (!same(restored, snapshotManifest)) {
      throw new Error(`restored manifest mismatch: ${diffSample(snapshotManifest, restored).count} paths`);
    }
    const rootAfter = statSync(rootPath);
    if (rootAfter.dev !== rootBefore.dev || rootAfter.ino !== rootBefore.ino) {
      throw new Error('workspace root identity changed during restore');
    }
  } catch (err) {
    let rollbackError = null;
    try {
      for (const name of [...moved.toRoot].reverse()) {
        renameSync(join(rootPath, name), join(stagePath, name));
      }
      for (const name of [...moved.toBackup].reverse()) {
        renameSync(join(backupPath, name), join(rootPath, name));
      }
      rmdirSync(backupPath);
    } catch (rbErr) {
      rollbackError = String(rbErr && rbErr.message);
    }
    const rollbackVerified =
      rollbackError === null && same(manifest(rootPath), preRestore);
    const rootRolledBack = statSync(rootPath);
    return {
      restored: false,
      error: String(err && err.message),
      rolledBack: rollbackError === null,
      rollbackError,
      rollbackVerified,
      rootDevBefore: rootBefore.dev,
      rootInoBefore: rootBefore.ino,
      rootDevAfter: rootRolledBack.dev,
      rootInoAfter: rootRolledBack.ino,
    };
  }
  rmSync(backupPath, { recursive: true, force: true });
  rmSync(stagePath, { recursive: true, force: true });
  const rootAfter = statSync(rootPath);
  return {
    restored: true,
    error: null,
    moveMs,
    verifyMs,
    backupRemoved: !existsSync(backupPath),
    entriesMovedOut: moved.toBackup.length,
    entriesMovedIn: moved.toRoot.length,
    rootDevBefore: rootBefore.dev,
    rootInoBefore: rootBefore.ino,
    rootDevAfter: rootAfter.dev,
    rootInoAfter: rootAfter.ino,
    rootIdentitySame: rootAfter.dev === rootBefore.dev && rootAfter.ino === rootBefore.ino,
  };
}

function buildWorkspace(ws, outside) {
  mkdirSync(ws, { recursive: true });
  mkdirSync(outside);
  const outsideTarget = join(outside, 'target.txt');
  writeFileSync(outsideTarget, 'target of the absolute symlink, outside the workspace\n');

  let deep = ws;
  const deepRel = [];
  for (let i = 1; i <= DEEP_DEPTH; i += 1) {
    deep = join(deep, `d${i}`);
    deepRel.push(`d${i}`);
    mkdirSync(deep);
  }
  writeFileSync(join(deep, 'leaf.txt'), 'depth nine\n');

  mkdirSync(join(ws, 'data'));
  for (let i = 0; i < 63; i += 1) {
    writeFileSync(join(ws, 'data', `random-${String(i).padStart(2, '0')}.bin`), randomBytes(MiB));
  }
  const allBytes = Buffer.alloc(256 * 4096);
  for (let i = 0; i < allBytes.length; i += 1) allBytes[i] = i & 0xff;
  writeFileSync(join(ws, 'data', 'all-byte-values.bin'), allBytes);

  writeFileSync(join(ws, 'empty.dat'), Buffer.alloc(0));

  mkdirSync(join(ws, 'secret'));
  writeFileSync(join(ws, 'secret', 'token.txt'), 'mode 0600\n');
  chmodSync(join(ws, 'secret', 'token.txt'), 0o600);

  mkdirSync(join(ws, 'bin'));
  writeFileSync(join(ws, 'bin', 'run.sh'), '#!/bin/sh\necho executable\n');
  chmodSync(join(ws, 'bin', 'run.sh'), 0o755);

  mkdirSync(join(ws, 'links'));
  symlinkSync('../data/all-byte-values.bin', join(ws, 'links', 'relative-link'));
  symlinkSync(outsideTarget, join(ws, 'links', 'absolute-link'));

  return { deepFile: [...deepRel, 'leaf.txt'].join('/'), outsideTarget };
}

function fixtureChecks(m, ws, deepFile, outsideTarget) {
  const byPath = new Map(m.map((e) => [e.path, e]));
  const allByte = readFileSync(join(ws, 'data', 'all-byte-values.bin'));
  const rel = byPath.get('links/relative-link');
  const abs = byPath.get('links/absolute-link');
  return {
    nineLevelNesting: byPath.get(deepFile)?.type === 'file',
    distinctByteValues: new Set(allByte).size,
    zeroByteFile: byPath.get('empty.dat')?.size === 0,
    mode0600: byPath.get('secret/token.txt')?.mode === '0600',
    mode0755: byPath.get('bin/run.sh')?.mode === '0755',
    relativeSymlink: { type: rel?.type, target: rel?.target },
    absoluteSymlink: { type: abs?.type, target: abs?.target, expectedTarget: outsideTarget },
  };
}

function lineCount(file) {
  return readFileSync(file, 'utf8').split('\n').length - 1;
}

async function waitForLines(file, n, timeoutMs = 5000) {
  const end = performance.now() + timeoutMs;
  while (lineCount(file) < n) {
    if (performance.now() > end) throw new Error('concurrent writer did not start');
    await sleep(10);
  }
}

async function startWriter(logPath) {
  const child = spawn(process.execPath, ['-e', WRITER_SOURCE, logPath], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await once(child.stdout, 'data');
  return child;
}

async function stopWriter(child) {
  const exited = once(child, 'exit');
  child.kill('SIGTERM');
  const [code, signal] = await exited;
  return { code, signal };
}

// Guard self-test: an inside-root staging path must be refused. A staging
// path on another device must be refused with EXDEV. When /dev/shm is on the
// same device as the root, the EXDEV branch cannot be exercised and is marked
// as such.
function stagingGuardSelfTest(ws) {
  const inside = { path: join(ws, 'stage-probe') };
  try {
    assertStageAllowed(ws, inside.path);
    inside.refused = false;
  } catch (err) {
    inside.refused = err.code === 'STAGE_INSIDE_ROOT';
    inside.code = err.code;
  }
  const crossPath = '/dev/shm/res04-stage-probe';
  const cross = { path: crossPath, devicesDiffer: statSync(ws).dev !== statSync('/dev/shm').dev };
  try {
    assertStageAllowed(ws, crossPath);
    cross.refused = false;
  } catch (err) {
    cross.refused = err.code === 'EXDEV';
    cross.code = err.code;
  }
  if (!cross.devicesDiffer) cross.exercised = false;
  return { insideRoot: inside, crossDevice: cross };
}

function usage(message) {
  process.stderr.write(`${message}\nusage: node scripts/spike/workspace-snapshot.mjs --work <workspace-dir>\n`);
  return 2;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--work' || !args[1]) {
    return usage('--work <workspace-dir> is required');
  }
  const ws = resolve(args[1]);
  const sib = {
    outside: `${ws}.outside`,
    snap3: `${ws}.snapshot-3`,
    snap4: `${ws}.snapshot-4`,
    stage: `${ws}.stage`,
    backup: `${ws}.backup`,
  };
  if (existsSync(ws) && readdirSync(ws).length > 0) {
    return usage('--work must not exist or must be an empty directory');
  }
  for (const p of Object.values(sib)) {
    if (existsSync(p)) return usage(`sibling path already exists: ${p}`);
  }

  const failures = [];
  const result = {
    experiment: 'RES-04 workspace snapshot spike',
    date: '2026-11-03',
    node: process.version,
    platform: `${process.platform} ${process.arch}`,
  };
  let writer = null;

  try {
    // Build the synthetic workspace (experiment 3 fixture).
    const tBuild = performance.now();
    const { deepFile, outsideTarget } = buildWorkspace(ws, sib.outside);
    result.buildMs = performance.now() - tBuild;

    const m3 = manifest(ws);
    result.workspace = summarise(m3);
    result.fixture = fixtureChecks(m3, ws, deepFile, outsideTarget);
    const fx = result.fixture;
    if (fx.nineLevelNesting !== true) failures.push('fixture: nine-level nesting missing');
    if (fx.distinctByteValues !== 256) failures.push('fixture: pure-byte file lacks all 256 values');
    if (fx.zeroByteFile !== true) failures.push('fixture: zero-byte file missing');
    if (fx.mode0600 !== true) failures.push('fixture: mode 0600 file missing');
    if (fx.mode0755 !== true) failures.push('fixture: mode 0755 file missing');
    if (fx.relativeSymlink.type !== 'symlink') failures.push('fixture: relative symlink missing');
    if (fx.absoluteSymlink.type !== 'symlink' || fx.absoluteSymlink.target !== outsideTarget) {
      failures.push('fixture: absolute symlink missing or wrong target');
    }

    // Experiment 3: copy mechanism, byte-exact check by manifest.
    const exp3 = await snapshotByRule(ws, sib.snap3);
    result.experiment3CopyMechanism = {
      accepted: exp3.accepted,
      sourceStable: exp3.sourceStable,
      copyExact: exp3.copyExact,
      copyMs: exp3.copyMs,
      manifestSha256: exp3.beforeDigest,
      copyManifestSha256: exp3.copiedDigest,
      mismatchSample: exp3.beforeVsCopy,
    };
    if (!exp3.accepted) failures.push(`experiment 3: copy manifest mismatch (${exp3.beforeVsCopy.count} paths)`);

    // Experiment 4: concurrent writer, before/after manifest check.
    const concurrentDir = join(ws, 'concurrent');
    const logPath = join(concurrentDir, 'append.log');
    mkdirSync(concurrentDir);
    writer = await startWriter(logPath);
    await waitForLines(logPath, 5);
    const linesBeforeWindow = lineCount(logPath);
    const exp4 = await snapshotByRule(ws, sib.snap4);
    const linesAfterWindow = lineCount(logPath);
    const exit = await stopWriter(writer);
    writer = null;
    if (existsSync(sib.snap4)) rmSync(sib.snap4, { recursive: true, force: true });
    rmSync(concurrentDir, { recursive: true, force: true });
    const stateReset = same(manifest(ws), m3);
    result.experiment4ConcurrentWriter = {
      writerIntervalMs: 10,
      linesBeforeWindow,
      linesAfterWindow,
      linesWrittenInWindow: linesAfterWindow - linesBeforeWindow,
      changeDetected: !exp4.sourceStable,
      changedPaths: exp4.beforeVsAfter,
      snapshotAccepted: exp4.accepted,
      copyExact: exp4.copyExact,
      writerStop: exit,
      workspaceRestoredToPreWriterState: stateReset,
    };
    if (exp4.sourceStable) failures.push('experiment 4: concurrent write not detected');
    if (exp4.accepted) failures.push('experiment 4: snapshot taken during writes was accepted');
    if (result.experiment4ConcurrentWriter.linesWrittenInWindow <= 0) {
      failures.push('experiment 4: writer wrote nothing inside the window');
    }
    if (!stateReset) failures.push('experiment 4: workspace not back to pre-writer state');

    // Experiment 5: restore over a modified workspace. The root is kept and
    // its entries are moved, so the root's st_dev and st_ino must not change.
    result.experiment5StagingGuard = stagingGuardSelfTest(ws);
    const guard = result.experiment5StagingGuard;
    if (guard.insideRoot.refused !== true) failures.push('experiment 5: inside-root staging was not refused');
    if (guard.crossDevice.exercised !== false && guard.crossDevice.refused !== true) {
      failures.push('experiment 5: cross-device staging was not refused with EXDEV');
    }

    mkdirSync(join(ws, 'extra'));
    writeFileSync(join(ws, 'extra', 'after-snapshot.txt'), 'created after the snapshot\n');
    writeFileSync(join(ws, 'd1', 'd2', 'extra-leaf.txt'), 'created after the snapshot\n');
    appendFileSync(join(ws, 'data', 'random-00.bin'), 'modified after the snapshot');
    const modifiedDiff = diffSample(m3, manifest(ws));

    assertStageAllowed(ws, sib.stage);
    const tStage = performance.now();
    copyTree(sib.snap3, sib.stage);
    const stageCopyMs = performance.now() - tStage;
    const stagedMatches = same(manifest(sib.stage), m3);

    let restore;
    try {
      restore = restoreByEntryMove(ws, sib.stage, sib.backup, m3);
    } catch (err) {
      restore = { restored: false, error: String(err && err.message) };
    }
    const restored = restore.restored ? manifest(ws) : null;
    const extraGone =
      restore.restored &&
      !existsSync(join(ws, 'extra')) &&
      !existsSync(join(ws, 'd1', 'd2', 'extra-leaf.txt'));
    result.experiment5Restore = {
      method: 'keep root; move root entries to backup; move staged entries into root; delete backup after manifest match; roll back on failure',
      modifiedWorkspaceDiffFromSnapshot: modifiedDiff,
      stageCopyMs,
      stagedMatchesSnapshot: stagedMatches,
      ...restore,
      restoredMatchesSnapshot: restored ? same(restored, m3) : false,
      restoredSha256: restored ? digestOf(restored) : null,
      extraFilesGone: extraGone,
      snapshotUnchanged: same(manifest(sib.snap3), m3),
    };
    if (!stagedMatches) failures.push('experiment 5: staged tree does not match snapshot manifest');
    if (!restore.restored) failures.push(`experiment 5: restore failed: ${restore.error}`);
    if (restore.restored && !result.experiment5Restore.restoredMatchesSnapshot) {
      failures.push('experiment 5: restored tree does not match snapshot');
    }
    if (restore.restored && !extraGone) failures.push('experiment 5: post-snapshot files survived restore');
    if (restore.restored && !restore.rootIdentitySame) failures.push('experiment 5: root st_dev/st_ino changed');

    // Experiment 6: timings for the 64 MiB tree.
    result.experiment6Timing = {
      treeBytes: result.workspace.fileBytes,
      copyMs: exp3.copyMs,
      restoreMs: restore.restored ? stageCopyMs + restore.moveMs : null,
      restoreCopyIntoStageMs: stageCopyMs,
      restoreMoveMs: restore.moveMs ?? null,
      restoreVerifyMs: restore.verifyMs ?? null,
    };
  } catch (err) {
    failures.push(`exception: ${String(err && err.stack ? err.stack : err)}`);
  } finally {
    if (writer) await stopWriter(writer);
  }

  result.failures = failures;
  result.ok = failures.length === 0;
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result.ok ? 0 : 1;
}

process.exitCode = await main();
