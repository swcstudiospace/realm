# sandbox/Dockerfile: builds the OpenShell sandbox runtime that the driver starts
# (phase 9.5).
#
# Build context: the repository root. All bases are pinned by digest and were
# verified on the build host. The runtime is built from the upstream OpenShell source
# at the commit named by OPENSHELL_REVISION.
# The runtime image carries only glibc, Node, the runtime binary, and the
# AgentOS runner and probe, and it has no network at run time. The runner and probe are
# compiled from source by the agentos-builder stage, and the resolver file is copied from
# sandbox/resolv.conf. No host build step is needed first.
#
# Build-time network use: the runtime-builder stage installs cmake from the Debian
# bookworm archive with apt, fetches the OpenShell source from
# https://github.com/NVIDIA/OpenShell at one commit, and downloads the crates named by
# that source's Cargo.lock from crates.io. The agentos-builder and runtime stages' npm ci
# download npm packages. No stage copies compiled output, secrets or other host files:
# .dockerignore admits only the manifests, tsconfig files, the two AgentOS source files
# and sandbox/resolv.conf.
#
# Stages:
#   runtime-builder   Rust 1.95.0 on bookworm. Fetches OpenShell at OPENSHELL_REVISION and
#                     fails unless HEAD is that commit. Fails unless every Cargo.lock source
#                     is the crates.io registry. Builds openshell-sandbox with
#                     --locked --release. Fails unless its glibc needs are at most
#                     GLIBC_2.36 and its shared libraries are the glibc set, libgcc_s.so.1,
#                     and ld-linux-x86-64.so.2.
#   agentos-builder   Node on bookworm slim. Installs the locked dependencies with
#                     npm ci --ignore-scripts and compiles the AgentOS runner and probe
#                     with tsconfig.agentos.json. Prints the sha256 of both outputs.
#   runtime           Node on bookworm slim, with the runtime at
#                     /usr/local/lib/realm/openshell-sandbox, and the AgentOS
#                     runner and probe with the library under /usr/local/lib/realm.
#                     Runs as the unprivileged sandbox user (uid and gid 1001). Fails
#                     unless the four digest build arguments below match its contents.
#
# Build arguments:
#   RUNTIME_SHA256                 required. sha256 of the openshell-sandbox binary. The
#                                  runtime-builder stage prints it in the build log. Build
#                                  that stage once with --target runtime-builder to read it,
#                                  then pass it.
#   CARGO_LOCK_SHA256              required. sha256 of the upstream Cargo.lock, printed by
#                                  the runtime-builder lockfile gate.
#   AGENTOS_RUNNER_SHA256          required. sha256 of the compiled agentos-runner.js,
#   AGENTOS_PROBE_SHA256           required. and of agentos-probe.js, printed by the
#                                  agentos-builder stage (--target agentos-builder).
#   OPENSHELL_REVISION             optional. Defaults to the pinned commit. It must be a full
#                                  40-character commit id; every stage takes the same value.
#   OPENSHELL_TAG                  optional. Only labels the image (io.realm.openshell.tag).
#                                  Defaults to the tag of the pinned commit.
#
# sandbox/expected-digests.json records the digests of the last verified build, and
# npm run check:image-digests compares a built image or directory with it.

ARG RUST_BASE=docker.io/library/rust@sha256:6258907abe69656e41cd992e0b705cdcfabcbbe3db374f92ed2d47121282d4a1
# Node v24.22.1 on Debian 12 (bookworm slim), linux/amd64 single-platform manifest digest,
# pinned 2026-10-25 (commit 497b63f). The index digest was not recorded.
ARG NODE_BASE=docker.io/library/node@sha256:2dd9a4f758e173b65fee15388f7706af6fb01ef50cf7a2c0538711d67a6981ae
# Pinned upstream commit: tag v0.1.5 (bdb956f2cd65a635f1294fccf1d138d263bf650f). The commit
# id was verified against the tag object with `git ls-remote https://github.com/NVIDIA/OpenShell`
# (the peeled refs/tags/v0.1.5^{} entry).
ARG OPENSHELL_REVISION=bdb956f2cd65a635f1294fccf1d138d263bf650f
# The release tag of that commit; it is only the io.realm.openshell.tag label.
ARG OPENSHELL_TAG=v0.1.5

