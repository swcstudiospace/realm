# Workspace snapshot spike (RES-04)

Date: 2026-11-03. Decision record: D19-6 in `runtime-decision.md`. Script: `scripts/spike/workspace-snapshot.mjs`.

Scope: host filesystem work only. The spike touched no realm state, daemon, container, Podman, OpenShell or gateway. All experiment files lived in a throwaway directory, written here as `<spike-work>`, which was deleted after the run. Paths below use the placeholders `<lane>` (the repository lane root) and `<spike-work>`.

## Host and filesystem

Command: `findmnt -T <spike-work>`

```
TARGET SOURCE    FSTYPE OPTIONS
/      /dev/sda1 ext4   rw,relatime,discard,errors=remount-ro,commit=30
```

`stat -f -c %T` on the same directory printed `ext2/ext3`. That is the kernel's name for the ext4 magic number. `findmnt` is the authority for the filesystem type and it says ext4.

Block layout, read-only: `lsblk -s -o NAME,TYPE,FSTYPE,MOUNTPOINT /dev/sda1` shows `sda1 part ext4 /` above the disk `sda`. There is no LVM or other volume layer under `/`.

## Experiments

### 1. Reflink probe

Commands, run in `<spike-work>`:

```
head -c 1048576 /dev/urandom > reflink-src.bin
cp --reflink=always reflink-src.bin reflink-dst.bin
```

Output of the second command:

```
cp: failed to clone 'reflink-dst.bin' from 'reflink-src.bin': Operation not supported
```

Exit status: 1. Reflink is not available on this ext4 mount. The probe files were deleted.

### 2. Filesystem snapshot probe

Commands: `command -v lvs`, `command -v btrfs`, `command -v zfs`.

| Tool | Present | Result |
| --- | --- | --- |
| lvs | yes (`/usr/sbin/lvs`) | `lvs` listed no volumes. Its only output was two file-descriptor-leak warnings from the calling process. |
| btrfs | yes (`/usr/bin/btrfs`) | `btrfs filesystem show` printed nothing. No btrfs filesystem exists on the host. |
| zfs | no | `command -v zfs` exited 1. |

`/dev/sda1` is a plain partition, not an LVM logical volume, and `/` is not on btrfs or zfs. No filesystem snapshot mechanism is available for `/`.

### 3. Copy mechanism, byte-exact check

Command:

```
node <lane>/scripts/spike/workspace-snapshot.mjs --work <spike-work>/ws > <spike-work>/run1.json
```

Exit status: 0. The real time was 12.717 s for the whole script, including every manifest pass.

Synthetic workspace, built by the script, 83 entries (68 files, 13 directories, 2 symlinks), 67,108,911 file bytes:

- A nine-level nested directory, `d1/d2/.../d9/leaf.txt`.
- `data/all-byte-values.bin`, 1 MiB, containing every byte value 0 to 255.
- `empty.dat`, 0 bytes.
- `secret/token.txt`, mode 0600.
- `bin/run.sh`, mode 0755.
- `links/relative-link`, a relative symlink to `../data/all-byte-values.bin`.
- `links/absolute-link`, an absolute symlink to a file outside the workspace.
- 63 files of 1 MiB random bytes under `data/`.

The copy is the scripted copy. It recreates directories, regular files and symlinks, and it never follows a symlink. It copies with `copyFileSync` and sets the mode bits (07777) explicitly. The manifest of each tree records path, type, mode, size and sha256 for files, and the target string for symlinks.

Result: the copy manifest is identical to the source manifest. Both digests are `ac0be2a229a313320e4caffae547d1aa7182317f543a2b507821b28ac920a571`, with 0 mismatched paths. The copy took 608.567 ms. The fixture checks all passed: nine-level nesting, 256 distinct byte values, zero-byte file, modes 0600 and 0755, and both symlinks as `symlink` entries with their targets unchanged.

### 4. Concurrent writer

The script starts a child process that appends one line every 10 ms to `concurrent/append.log` in the workspace. It waits until five lines exist. It then takes the before manifest, copies, takes the after manifest, and compares them. Finally it sends SIGTERM to the writer.

Result from the recorded run:

- Lines before the window: 5. Lines after the window: 68. Writes inside the window: 63.
- Before and after manifests differ. The changed path is `concurrent/append.log`. The change is detected.
- The snapshot is rejected. The copy manifest did not equal the before manifest.
- The writer stopped on SIGTERM with exit code 0 and no signal.
- After the writer stopped, the log directory was removed and the workspace manifest equals the pre-writer manifest.

The writer experiment is the quiescence check. A snapshot is accepted only when the before and after manifests are identical and the copy manifest equals the before manifest. A snapshot taken while the tree changes is detected and rejected.

### 5. Restore over a modified workspace

Steps:

