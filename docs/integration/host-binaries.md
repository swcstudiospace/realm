# Host binaries: what the realm runs outside the sandbox image

Measured on the reference host on 2026-10-28.

## What this record is for

The realm's sandbox image is pinned by digest, but the sandbox is started by binaries that live on the host: the host supervisor, the `openshell` CLI, the OpenShell gateway and Podman. This record states which binaries the reference host holds, how each was measured, what is and is not known about where each came from, and how to record a pin that the driver and `realm doctor` check. It is the record the A18 supply-chain findings 1 and 2 point to (see `docs/integration/openshell.md`).

## Binaries measured

| Binary | Path | Version | SHA-256 | Size (bytes) | Modified | Owner, mode | Packaged |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Host supervisor | The path in `REALM_DRIVER_SUPERVISOR_BINARY`, in the realm account's bin directory | openshell-supervisor 0.1.5 | `1b97e115b63bbd5e791398eef7107143e8e8626d4481fe9363f78ac0941b9328` | 39289576 | 2026-10-26 | realm account, 755 | No |
| OpenShell CLI | `/usr/bin/openshell` | 0.1.5 | `446f766842d2bf03abc37b56a3f5a3e46b96140b5b6c305d3f168d67921fd271` | 26525968 | 2026-10-24 | root, 755 | See below |
| OpenShell gateway | `/usr/bin/openshell-gateway` | 0.1.5 | `c8fa78fd49f245978f64d038207ce0205d98fcdd48bf115bae8a0b9f4f4d5003` | 106396704 | 2026-10-24 | root, 755 | See below |
| Podman (used by the realm) | `/usr/local/bin/podman` | 5.7.1 | `190c130ac5e38e528d61967d4d177d1b320bf2016e8756402e14eba99f2cec63` | 65173088 | 2026-10-23 | root, 755 | No |
| Podman (package, not used by the realm) | `/usr/bin/podman` | 4.9.3 | `859cb7e29723d1ca2f6bec025405b7ed6ea3040709ed129d7fed5f8fca92d2ca` | 37282144 | 2024-10-01 | root, 755 | Yes: package `podman` 4.9.3+ds1-1ubuntu0.2 |

Notes:

- Host supervisor: there is no build record. It was probably built from the OpenShell source at commit `bdb956f2cd65a635f1294fccf1d138d263bf650f`, tag `v0.1.5` (inference, not recorded).
- `/usr/local/bin/podman` 5.7.1 is the Podman the realm account uses. It must come first on the realm account's `PATH`, ahead of `/usr/bin/podman` 4.9.3.
- `/usr/bin/podman` 4.9.3 is not used by the realm.

## Install source and signature

The install source and signature are unrecorded for every binary above. No release channel, download URL, signature or checksum file was kept, and nothing here claims a verified channel. The digests above say which files the host held on 2026-10-28; they do not say that those files came from an upstream release.

## Package metadata must not be used to verify these binaries

The package manager reports `openshell` 0.1.2-1, while the installed files are 0.1.5. They were overwritten in place on 2026-10-24, and the 0.1.2 files are kept in the evidence backup. Package metadata therefore says nothing about the installed bytes. A package upgrade or reinstall of `openshell` would silently replace the 0.1.5 files.

Recommendation (needs a host change that the owner must approve): hold the `openshell` package so that a package operation cannot replace the files.

## Recording a pin

