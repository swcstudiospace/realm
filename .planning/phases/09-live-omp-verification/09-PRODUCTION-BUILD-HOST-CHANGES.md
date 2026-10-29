# Phase 9 Production Build: Host Change List

Status: PLAN ONLY. No host change has been made by this planning pass. Every entry below is a proposal, and each is applied only in its phase and only after the approval named in the status column.

Conventions: "realm account" is the dedicated rootless account (realmlive). "Root account" is the host's administrator account. Paths are given as names under the realm account's home, its configuration directory, its state directory, or its runtime directory. Commands run as root unless stated.

## Changes in this plan

| ID | Phase | Host change | Owner approval status | Revert |
|---|---|---|---|---|
| HC-01 | 9.1 | Enable linger for the realm account, so its user manager and the rootless API survive logout and reboot | Approved in principle (PD-04); re-applied in 9.1 after the owner confirms | `loginctl disable-linger <realm account>` |
| HC-02 | 9.1 | Add a container configuration file for the realm account, in its configuration directory, setting the OCI runtime to `runc` (the file is per-account, so no other account changes) | Approved in the spike (round 2 and 3); re-applied in 9.1 | Delete the file; remove the directory if empty |
| HC-03 | 9.1 | Add and enable a user-manager unit for the rootless API service of the realm account, with `Delegate=yes` and `DelegateSubgroup`, so resource limits work | Needed; approval required in 9.1 | `systemctl --user -M <realm account>@ disable --now <unit>`, then delete the unit file and `daemon-reload` |
| HC-04 | 9.4 | Add and enable a user unit for the realm compute driver (PD-05) | Needed; approval required before 9.4 | Disable and stop the unit; delete the unit file; `daemon-reload` |
| HC-05 | 9.1 and 9.4 | Add a dedicated realm gateway: user unit, config file (rendered by `src/runtime/gateway-config.ts`), and its bind endpoint (PD-02) | Required; approval of PD-02 first | Disable and stop the unit; delete its config and state directory. The main gateway is not changed |
| HC-06 | 9.1 | Generate gateway TLS and JWT material into the realm account's state directory, with directory 0700 and key files 0600 (PD-03) | Required; approval of PD-03 first | Delete the generated directory. Nothing outside it changes |
| HC-07 | before 9.1 | The spike's `generate-certs` wrote identity material under the root account's default configuration directory at 07:34:43. The CLI's client files were then replaced at 07:45:31 with the gateway's original client identity, which verifies against the gateway CA. The CLI works with it. | Owner decision PD-17 (recommended: keep it) | Restore from the backup in the phase 9 scratch area. Deleting the directory would break the CLI |
| HC-08 | 9.2 and 9.3 | Build the derived sandbox image in the realm account's rootless image store. Disk guard: 8 GiB free before each build (the root filesystem reached 100% once in phase 9) | Required; approval of PD-16 | `podman rmi <image>` as the realm account |
| HC-09 | none after 9.5 | The root login profile line `export PATH=/usr/local/bin:$PATH` marked for phase 9 (decision D-013, applied). The driver does not need it under PD-11 | Already applied under D-013; remove only if PD-11 is option (a) and the owner chooses to | Remove the two marked lines from the root login profile |
| HC-10 | 9.6 | Realm containers and images created by the live proof, all carrying realm labels | Required for the live proof | `realm down`, then `podman rm -f` for each realm-labelled container, then `podman rmi` for test images |

## Leftovers from the spike, not reverted in the spike's last round

The spike's round 3 report records its revert exit codes. Items below are the parts that were kept, with the reason.

| ID | Leftover | Why kept | Owner decision | Revert |
|---|---|---|---|---|
| HC-11 | The spike tree, outside the repository, with a gateway database, TLS and JWT material, and the failed `g1-probe` record | Kept as evidence | Decide to keep or delete. Deletion is irreversible | Delete the directory tree (after the owner confirms) |
| HC-12 | Podman's runtime directories under the realm account's runtime directory (`containers`, `crun`, `libpod`, `netns`, `runc`) | Created by Podman on use; Podman owns them | Accepted | Removed by Podman when the account's user manager stops, or delete when the account is idle |
| HC-13 | The realm account's user manager (`user@<uid>.service`) state | Spike stopped it to revert; with linger on (HC-01) it starts at boot | Follows HC-01 | Disable linger (HC-01) |

## What this plan does not change

- The main gateway unit and its configuration file (unless PD-02 option (b) is approved).
- The root account's rootful Podman service.
- Any host configuration outside the realm account, its units, and the root login profile line in HC-09.
- Anything under the repository other than the files named in the phase plans.

## Verification of each change

Each phase plan lists the check for its host changes. The general checks:

- After HC-01 and HC-02: `podman --remote info` as the realm account reports `rootless` true, a 5.x version, and runtime `runc`.
- After HC-03: the unit is active, and the API socket accepts `podman --remote info`.
- After HC-05 and HC-06: the gateway configuration renders from `src/runtime/gateway-config.ts`, the key files and directories have the modes in PD-03, and the main gateway's configuration file and unit file have the same digests as before the build. Record the digests before the change.
- After HC-08: the image digest matches the value recorded in configuration.

## Order of operations for reverts

Revert in reverse order of application: HC-10, then HC-05 and HC-04 (units and their configuration), then HC-03, then HC-02, then HC-01. HC-06 and HC-08 are independent and can revert at any point. HC-07 and HC-11 are owner decisions, not part of the rollback of the build.
