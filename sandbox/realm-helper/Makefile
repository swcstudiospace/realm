# realm-helper: native enforcement helper (phase 9.2, PRD-ENF-01/02/03).
#
#   make all     static build/realm-helper
#   make check   native tests (policy, PID 1 idle loop, probe decisions)
#   make probe   static build/probe, the in-container check (built in the image's test stage)
#   make clean   remove build/
#
# Every output goes under build/. Flags are fixed: they are part of the helper digest.

CC := gcc
CFLAGS := -std=gnu11 -O2 -Wall -Wextra -Werror
LDFLAGS := -static
BUILD := build

HELPER_SRC := realm-helper.c realm_policy.c realm_idle.c
HELPER_HDR := realm_policy.h realm_idle.h

.PHONY: all check probe clean

all: $(BUILD)/realm-helper

check: $(BUILD)/test_policy $(BUILD)/test_idle $(BUILD)/test_probe
	$(BUILD)/test_policy
	$(BUILD)/test_idle
	$(BUILD)/test_probe

probe: $(BUILD)/probe

$(BUILD)/realm-helper: $(HELPER_SRC) $(HELPER_HDR) | $(BUILD)
	$(CC) $(CFLAGS) $(LDFLAGS) -o $@ $(HELPER_SRC)

$(BUILD)/test_policy: test/test_policy.c realm_policy.c realm_policy.h | $(BUILD)
	$(CC) $(CFLAGS) $(LDFLAGS) -o $@ test/test_policy.c realm_policy.c

$(BUILD)/test_idle: test/test_idle.c realm_idle.c realm_idle.h | $(BUILD)
	$(CC) $(CFLAGS) $(LDFLAGS) -o $@ test/test_idle.c realm_idle.c

$(BUILD)/test_probe: probe/test_probe.c probe/probe.c | $(BUILD)
	$(CC) $(CFLAGS) $(LDFLAGS) -o $@ probe/test_probe.c

$(BUILD)/probe: probe/probe.c | $(BUILD)
	$(CC) $(CFLAGS) $(LDFLAGS) -o $@ probe/probe.c

$(BUILD):
	mkdir -p $@

clean:
	rm -rf $(BUILD)
