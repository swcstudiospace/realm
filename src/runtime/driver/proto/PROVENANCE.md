# Vendored OpenShell compute driver protos

These files are copied unmodified from the NVIDIA OpenShell repository. They define the `openshell.compute.v1.ComputeDriver`
service that the realm compute driver implements (`src/runtime/driver/compute-driver.ts`).

- Upstream: https://github.com/NVIDIA/OpenShell
- Revision: `c4688aa8715ea75d6c39fe468361dbbc16c691fa` (feat(helm): add certificate hook pod labels and annotations, 2026-10-24)
- Matching release: tag `v0.1.5` names the same bytes for every vendored file. The OpenShell 0.1.5 CLI on the host is the build that
  produced the admission acknowledgement in `src/runtime/driver/admission.ts`.
- Licence: Apache-2.0 (SPDX headers are kept in each file).
- Status: upstream marks these protos EXPERIMENTAL; they may change incompatibly. Re-vendor from the revision above, update the
  digests here, and re-run the proto tests when the pin moves.

## Files and SHA-256 digests

| File | Package | SHA-256 |
| --- | --- | --- |
| `compute_driver.proto` | `openshell.compute.v1` | `71b17ad7e220641133bb134a34e65c238be99f97f2ef0262b549767ddd2502be` |
| `datamodel.proto` | `openshell.datamodel.v1` | `e50bd875a760f54b80269c65ee47984cae424fb623b7f59551ba62550c23e70b` |
| `extension.proto` | `openshell.extension.v1` | `60f28ee9dc846d41152f4db7e82a439c78d024786efaceb464900d1d1ad129ad` |
| `options.proto` | `openshell.options.v1` | `b0e03562c92777978f6f3e0f46260cdb82f1d88d1c1837eab0e53cdd0f195eb7` |
| `sandbox.proto` | `openshell.sandbox.v1` | `93536b8fa5c1e253d0d3aef031fde273b1bd13ce819192b0a7727fa9f28d55fb` |

## Import closure

`compute_driver.proto` imports `extension.proto`, `options.proto` and `sandbox.proto`. `sandbox.proto` imports `datamodel.proto`,
which imports `options.proto`. Those five files are the whole closure of the compute driver service.

The Google well-known imports (`google/protobuf/struct.proto`, `timestamp.proto`, `duration.proto`, `descriptor.proto`) are not
vendored. `@grpc/proto-loader` resolves them through its protobuf library at load time. A test loads the service with the pinned
loader to confirm this.

The isolation backend and sandbox protocol protos (`isolation_backend.proto`, `sandbox_protocol.proto`) are not vendored here.
They belong to phase 9.5.
