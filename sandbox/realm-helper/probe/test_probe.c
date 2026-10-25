/* test_probe.c: native tests for the probe's decision logic, driven by fake
 * observations through the seam. No container and no kernel control is needed. */
#define main probe_program_main
#include "probe.c"
#undef main

#include <errno.h>
#include <stdio.h>
#include <string.h>

static int failures;

#define CHECK(cond)                                                                       \
    do {                                                                                  \
        if (!(cond)) {                                                                    \
            fprintf(stderr, "test_probe: %s:%d: failed: %s\n", __FILE__, __LINE__, #cond); \
            failures++;                                                                   \
        }                                                                                 \
    } while (0)

#define PROBE_CHECK_COUNT 11

/* Filesystem and key seams. */
static int fake_tmp_eacces(void) {
    return EACCES;
}

static int fake_tmp_written(void) {
    return 0;
}

static int fake_workspace_ok(void) {
    return 0;
}

static int fake_workspace_denied(void) {
    return EACCES;
}

static int fake_keyctl_eperm(void) {
    return EPERM;
}

static int fake_keyctl_succeeded(void) {
    return 0;
}

/* Namespace and syscall seams. */
static int fake_unshare_eperm(void) {
    return EPERM;
}

static int fake_unshare_succeeded(void) {
    return 0;
}

static int fake_unshare_enosys(void) {
    return ENOSYS;
}

static int fake_clone_eperm(void) {
    return EPERM;
}

static int fake_clone_created(void) {
    return 0;
}

static int fake_x32_eperm(void) {
    return EPERM;
}

static int fake_x32_succeeded(void) {
    return 0;
}

static int fake_x32_enosys(void) {
    return ENOSYS;
}

/* Loader seams: 1 refused, 0 ran, -1 setup failed. */
static int fake_loader_refused(void) {
    return 1;
}

static int fake_loader_ran(void) {
    return 0;
}

static int fake_loader_setup_failed(void) {
    return -1;
}

/* Status fields. Each key is readable only in its expected base, so a probe
 * that parses in the wrong base fails the check. NoNewPrivs and Seccomp are
 * decimal, and CapEff, CapInh are hexadecimal. */
struct fake_status {
    unsigned long long nnp;
    unsigned long long seccomp;
    unsigned long long capeff;
    unsigned long long capinh;
};

static int status_field_for(const char *key, int base, unsigned long long *value,
                            const struct fake_status *f) {
    if (strcmp(key, "NoNewPrivs") == 0) {
        if (base != 10) {
            return -1;
        }
        *value = f->nnp;
        return 0;
    }
    if (strcmp(key, "Seccomp") == 0) {
        if (base != 10) {
            return -1;
        }
        *value = f->seccomp;
        return 0;
    }
    if (strcmp(key, "CapEff") == 0) {
        if (base != 16) {
            return -1;
        }
        *value = f->capeff;
        return 0;
    }
    if (strcmp(key, "CapInh") == 0) {
        if (base != 16) {
            return -1;
        }
        *value = f->capinh;
        return 0;
    }
    return -1;
}

/* A hardened process: NoNewPrivs 1, Seccomp mode 2, no effective or inheritable capabilities. */
static const struct fake_status hardened_status = {1, 2, 0, 0};

static int fake_status_hardened(const char *key, int base, unsigned long long *value) {
    return status_field_for(key, base, value, &hardened_status);
}

/* An unhardened process: no status controls, and effective caps set. */
static const struct fake_status control_status = {0, 0, 0x3fffffffffULL, 0x3fffffffffULL};

static int fake_status_control(const char *key, int base, unsigned long long *value) {
    return status_field_for(key, base, value, &control_status);
}

/* Effective caps set, inheritable clear. */
static const struct fake_status capeff_set_status = {1, 2, 0x0000000000000001ULL, 0};

static int fake_status_capeff_set(const char *key, int base, unsigned long long *value) {
    return status_field_for(key, base, value, &capeff_set_status);
}

/* Inheritable caps set, effective clear. */
static const struct fake_status capinh_set_status = {1, 2, 0, 0x0000000000000040ULL};

static int fake_status_capinh_set(const char *key, int base, unsigned long long *value) {
    return status_field_for(key, base, value, &capinh_set_status);
}

static int fake_status_missing(const char *key, int base, unsigned long long *value) {
    (void)key;
    (void)base;
    (void)value;
    return -1;
}

static const struct probe_seams hardened = {
    .tmp_write = fake_tmp_eacces,
    .workspace_write = fake_workspace_ok,
    .keyctl = fake_keyctl_eperm,
    .unshare_userns = fake_unshare_eperm,
    .clone_userns = fake_clone_eperm,
    .x32_syscall = fake_x32_eperm,
    .loader_workspace = fake_loader_refused,
    .status_field = fake_status_hardened,
};

/* Runs the probe against seams and captures its output. Returns the failure count. */
static int run_with(const struct probe_seams *s, char *buf, size_t cap) {
    FILE *out = tmpfile();
    size_t got;
    int n;

    CHECK(out != NULL);
    if (out == NULL) {
        buf[0] = '\0';
        return -1;
    }
    n = probe_run(s, out);
    rewind(out);
    got = fread(buf, 1, cap - 1, out);
    buf[got] = '\0';
    fclose(out);
    return n;
}

static int count_lines(const char *buf) {
    int lines = 0;

    for (const char *p = buf; *p != '\0'; p++) {
        if (*p == '\n') {
            lines++;
        }
    }
    return lines;
}

static void test_decisions(void) {
    CHECK(decide_tmp_denied(EACCES) == 1);
    CHECK(decide_tmp_denied(0) == 0);
    CHECK(decide_tmp_denied(EPERM) == 0);

    CHECK(decide_write_ok(0) == 1);
    CHECK(decide_write_ok(EACCES) == 0);

    CHECK(decide_eperm(EPERM) == 1);
    CHECK(decide_eperm(0) == 0);
    CHECK(decide_eperm(EACCES) == 0);
    CHECK(decide_eperm(ENOSYS) == 0);

    CHECK(decide_loader_refused(1) == 1);
    CHECK(decide_loader_refused(0) == 0);
    CHECK(decide_loader_refused(-1) == 0);

    CHECK(decide_equal(0, 0) == 1);
    CHECK(decide_equal(1, 1) == 1);
    CHECK(decide_equal(0, 1) == 0);
    CHECK(decide_equal(0x3fffffffffULL, 0) == 0);
}

static void test_all_checks_pass_when_hardened(void) {
    char buf[2048];
    int n = run_with(&hardened, buf, sizeof buf);

    CHECK(n == 0);
    CHECK(count_lines(buf) == PROBE_CHECK_COUNT);
    CHECK(strstr(buf, "TMP_WRITE_EACCES=PASS") != NULL);
    CHECK(strstr(buf, "WORKSPACE_WRITE_OK=PASS") != NULL);
    CHECK(strstr(buf, "KEYCTL_EPERM=PASS") != NULL);
    CHECK(strstr(buf, "NO_NEW_PRIVS_1=PASS") != NULL);
    CHECK(strstr(buf, "SECCOMP_2=PASS") != NULL);
    CHECK(strstr(buf, "UNSHARE_USERNS_EPERM=PASS") != NULL);
    CHECK(strstr(buf, "CLONE_USERNS_EPERM=PASS") != NULL);
    CHECK(strstr(buf, "X32_EPERM=PASS") != NULL);
    CHECK(strstr(buf, "CAPEFF_ZERO=PASS") != NULL);
    CHECK(strstr(buf, "CAPINH_ZERO=PASS") != NULL);
    CHECK(strstr(buf, "LOADER_WORKSPACE_REFUSED=PASS") != NULL);
}

static void test_tmp_writable_fails_tmp_check(void) {
    char buf[2048];
    struct probe_seams s = hardened;
    int n;

    s.tmp_write = fake_tmp_written;
    n = run_with(&s, buf, sizeof buf);
    CHECK(n == 1);
    CHECK(strstr(buf, "TMP_WRITE_EACCES=FAIL") != NULL);
    CHECK(strstr(buf, "WORKSPACE_WRITE_OK=PASS") != NULL);
}

static void test_workspace_denied_fails_workspace_check(void) {
    char buf[2048];
    struct probe_seams s = hardened;
    int n;

    s.workspace_write = fake_workspace_denied;
    n = run_with(&s, buf, sizeof buf);
    CHECK(n == 1);
    CHECK(strstr(buf, "WORKSPACE_WRITE_OK=FAIL") != NULL);
}

static void test_keyctl_allowed_fails_keyctl_check(void) {
    char buf[2048];
    struct probe_seams s = hardened;
    int n;

    s.keyctl = fake_keyctl_succeeded;
    n = run_with(&s, buf, sizeof buf);
    CHECK(n == 1);
    CHECK(strstr(buf, "KEYCTL_EPERM=FAIL") != NULL);
}

static void test_unshare_userns_check(void) {
    char buf[2048];
    struct probe_seams s = hardened;
    int n;

    /* Succeeded: the namespace was created. */
    s.unshare_userns = fake_unshare_succeeded;
    n = run_with(&s, buf, sizeof buf);
    CHECK(n == 1);
    CHECK(strstr(buf, "UNSHARE_USERNS_EPERM=FAIL") != NULL);

    /* Failed with ENOSYS, not EPERM: the check requires EPERM specifically. */
    s.unshare_userns = fake_unshare_enosys;
    n = run_with(&s, buf, sizeof buf);
    CHECK(n == 1);
    CHECK(strstr(buf, "UNSHARE_USERNS_EPERM=FAIL") != NULL);
}

static void test_clone_userns_check(void) {
    char buf[2048];
    struct probe_seams s = hardened;
    int n;

    /* A created child is a failure, whatever else happened. */
    s.clone_userns = fake_clone_created;
    n = run_with(&s, buf, sizeof buf);
    CHECK(n == 1);
    CHECK(strstr(buf, "CLONE_USERNS_EPERM=FAIL") != NULL);
}

static void test_x32_check(void) {
    char buf[2048];
    struct probe_seams s = hardened;
    int n;

    s.x32_syscall = fake_x32_succeeded;
    n = run_with(&s, buf, sizeof buf);
    CHECK(n == 1);
    CHECK(strstr(buf, "X32_EPERM=FAIL") != NULL);

    /* No x32 ABI at all reports ENOSYS: not the EPERM the denylist gives. */
    s.x32_syscall = fake_x32_enosys;
    n = run_with(&s, buf, sizeof buf);
    CHECK(n == 1);
    CHECK(strstr(buf, "X32_EPERM=FAIL") != NULL);
}

static void test_capeff_check(void) {
    char buf[2048];
    struct probe_seams s = hardened;
    int n;

    /* CapEff with one bit set fails. The fake returns the value only in base 16. */
    s.status_field = fake_status_capeff_set;
    n = run_with(&s, buf, sizeof buf);
    CHECK(n == 1);
    CHECK(strstr(buf, "CAPEFF_ZERO=FAIL") != NULL);
    CHECK(strstr(buf, "NO_NEW_PRIVS_1=PASS") != NULL);
    CHECK(strstr(buf, "CAPINH_ZERO=PASS") != NULL);
}

static void test_capinh_check(void) {
    char buf[2048];
    struct probe_seams s = hardened;
    int n;

    /* CapInh with a bit set fails; CapEff and the other checks still pass. */
    s.status_field = fake_status_capinh_set;
    n = run_with(&s, buf, sizeof buf);
    CHECK(n == 1);
    CHECK(strstr(buf, "CAPINH_ZERO=FAIL") != NULL);
    CHECK(strstr(buf, "CAPEFF_ZERO=PASS") != NULL);
    CHECK(strstr(buf, "NO_NEW_PRIVS_1=PASS") != NULL);
}

static void test_loader_check(void) {
    char buf[2048];
    struct probe_seams s = hardened;
    int n;

    /* The loader ran the workspace binary: not refused, so the check fails. */
    s.loader_workspace = fake_loader_ran;
    n = run_with(&s, buf, sizeof buf);
    CHECK(n == 1);
    CHECK(strstr(buf, "LOADER_WORKSPACE_REFUSED=FAIL") != NULL);

    /* The loader could not be run at all: the probe cannot claim a refusal. */
    s.loader_workspace = fake_loader_setup_failed;
    n = run_with(&s, buf, sizeof buf);
    CHECK(n == 1);
    CHECK(strstr(buf, "LOADER_WORKSPACE_REFUSED=FAIL") != NULL);
}

static void test_unreadable_status_fails_status_checks(void) {
    char buf[2048];
    struct probe_seams s = hardened;
    int n;

    s.status_field = fake_status_missing;
    n = run_with(&s, buf, sizeof buf);
    CHECK(n == 4);
    CHECK(strstr(buf, "NO_NEW_PRIVS_1=FAIL") != NULL);
    CHECK(strstr(buf, "SECCOMP_2=FAIL") != NULL);
    CHECK(strstr(buf, "CAPEFF_ZERO=FAIL") != NULL);
    CHECK(strstr(buf, "CAPINH_ZERO=FAIL") != NULL);
}

static void test_control_run_without_helper(void) {
    /* Without the helper, every control is absent: /tmp is writable, keyctl,
     * user namespaces, clone, and x32 all succeed, the loader runs the
     * workspace binary, and the status fields show no hardening. Only the
     * workspace write passes. */
    char buf[2048];
    struct probe_seams control = {
        .tmp_write = fake_tmp_written,
        .workspace_write = fake_workspace_ok,
        .keyctl = fake_keyctl_succeeded,
        .unshare_userns = fake_unshare_succeeded,
        .clone_userns = fake_clone_created,
        .x32_syscall = fake_x32_succeeded,
        .loader_workspace = fake_loader_ran,
        .status_field = fake_status_control,
    };
    int n = run_with(&control, buf, sizeof buf);

    CHECK(n == 10);
    CHECK(count_lines(buf) == PROBE_CHECK_COUNT);
    CHECK(strstr(buf, "TMP_WRITE_EACCES=FAIL") != NULL);
    CHECK(strstr(buf, "WORKSPACE_WRITE_OK=PASS") != NULL);
    CHECK(strstr(buf, "CAPEFF_ZERO=FAIL") != NULL);
    CHECK(strstr(buf, "CAPINH_ZERO=FAIL") != NULL);
}

int main(void) {
    test_decisions();
    test_all_checks_pass_when_hardened();
    test_tmp_writable_fails_tmp_check();
    test_workspace_denied_fails_workspace_check();
    test_keyctl_allowed_fails_keyctl_check();
    test_unshare_userns_check();
    test_clone_userns_check();
    test_x32_check();
    test_capeff_check();
    test_capinh_check();
    test_loader_check();
    test_unreadable_status_fails_status_checks();
    test_control_run_without_helper();

    if (failures != 0) {
        fprintf(stderr, "test_probe: %d failure(s)\n", failures);
        return 1;
    }
    puts("test_probe: all checks passed");
    return 0;
}
