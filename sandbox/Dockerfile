# sandbox/Dockerfile: builds the realm-helper native enforcement binary (phase 9.2)
# and the OpenShell sandbox runtime that the driver starts (phase 9.5).
#
# Build context: the repository root. All bases are pinned by digest and were
# verified on the build host. The helper is built from the repository. The runtime
# is built from the upstream OpenShell source at the commit named by OPENSHELL_REVISION.
# The runtime image carries only glibc, Node, the helper, the runtime binary, and the
# AgentOS runner and probe, and it has no network at run time. The runner and probe are
# copied from dist/src/runtime/, and the resolver file from sandbox/resolv.conf, so run
# `npm run build` at the repository root before the image build.
#
# Build-time network use: the runtime-builder stage installs git and cmake from the
# Debian bookworm archive with apt, fetches the OpenShell source from
# https://github.com/NVIDIA/OpenShell at one commit, and downloads the crates named by
# that source's Cargo.lock from crates.io. The runtime stage's npm ci downloads npm
# packages as before. No stage copies host files or secrets: the builder stages take
# only sandbox/realm-helper and the fetched source.
#
# Stages:
#   builder           gcc 13.3.0 on bookworm. Verifies the source digest, then runs
#                     make clean all check probe. Every gate runs here, so the image
#                     build fails when a gate fails.
#   runtime-builder   Rust 1.95.0 on bookworm. Fetches OpenShell at OPENSHELL_REVISION and
#                     fails unless HEAD is that commit. Builds openshell-sandbox with
#                     --locked --release. Fails unless its glibc needs are at most
#                     GLIBC_2.36 and its shared libraries are the glibc set, libgcc_s.so.1,
#                     and ld-linux-x86-64.so.2.
#   runtime           Node on bookworm slim, with the helper at /opt/realm/bin/realm-helper,
#                     the runtime at /usr/local/lib/realm/openshell-sandbox, and the AgentOS
#                     runner and probe with the library under /usr/local/lib/realm.
#                     Runs as the unprivileged sandbox user (uid and gid 1001).
#
# Build arguments that must be supplied:
#   SOURCE_SHA256, HELPER_SHA256   realm-helper digests (see the builder and runtime stages).
#   RUNTIME_SHA256                 sha256 of the openshell-sandbox binary. The runtime-builder
#                                  stage prints it in the build log. Build that stage once
#                                  with --target runtime-builder to read it, then pass it.
#   OPENSHELL_REVISION             optional. Defaults to the pinned commit. It must be a full
#                                  40-character commit id; every stage takes the same value.

ARG GCC_BASE=docker.io/library/gcc@sha256:1d71f0f3450214bef38fe09e6f610fb6cca90cf97b43f4ce845bfc32a4168818
ARG RUST_BASE=docker.io/library/rust@sha256:6258907abe69656e41cd992e0b705cdcfabcbbe3db374f92ed2d47121282d4a1
ARG NODE_BASE=docker.io/library/node@sha256:2dd9a4f758e173b65fee15388f7706af6fb01ef50cf7a2c0538711d67a6981ae
# Pinned upstream commit: tag v0.1.5 (bdb956f2cd65a635f1294fccf1d138d263bf650f).
ARG OPENSHELL_REVISION=bdb956f2cd65a635f1294fccf1d138d263bf650f

FROM ${GCC_BASE} AS builder
ARG SOURCE_SHA256
COPY sandbox/realm-helper /src/realm-helper
# Source digest rule. Inputs: every regular file under sandbox/realm-helper except
# the top-level build/ directory. Each path is printed by find as ./<path>, sorted
# under LC_ALL=C, and sha256sum writes one line per file into the manifest. The
# digest is sha256 of that manifest. SOURCE_SHA256 must equal it, or the build fails.
RUN set -eu; \
    if [ -z "${SOURCE_SHA256}" ]; then \
        echo "realm-helper: SOURCE_SHA256 build arg is required" >&2; \
        exit 1; \
    fi; \
    export LC_ALL=C; \
    cd /src/realm-helper; \
    find . -path ./build -prune -o -type f -print | sort > /tmp/source-files.lst; \
    : > /tmp/source-manifest; \
    while IFS= read -r f; do \
        sha256sum "$f" >> /tmp/source-manifest; \
    done < /tmp/source-files.lst; \
    actual="$(sha256sum /tmp/source-manifest | cut -d' ' -f1)"; \
    if [ "$actual" != "${SOURCE_SHA256}" ]; then \
        echo "realm-helper: source digest mismatch: got $actual" >&2; \
        exit 1; \
    fi; \
    rm -f /tmp/source-files.lst /tmp/source-manifest