1. Modify the workspace after the snapshot: add `extra/after-snapshot.txt`, add `d1/d2/extra-leaf.txt`, and append bytes to `data/random-00.bin`. The diff from the snapshot manifest is 4 paths: `d1/d2/extra-leaf.txt`, `data/random-00.bin`, `extra`, `extra/after-snapshot.txt`.
2. Stage: copy the snapshot into `<spike-work>/ws.stage`. The staged manifest equals the snapshot manifest.
3. Restore by entry moves. The root directory is kept. Each root entry (7 of them) moves into `<spike-work>/ws.backup`. Each staged entry (6 of them) moves into the root. The restored manifest is checked against the snapshot manifest. The backup is deleted only after that check passes.

Staging guard, self-tested by the script before the restore:

- A staging path inside the root (`<spike-work>/ws/stage-probe`) was refused with `STAGE_INSIDE_ROOT`.
- A staging path on another device (`/dev/shm/res04-stage-probe`) was refused with `EXDEV`. The devices differed (`/dev/shm` is not on `/`).

Acceptance check, printed by the script:

| Check | Result |
| --- | --- |
| Root st_dev before / after | 2049 / 2049 |
| Root st_ino before / after | 16781770 / 16781770 |
| Root identity same | true |
| Restored manifest equals snapshot manifest | true |
| Restored sha256 (manifest digest) | `ac0be2a229a313320e4caffae547d1aa7182317f543a2b507821b28ac920a571` |
| Post-snapshot files gone | true |
| Snapshot unchanged after restore | true |
| Backup directory removed | true |

The restore worked with no failure, so the rollback path did not run in this recorded run. The rollback is implemented: if any step fails, the moved staged entries go back to the stage, the backup entries go back to the root, and the script checks that the pre-restore manifest is back. That rollback is not measured by this spike.

### 6. Timing, 64 MiB tree

| Measure | Milliseconds |
| --- | --- |
| Build of the synthetic tree | 1075.6 |
| Copy (experiment 3) | 608.6 |
| Restore: copy into stage | 599.3 |
| Restore: move entries out and in | 0.6 |
| Restore: total (copy plus moves, `restoreMs`) | 599.9 |
| Restore: manifest verification after the moves (not in `restoreMs`) | 798.8 |

Timings are from one run on this host. The restore cost is dominated by the stage copy. The entry moves are renames, so they take sub-millisecond time regardless of file size.

## Selected mechanism

Copy with a before-and-after manifest check, and restore by staged entry moves with the root kept.

- Reflink is not used. The probe shows `cp --reflink=always` fails on this ext4 mount (experiment 1).
- A filesystem snapshot is not used. `/` is not on LVM, btrfs or zfs (experiment 2).
- The copy is byte-exact on the recorded tree (experiment 3). Concurrent writes are detected (experiment 4). The restore reproduces the snapshot manifest and keeps the root identity (experiment 5).

## Quiescence rule

A snapshot is accepted only when:

1. the source manifest taken before the copy equals the source manifest taken after the copy, and
2. the copy manifest equals the before manifest.

Experiment 4 shows that a concurrent append is detected by rule 1 and the snapshot is rejected.

The rule is a detection check on point samples. It does not lock the tree. A change that happens and reverts between the samples, and that neither manifest captures, is not detected. The production flow must stop writers of the workspace before the snapshot is taken. The spike does not test a paused sandbox.

## Restore method

The restore follows the method set by the orchestrator:

1. Stage the snapshot in a directory on the same filesystem as the root and outside the root. The guard refuses with `EXDEV` when st_dev differs, and refuses with `STAGE_INSIDE_ROOT` when the staging directory is inside the root.
2. Keep the root directory. Move each existing root entry into a backup directory outside the root.
3. Move each staged entry into the root.
4. Check the restored manifest against the snapshot manifest, and check the root st_dev and st_ino against their values before the restore. Delete the backup only after both checks pass.
5. On any failure, move the backup entries back into the root and move the staged entries back to the stage, then check the pre-restore manifest.

The swap of entries is not atomic across the whole tree. Each entry move is an atomic rename. The rollback covers a failure part way through.

The root directory is never renamed. Its st_dev and st_ino do not change, so a bind mount of the root keeps pointing at the same inode. The spike did not test a live bind mount. While the entries are moved out, the root is briefly empty, so a running sandbox that mounts the root would see an empty workspace for that window. The restore must run with the sandbox stopped.

## Limits

- ext4 has no reflink. Every snapshot is a full copy, so the copy costs time and space proportional to the tree size (O(size)). The restore needs one more full copy in the stage. At the peak, three full trees exist at once: the workspace, the snapshot, and the stage. The spike created a fourth copy transiently for experiment 4, and that copy was removed.
- The staging and backup directories must be outside the workspace root and on the same device. The guard enforces both. The spike placed them as siblings of the root in its own throwaway directory. In production the staging and backup directories must also lie outside the Phase 18 `workspaceRoot`, because sibling directories there sit beside other projects. The spike did not test that placement.
- The rollback is implemented and not exercised by the recorded run.
- The manifest records path, type, mode, size, sha256 and symlink target. It does not record ownership (uid and gid), extended attributes, ACLs or hard-link identity. The copy does not preserve ownership or those attributes, and hard links become separate files. The copy sets the mode bits (07777).
- Special files (devices, FIFOs, sockets) make the script throw. The workspace must not contain them.
- Absolute symlinks are copied verbatim. A link that points at a path inside the workspace still points at that path after a restore, so it resolves against the live workspace and not against the snapshot.
- The largest tree tested is 64 MiB. Timings are from one run on this host.

