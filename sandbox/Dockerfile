# sandbox/Dockerfile: builds the realm-helper native enforcement binary (phase 9.2).
#
# Build context: the repository root. Both bases are pinned by digest and were
# verified on the build host. No apt is used: the builder image carries the
# toolchain, and the runtime image carries only glibc, Node, and the helper.
#
# Stages:
#   builder   gcc 13.3.0 on bookworm. Verifies the source digest, then runs
#             make clean all check probe. Every gate runs here, so the image
#             build fails when a gate fails.
#   runtime   Node on bookworm slim, with the helper at /opt/realm/bin/realm-helper.
#             Runs as the unprivileged sandbox user (uid and gid 1001).

ARG GCC_BASE=docker.io/library/gcc@sha256:1d71f0f3450214bef38fe09e6f610fb6cca90cf97b43f4ce845bfc32a4168818
ARG NODE_BASE=docker.io/library/node@sha256:2dd9a4f758e173b65fee15388f7706af6fb01ef50cf7a2c0538711d67a6981ae

FROM ${GCC_BASE} AS builder
ARG SOURCE_SHA256
COPY sandbox/realm-helper /src/realm-helper
# Source digest: sha256 of the manifest made from sha256sum of each file,
# excluding build/, with the file list sorted under LC_ALL=C. The build fails
# when SOURCE_SHA256 is empty or does not match.
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

FROM ${NODE_BASE} AS runtime
ARG HELPER_SHA256
ARG SOURCE_SHA256
LABEL io.realm.helper.sha256="${HELPER_SHA256}" \
      io.realm.helper.source-sha256="${SOURCE_SHA256}"
# Unprivileged user for the workload. Its home is /workspace, which is the
# writable root. It has no login shell.
RUN set -eu; \
    groupadd --gid 1001 sandbox; \
    useradd --uid 1001 --gid 1001 --home-dir /workspace --no-create-home \
            --shell /usr/sbin/nologin sandbox; \
    install -d -o 1001 -g 1001 -m 0755 /workspace; \
    install -d -o root -g root -m 0755 /opt/realm/bin
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
USER sandbox