# runtime-builder: the OpenShell sandbox runtime (package openshell-sandbox, from
# workspace crate crates/openshell-sandbox).
#
# Base digest: docker.io/library/rust:1.95.0-bookworm. Resolved on 2026-10-26 with
# `docker buildx imagetools inspect docker.io/library/rust:1.95.0-bookworm`, which
# reports the OCI image index sha256:6258907abe69656e41cd992e0b705cdcfabcbbe3db374f92ed2d47121282d4a1.
# The 1.95-bookworm tag reports the same index digest. Its linux/amd64 child is
# sha256:4c2fd73ef19c5ef9d54bee03b06b2839a392604fbfcd578ed948b71b37c1d7fb. The toolchain
# is 1.95.0, the channel named by the upstream rust-toolchain.toml at the pinned commit.
# The base is bookworm, glibc 2.36, so a binary that needs a newer glibc cannot link here.
FROM ${RUST_BASE} AS runtime-builder
ARG OPENSHELL_REVISION
# Select the installed 1.95.0 toolchain by name. rustup then ignores the upstream
# rust-toolchain.toml, so it does not download the components that file lists
# (rustfmt, rust-src, rust-analyzer). The build needs only rustc, cargo and std.
ENV RUSTUP_TOOLCHAIN=1.95.0
# git and ca-certificates come from the pinned base image (git 1:2.39.5-0+deb12u3,
# ca-certificates 20230311+deb12u1), so only cmake is installed. cmake is pinned to the
# version the base's bookworm archive offers; its own dependencies still float inside
# that archive. Pinning them fully needs a snapshot.debian.org URL for the apt sources.
RUN set -eu; \
    apt-get update; \
    apt-get install -y --no-install-recommends cmake=3.25.1-1; \
    rm -rf /var/lib/apt/lists/*
# Revision gate: fetch exactly one commit at depth 1, check it out detached, and fail
# unless HEAD equals OPENSHELL_REVISION. The upstream rust-toolchain.toml channel must
# match the toolchain in this image. The .git directory is removed afterwards, so the
# build sees the same tree that a Docker build of the upstream repository sees.
RUN set -eu; \
    if ! printf '%s' "${OPENSHELL_REVISION}" | grep -Eq '^[0-9a-f]{40}$'; then \
        echo "openshell-sandbox: OPENSHELL_REVISION must be a full 40-character commit id" >&2; \
        exit 1; \
    fi; \
    git init -q /src/openshell; \
    cd /src/openshell; \
    git remote add origin https://github.com/NVIDIA/OpenShell; \
    git fetch -q --depth 1 origin "${OPENSHELL_REVISION}"; \
    git checkout -q --detach FETCH_HEAD; \
    actual="$(git rev-parse HEAD)"; \
    if [ "$actual" != "${OPENSHELL_REVISION}" ]; then \
        echo "openshell-sandbox: HEAD $actual does not match OPENSHELL_REVISION" >&2; \
        exit 1; \
    fi; \
    channel="$(sed -n 's/^channel = "\(.*\)"$/\1/p' rust-toolchain.toml)"; \
    if [ "$channel" != "1.95.0" ]; then \
        echo "openshell-sandbox: upstream toolchain is $channel, the image has 1.95.0" >&2; \
        exit 1; \
    fi; \
    rustc --version | grep -q '^rustc 1\.95\.0 '; \
    rm -rf .git
# Lockfile gate. The build must resolve every crate from the crates.io registry. A
# `source = "git+` entry in Cargo.lock would fetch a crate from an unpinned git remote,
# so the build fails if one exists. The sha256 of Cargo.lock is printed for
# CARGO_LOCK_SHA256.
RUN set -eu; \
    lock=/src/openshell/Cargo.lock; \
    if [ ! -f "$lock" ]; then \
        echo "openshell-sandbox: Cargo.lock is missing from the fetched source" >&2; \
        exit 1; \
    fi; \
    if grep -q '^source = "git+' "$lock"; then \
        echo "openshell-sandbox: Cargo.lock names a git source, which this build does not allow:" >&2; \
        grep '^source = "git+' "$lock" | sort -u >&2; \
        exit 1; \
    fi; \
    sha256sum "$lock"
# Build. The source's own Cargo.lock is used, and --locked makes cargo fail if it
# would change. The sha256 of the binary is printed for RUNTIME_SHA256.
RUN set -eu; \
    cd /src/openshell; \
    cargo build --locked --release -p openshell-sandbox; \
    sha256sum target/release/openshell-sandbox
# Registry-only gate. The lockfile gate above rejects git sources only. After the build, this
# step fails unless every `source =` line of Cargo.lock is exactly the crates.io registry
# source, so a path, sparse, alternate-registry or other source cannot pass. It is a
# separate step after the build so that the cached compile layer stays valid. The
# distinct offending values are printed.
RUN set -eu; \
    lock=/src/openshell/Cargo.lock; \
    allowed='source = "registry+https://github.com/rust-lang/crates.io-index"'; \
    offending="$(grep '^source = ' "$lock" | grep -vxF "$allowed" | sort -u || true)"; \
    if [ -n "$offending" ]; then \
        echo "openshell-sandbox: Cargo.lock names a source other than the crates.io registry:" >&2; \
        printf '%s\n' "$offending" >&2; \
        exit 1; \
    fi
# glibc gate. The binary must not need any GLIBC version newer than GLIBC_2.36, the
# glibc in this bookworm base. The highest version found is printed.
RUN set -eu; \
    bin=/src/openshell/target/release/openshell-sandbox; \
    readelf -W --version-info "$bin" > /tmp/runtime-versions.txt; \
    max="$(grep -o 'GLIBC_[0-9][0-9.]*' /tmp/runtime-versions.txt | sed 's/^GLIBC_//' | sort -uV | tail -n 1)"; \
    if [ -z "$max" ]; then \
        echo "openshell-sandbox: no GLIBC version needs found, the glibc gate cannot run" >&2; \
        exit 1; \
    fi; \
    echo "openshell-sandbox: highest GLIBC version needed: $max"; \
    if [ "$(printf '%s\n' "$max" 2.36 | sort -V | tail -n 1)" != "2.36" ]; then \
        echo "openshell-sandbox: needs GLIBC_$max, newer than GLIBC_2.36" >&2; \
        exit 1; \
    fi; \
    rm -f /tmp/runtime-versions.txt
# Dependency gate. The binary may need only the glibc set, libgcc_s.so.1, and the dynamic
# loader's own soname ld-linux-x86-64.so.2, and its program interpreter must be the x86-64
# glibc loader. The needed libraries are printed.
RUN set -eu; \
    bin=/src/openshell/target/release/openshell-sandbox; \
    interp="$(readelf -W -l "$bin" | sed -n 's/.*Requesting program interpreter: \(.*\)]/\1/p')"; \
    if [ "$interp" != "/lib64/ld-linux-x86-64.so.2" ]; then \
        echo "openshell-sandbox: unexpected program interpreter: $interp" >&2; \
        exit 1; \
    fi; \
    readelf -W -d "$bin" | sed -n 's/.*Shared library: \[\(.*\)\]$/\1/p' | sort -u > /tmp/runtime-needed.txt; \
    echo "openshell-sandbox: shared libraries needed: $(tr '\n' ' ' < /tmp/runtime-needed.txt)"; \
    unexpected=""; \
    while IFS= read -r lib; do \
        case "$lib" in \
            libc.so.6|libm.so.6|libdl.so.2|libpthread.so.0|librt.so.1|libresolv.so.2|libutil.so.1|libgcc_s.so.1|ld-linux-x86-64.so.2) ;; \
            *) unexpected="$unexpected $lib" ;; \
        esac; \
    done < /tmp/runtime-needed.txt; \
    if [ -n "$unexpected" ]; then \
        echo "openshell-sandbox: shared libraries outside the allowed set:$unexpected" >&2; \
        exit 1; \
    fi; \
    rm -f /tmp/runtime-needed.txt

# agentos-builder: compiles the AgentOS runner and probe from the repository's own source
# inside the build, so the image never takes compiled output from the host's dist
# directory. Only the manifests, tsconfig files and the two source files enter this stage
# (see .dockerignore). npm ci installs from package-lock.json, so the library types come
# from the locked version, and --ignore-scripts runs no package script. The sha256 of
# each output is printed for AGENTOS_RUNNER_SHA256 and AGENTOS_PROBE_SHA256.
FROM ${NODE_BASE} AS agentos-builder
WORKDIR /build
COPY package.json package-lock.json tsconfig.json tsconfig.agentos.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY src/runtime/agentos-runner.ts src/runtime/agentos-probe.ts src/runtime/
RUN set -eu; \
    ./node_modules/.bin/tsc -p tsconfig.agentos.json; \
    sha256sum dist/src/runtime/agentos-runner.js dist/src/runtime/agentos-probe.js

FROM ${NODE_BASE} AS runtime
ARG RUNTIME_SHA256
ARG CARGO_LOCK_SHA256
ARG AGENTOS_RUNNER_SHA256
ARG AGENTOS_PROBE_SHA256
ARG OPENSHELL_REVISION
ARG OPENSHELL_TAG
# Provenance labels. The image is built by this repository from the upstream OpenShell
# source, so the org.opencontainers.image labels describe the realm repository only
# (title and source). The upstream commit and tag are the io.realm.openshell labels,
# because naming them in image.revision or image.version would make a provenance tool
# attribute the realm repository to the upstream commit. image.licenses is not set: the
# image holds the AGPL realm code and the upstream OpenShell runtime, which have different
# licenses. The three io.realm digests are build arguments that the gates below
# verify against the real files, so a label never names a digest the image does not hold.
# sandbox/expected-digests.json records the same values for npm run check:image-digests.
LABEL org.opencontainers.image.title="realm-sandbox-runtime" \
      org.opencontainers.image.source="https://github.com/swcstudiospace/realm" \
      io.realm.openshell.revision="${OPENSHELL_REVISION}" \
      io.realm.openshell.tag="${OPENSHELL_TAG}" \
      io.realm.runtime.sha256="${RUNTIME_SHA256}" \
      io.realm.runtime.revision="${OPENSHELL_REVISION}" \
      io.realm.cargo-lock.sha256="${CARGO_LOCK_SHA256}" \
      io.realm.agentos.runner.sha256="${AGENTOS_RUNNER_SHA256}" \
      io.realm.agentos.probe.sha256="${AGENTOS_PROBE_SHA256}"
# Unprivileged user for the workload. Its home is /workspace, which is the
# writable root. It has no login shell.
RUN set -eu; \
    groupadd --gid 1001 sandbox; \
    useradd --uid 1001 --gid 1001 --home-dir /workspace --no-create-home \
            --shell /usr/sbin/nologin sandbox; \
    install -d -o 1001 -g 1001 -m 0755 /workspace; \
    install -d -o root -g root -m 0755 /usr/local/lib/realm
# The runtime is root-owned and executable by the sandbox user. The label
# io.realm.runtime.sha256 names the digest the runtime-builder stage printed.
COPY --from=runtime-builder --chown=0:0 --chmod=0555 \
     /src/openshell/target/release/openshell-sandbox /usr/local/lib/realm/openshell-sandbox
# Fail closed: RUNTIME_SHA256 must be supplied as a sha256 hex digest and must match the
# copied binary. Then
# ldd must resolve every shared library in this image. ldd only traces the loader on
# the binary built above, so it does not run the program. A GLIBC version that this
# image's glibc lacks is also reported as a "not found" line, so the check covers the
# runtime's glibc as well as its libraries.
RUN set -eu; \
    for name in RUNTIME_SHA256; do \
        eval "value=\${$name}"; \
        if ! printf '%s' "$value" | grep -Eq '^[0-9a-f]{64}$'; then \
            echo "openshell-sandbox: $name build arg is required and must be a sha256 hex digest" >&2; \
            exit 1; \
        fi; \
    done; \
    printf '%s  %s\n' "${RUNTIME_SHA256}" /usr/local/lib/realm/openshell-sandbox | sha256sum -c -; \
    ldd /usr/local/lib/realm/openshell-sandbox > /tmp/runtime-ldd.txt 2>&1 \
        || { cat /tmp/runtime-ldd.txt >&2; exit 1; }; \
    if grep -q 'not found' /tmp/runtime-ldd.txt; then \
        cat /tmp/runtime-ldd.txt >&2; \
        echo "openshell-sandbox: a shared library or GLIBC version is missing from the runtime image" >&2; \
        exit 1; \
    fi; \
    rm -f /tmp/runtime-ldd.txt
# AgentOS workload. The runner and probe sit under /usr because Landlock denies
# execution elsewhere, and the library sits beside them so Node resolves it from the
# file's own directory. The base is glibc: the library's sidecar ships only glibc
# builds, so an Alpine (musl) base cannot load it. The library tree is installed from
# the repository-root package.json and package-lock.json with npm ci, so the build
# context must be the repository root and must contain both manifests and
# sandbox/resolv.conf. The runner and probe are compiled by the agentos-builder stage,
# not taken from the host, so the host's dist directory never reaches the image.
WORKDIR /usr/local/lib/realm
COPY package.json package-lock.json /usr/local/lib/realm/
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund \
 && npm cache clean --force
COPY --from=agentos-builder /build/dist/src/runtime/agentos-runner.js /build/dist/src/runtime/agentos-probe.js /usr/local/lib/realm/
# Fail closed: each supplied digest must be set and must match the file or lock that the
# image was built from. The Cargo.lock is read from the runtime-builder stage through a
# bind mount, so it is not stored in any layer of this image.
RUN --mount=type=bind,from=runtime-builder,source=/src/openshell/Cargo.lock,target=/tmp/Cargo.lock \
    set -eu; \
    for name in CARGO_LOCK_SHA256 AGENTOS_RUNNER_SHA256 AGENTOS_PROBE_SHA256; do \
        eval "value=\${$name}"; \
        if ! printf '%s' "$value" | grep -Eq '^[0-9a-f]{64}$'; then \
            echo "openshell-sandbox: $name build arg is required and must be a sha256 hex digest" >&2; \
            exit 1; \
        fi; \
    done; \
    printf '%s  %s\n' "${CARGO_LOCK_SHA256}" /tmp/Cargo.lock | sha256sum -c -; \
    printf '%s  %s\n' "${AGENTOS_RUNNER_SHA256}" /usr/local/lib/realm/agentos-runner.js | sha256sum -c -; \
    printf '%s  %s\n' "${AGENTOS_PROBE_SHA256}" /usr/local/lib/realm/agentos-probe.js | sha256sum -c -
# Sandbox resolver. The workload has no network, and the runtime's DNS relay at
# 127.0.0.53:53 mediates every name lookup, so the resolver file names only that relay.
# The image's own file named public resolvers, which names never resolved through. The
# file is copied after the last RUN because a build RUN step has its own resolv.conf,
# and it is root-owned and read-only, so the image digest covers it. The libpod create
# request sets use_image_resolve_conf so the container uses this file in every network mode.
COPY --chown=0:0 --chmod=0444 sandbox/resolv.conf /etc/resolv.conf
USER sandbox
WORKDIR /workspace