## Script exit status

`scripts/spike/workspace-snapshot.mjs --work <workspace-dir>` exits:

- 0 when every check holds.
- 1 when experiment 3 finds a copy mismatch, experiment 5 finds a staged or restored mismatch, the root identity changes, the restore fails, or any other check fails.
- 2 on bad arguments. The `--work` directory must not exist or must be empty, and no sibling path may exist.

The experiment 4 before-and-after mismatch is the designed detection, so it does not fail the script. The script fails in experiment 4 only when the writer produces no detection or no writes inside the window.

The script never defaults its workspace path and never reads or writes a realm path.

## Cleanup

The throwaway directory `<spike-work>` was deleted after the run. The probe files of experiment 1 were deleted when the probe finished.

## Full script output

Recorded run: `node <lane>/scripts/spike/workspace-snapshot.mjs --work <spike-work>/ws`, exit status 0. Absolute paths shown as `<spike-work>`.

```json
{
  "experiment": "RES-04 workspace snapshot spike",
  "date": "2026-11-03",
  "node": "v24.18.0",
  "platform": "linux x64",
  "buildMs": 1075.560813,
  "workspace": {
    "entries": 83,
    "files": 68,
    "dirs": 13,
    "symlinks": 2,
    "fileBytes": 67108911,
    "manifestSha256": "ac0be2a229a313320e4caffae547d1aa7182317f543a2b507821b28ac920a571"
  },
  "fixture": {
    "nineLevelNesting": true,
    "distinctByteValues": 256,
    "zeroByteFile": true,
    "mode0600": true,
    "mode0755": true,
    "relativeSymlink": {
      "type": "symlink",
      "target": "../data/all-byte-values.bin"
    },
    "absoluteSymlink": {
      "type": "symlink",
      "target": "<spike-work>/ws.outside/target.txt",
      "expectedTarget": "<spike-work>/ws.outside/target.txt"
    }
  },
  "experiment3CopyMechanism": {
    "accepted": true,
    "sourceStable": true,
    "copyExact": true,
    "copyMs": 608.5674409999997,
    "manifestSha256": "ac0be2a229a313320e4caffae547d1aa7182317f543a2b507821b28ac920a571",
    "copyManifestSha256": "ac0be2a229a313320e4caffae547d1aa7182317f543a2b507821b28ac920a571",
    "mismatchSample": {
      "count": 0,
      "sample": []
    }
  },
  "experiment4ConcurrentWriter": {
    "writerIntervalMs": 10,
    "linesBeforeWindow": 5,
    "linesAfterWindow": 68,
    "linesWrittenInWindow": 63,
    "changeDetected": true,
    "changedPaths": {
      "count": 1,
      "sample": [
        "concurrent/append.log"
      ]
    },
    "snapshotAccepted": false,
    "copyExact": false,
    "writerStop": {
      "code": 0,
      "signal": null
    },
    "workspaceRestoredToPreWriterState": true
  },
  "experiment5StagingGuard": {
    "insideRoot": {
      "path": "<spike-work>/ws/stage-probe",
      "refused": true,
      "code": "STAGE_INSIDE_ROOT"
    },
    "crossDevice": {
      "path": "/dev/shm/res04-stage-probe",
      "devicesDiffer": true,
      "refused": true,
      "code": "EXDEV"
    }
  },
  "experiment5Restore": {
    "method": "keep root; move root entries to backup; move staged entries into root; delete backup after manifest match; roll back on failure",
    "modifiedWorkspaceDiffFromSnapshot": {
      "count": 4,
      "sample": [
        "d1/d2/extra-leaf.txt",
        "data/random-00.bin",
        "extra",
        "extra/after-snapshot.txt"
      ]
    },
    "stageCopyMs": 599.3392990000011,
    "stagedMatchesSnapshot": true,
    "restored": true,
    "error": null,
    "moveMs": 0.589296000000104,
    "verifyMs": 798.8311840000006,
    "backupRemoved": true,
    "entriesMovedOut": 7,
    "entriesMovedIn": 6,
    "rootDevBefore": 2049,
    "rootInoBefore": 16781770,
    "rootDevAfter": 2049,
    "rootInoAfter": 16781770,
    "rootIdentitySame": true,
    "restoredMatchesSnapshot": true,
    "restoredSha256": "ac0be2a229a313320e4caffae547d1aa7182317f543a2b507821b28ac920a571",
    "extraFilesGone": true,
    "snapshotUnchanged": true
  },
  "experiment6Timing": {
    "treeBytes": 67108911,
    "copyMs": 608.5674409999997,
    "restoreMs": 599.9285950000012,
    "restoreCopyIntoStageMs": 599.3392990000011,
    "restoreMoveMs": 0.589296000000104,
    "restoreVerifyMs": 798.8311840000006
  },
  "failures": [],
  "ok": true
}
```