1. Run `realm doctor`. The `host-binaries` item prints `name version sha-prefix` for the supervisor, the `openshell` CLI, `openshell-gateway` and `podman`.
2. Copy the version and the digest. Compute the full digest of each file with `sha256sum`; the doctor prints only a prefix.
3. For the supervisor, set `REALM_DRIVER_SUPERVISOR_SHA256` (lowercase hex SHA-256) in the driver's unit. The same variable is read by the doctor, so one variable pins both. Set `REALM_DRIVER_SUPERVISOR_BINARY` in the doctor's environment too: the doctor reads it from its own environment, and the supervisor line warns "not configured" where it is not set. When a daemon answers `realm doctor`, the environment that counts is the daemon's, so the daemon's environment needs the path and the pin.
4. Where the doctor runs, set `REALM_HOST_PIN_<NAME>_SHA256`, `REALM_HOST_PIN_<NAME>_VERSION` and `REALM_HOST_PIN_<NAME>_PATH` for each binary. The names are `SUPERVISOR`, `OPENSHELL`, `OPENSHELL_GATEWAY` and `PODMAN`. `REALM_HOST_PIN_SUPERVISOR_SHA256` overrides `REALM_DRIVER_SUPERVISOR_SHA256` for the doctor only.

A digest pin is valid only when it is exactly 64 lowercase hex characters, the same form the driver accepts. The doctor does not lowercase a pin. A pin in any other form makes `host-binaries` warn with the fix "a pin must be 64 lowercase hex characters"; an upper-case pin used to give a clean doctor and a driver that refuses to start. The same holds for whitespace: the driver's own variable `REALM_DRIVER_SUPERVISOR_SHA256`, which the doctor falls back to, is read exactly as set, so a value with a trailing newline or spaces, or one set to the empty string, is reported as malformed, because the driver refuses to start on it. The doctor's own `REALM_HOST_PIN_*` variables still ignore an empty value. When both `REALM_HOST_PIN_SUPERVISOR_SHA256` and the driver's variable are set, the doctor's variable wins, so the doctor can check a digest other than the one the driver enforces; set them to the same value.

What a pin does:

- The driver refuses to start with `SCHEMA_INVALID` when `REALM_DRIVER_SUPERVISOR_SHA256` is set and the supervisor file's digest differs. It computes the digest from the file at its path at config load and re-hashes the file immediately before each supervisor spawn. The refusal names neither the digest nor the path. With the variable unset, no digest check runs.
- The file is spawned by path after the hash, so a swap between the hash and the exec is not detected. The pin protects against drift and accidental or out-of-band replacement of the binary. It does not protect against a writer with the same uid: the supervisor file is owned by the realm account, and the sandbox runs as that uid.
- The doctor's `host-binaries` item warns, and never fails, on a missing binary or on a version, digest or path that differs from a recorded pin. It also warns when the supervisor is found but has no digest pin, with the fix "set REALM_DRIVER_SUPERVISOR_SHA256 to the sha256 shown above". The other three binaries still pass without a pin. With a readable runtime config the full report has fourteen items; the three after `kernel-hardening` are `runtime-roots`, `driver-socket` and `gateway`, described in `docs/integration/openshell.md`.
- The doctor bounds each probe (a version read) at 5 seconds, and the digest of each binary at its own 30 seconds (`hashTimeoutMs`). The separate bound exists because a cold read of the 106 MB gateway binary on a busy host once outlasted 5 seconds and made the item warn; a warm read passed.
- The pin is opt-in. Making it mandatory in production is an owner decision.

## Doctor run on the production stack (2026-10-28)

Observed with Podman 5.7.1:

- With no daemon, on 2026-10-28, `realm doctor` ran its then-eleven local checks and exited 0.
- With a daemon answering, every check passed except `anda-bridge` (no engine URL is configured, expected) and `host-binaries`. `host-binaries` warned only because the daemon's environment carried no `REALM_DRIVER_SUPERVISOR_BINARY`, so the supervisor could not be located: the check reads the path from the environment of the process that answers.
- With the path and the pin in that environment, `host-binaries` passed and printed `supervisor 0.1.5 1b97e115b63b`, `openshell 0.1.5 446f766842d2`, `openshell-gateway 0.1.5 c8fa78fd49f2` and `podman 5.7.1 190c130ac5e3` (digest prefixes of 12 characters, matching the table above).
- `kernel-hardening` reported yama `ptrace_scope` 1.

## Owner decisions that remain

- Which release channel and signature to trust for the OpenShell CLI, the gateway and Podman.
- Whether to build the supervisor in this repository's image pipeline.
