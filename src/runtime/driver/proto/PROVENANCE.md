# Vendored OpenShell protos

These files are copied unmodified from the NVIDIA OpenShell repository. The first five define the `openshell.compute.v1.ComputeDriver`
service that the realm compute driver implements (`src/runtime/driver/compute-driver.ts`). The last two define the isolation backend
and sandbox protocol services that the realm isolation backend serves (`src/runtime/driver/isolation/backend.ts`, phase 9.5).

- Upstream: https://github.com/NVIDIA/OpenShell
- Revision of the first five files: `c4688aa8715ea75d6c39fe468361dbbc16c691fa` (feat(helm): add certificate hook pod labels and annotations, 2026-10-24)
- Revision of `isolation_backend.proto` and `sandbox_protocol.proto`: tag `v0.1.5`, commit `bdb956f2cd65a635f1294fccf1d138d263bf650f`.
  All five files of the first revision match the bytes of that tag, so the two revisions name the same content for them.
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
| `isolation_backend.proto` | `openshell.sandbox.backend.v1` | `4938978098965ebc170aff0e7ab2bc17eb25a6f35ef41625cdd4e1e91b0d2cd6` |
| `sandbox_protocol.proto` | `openshell.sandbox.protocol.v1` | `2846eca0c499a77df2591e693fcbaf5cb89dbaac35da189d6192425128eabfb9` |

## Import closure

`compute_driver.proto` imports `extension.proto`, `options.proto` and `sandbox.proto`. `sandbox.proto` imports `datamodel.proto`,
which imports `options.proto`. Those five files are the whole closure of the compute driver service.

`isolation_backend.proto` imports `extension.proto` and `options.proto`, both vendored above. `sandbox_protocol.proto` imports
`options.proto` and the Google well-known `google/protobuf/duration.proto` and `google/protobuf/timestamp.proto`. Those seven files
are the whole closure of the two isolation services.

The Google well-known imports (`google/protobuf/struct.proto`, `timestamp.proto`, `duration.proto`, `descriptor.proto`) are not
vendored. `@grpc/proto-loader` resolves them through its protobuf library at load time. The tests load each service with the pinned
loader to confirm this.