RUN make -C /src/realm-helper clean all check probe

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
RUN set -eu; \
    apt-get update; \
    apt-get install -y --no-install-recommends ca-certificates cmake git; \
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
# Build. The source's own Cargo.lock is used, and --locked makes cargo fail if it
# would change. The sha256 of the binary is printed for RUNTIME_SHA256.
RUN set -eu; \
    cd /src/openshell; \
    cargo build --locked --release -p openshell-sandbox; \
    sha256sum target/release/openshell-sandbox
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

FROM ${NODE_BASE} AS runtime
ARG HELPER_SHA256
ARG SOURCE_SHA256
ARG RUNTIME_SHA256
ARG OPENSHELL_REVISION
LABEL io.realm.helper.sha256="${HELPER_SHA256}" \
      io.realm.helper.source-sha256="${SOURCE_SHA256}" \
      io.realm.runtime.sha256="${RUNTIME_SHA256}" \
      io.realm.runtime.revision="${OPENSHELL_REVISION}"
# Unprivileged user for the workload. Its home is /workspace, which is the
# writable root. It has no login shell.
RUN set -eu; \
    groupadd --gid 1001 sandbox; \
    useradd --uid 1001 --gid 1001 --home-dir /workspace --no-create-home \
            --shell /usr/sbin/nologin sandbox; \
    install -d -o 1001 -g 1001 -m 0755 /workspace; \
    install -d -o root -g root -m 0755 /opt/realm/bin /usr/local/lib/realm
COPY --from=builder /src/realm-helper/build/realm-helper /opt/realm/bin/realm-helper
# Fail closed: both digests must be supplied, and the binary must match HELPER_SHA256.
RUN set -eu; \
    if [ -z "${HELPER_SHA256}" ]; then \
        echo "realm-helper: HELPER_SHA256 build arg is required" >&2; \
        exit 1; \
    fi; \
    if [ -z "${SOURCE_SHA256}" ]; then \
        echo "realm-helper: SOURCE_SHA256 build arg is required" >&2; \
        exit 1; \
    fi; \
    chmod 0755 /opt/realm/bin/realm-helper; \
    printf '%s  %s\n' "${HELPER_SHA256}" /opt/realm/bin/realm-helper | sha256sum -c -
# The runtime is root-owned and executable by the sandbox user. The label
# io.realm.runtime.sha256 names the digest the runtime-builder stage printed.
COPY --from=runtime-builder --chown=0:0 --chmod=0555 \
     /src/openshell/target/release/openshell-sandbox /usr/local/lib/realm/openshell-sandbox
# Fail closed: RUNTIME_SHA256 must be supplied and must match the copied binary. Then
# ldd must resolve every shared library in this image. ldd only traces the loader on
# the binary built above, so it does not run the program. A GLIBC version that this
# image's glibc lacks is also reported as a "not found" line, so the check covers the
# runtime's glibc as well as its libraries.
RUN set -eu; \
    if [ -z "${RUNTIME_SHA256}" ]; then \
        echo "openshell-sandbox: RUNTIME_SHA256 build arg is required" >&2; \
        exit 1; \
    fi; \
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
# context must be the repository root and must contain both manifests, sandbox/resolv.conf,
# plus dist/src/runtime/agentos-runner.js and dist/src/runtime/agentos-probe.js (compiled output).
WORKDIR /usr/local/lib/realm
COPY package.json package-lock.json /usr/local/lib/realm/
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund \
 && npm cache clean --force
COPY dist/src/runtime/agentos-runner.js dist/src/runtime/agentos-probe.js /usr/local/lib/realm/
# Sandbox resolver. The workload has no network, and the runtime's DNS relay at
# 127.0.0.53:53 mediates every name lookup, so the resolver file names only that relay.
# The image's own file named public resolvers, which names never resolved through. The
# file is copied after the last RUN because a build RUN step has its own resolv.conf,
# and it is root-owned and read-only, so the image digest covers it. The libpod create
# request sets use_image_resolve_conf so the container uses this file in every network mode.
COPY --chown=0:0 --chmod=0444 sandbox/resolv.conf /etc/resolv.conf
USER sandbox
WORKDIR /workspace
