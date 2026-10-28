import { test } from "node:test";
import assert from "node:assert/strict";
import { attachKernelCaps, KERNEL_STATUS_FIELD, kernelStatusOf, liveCapabilityFailures } from "../../src/runtime/kernel-caps.js";
import type { LibpodInspect } from "../../src/runtime/libpod-client.js";

const FULL_STATUS = [
  "Name:\tsleep",
  "State:\tS (sleeping)",
  "Pid:\t4321",
  "CapInh:\t0000000000000000",
  "CapPrm:\t00000000a80425fb",
  "CapEff:\t00000000a80425fb",
  "CapBnd:\t00000000a80425fb",
  "CapAmb:\t0000000000000000",
  "NoNewPrivs:\t1",
].join("\n");

const ZERO_STATUS = [
  "Name:\tsleep",
  "CapInh:\t0000000000000000",
  "CapPrm:\t0000000000000000",
  "CapEff:\t0000000000000000",
  "CapBnd:\t0000000000000000",
  "CapAmb:\t0000000000000000",
].join("\n");

void test("capability sets are parsed from a /proc status text", () => {
  const inspect: LibpodInspect = { State: { Pid: 4321 } };
  const attached = attachKernelCaps(inspect, () => FULL_STATUS);
  assert.deepEqual(attached.KernelCaps, {
    CapInh: "0000000000000000",
    CapPrm: "00000000a80425fb",
    CapEff: "00000000a80425fb",
    CapBnd: "00000000a80425fb",
    CapAmb: "0000000000000000",
  });
});

void test("a missing capability set is left out, so the live proof refuses it (D-51)", () => {
  const withoutAmb = FULL_STATUS.split("\n")
    .filter((line) => !line.startsWith("CapAmb:"))
    .join("\n");
  const attached = attachKernelCaps({ State: { Pid: 4321 } }, () => withoutAmb);
  const caps = attached.KernelCaps as Readonly<Record<string, string>>;
  assert.equal(Object.hasOwn(caps, "CapAmb"), false);
  assert.equal(caps.CapInh, "0000000000000000");
});

void test("a zero-set sample reports every set as all zeros", () => {
  const attached = attachKernelCaps({ State: { Pid: 77 } }, () => ZERO_STATUS);
  assert.deepEqual(attached.KernelCaps, {
    CapInh: "0000000000000000",
    CapPrm: "0000000000000000",
    CapEff: "0000000000000000",
    CapBnd: "0000000000000000",
    CapAmb: "0000000000000000",
  });
});

void test("a live proof of an all-zero status passes with no failures (D-51)", () => {
  const attached = attachKernelCaps({ State: { Pid: 4321 } }, () => ZERO_STATUS);
  assert.deepEqual(liveCapabilityFailures(attached), []);
});

void test("a live proof of a status with any non-zero set refuses with cap-drop (D-51)", () => {
  const attached = attachKernelCaps({ State: { Pid: 4321 } }, () => FULL_STATUS);
  assert.deepEqual(liveCapabilityFailures(attached), ["cap-drop"]);
});

void test("a status that cannot be read refuses with cap-drop, and no set is attached (D-51)", () => {
  const inspect: LibpodInspect = { State: { Pid: 4321 } };
  const attached = attachKernelCaps(inspect, () => {
    throw new Error("ENOENT");
  });
  assert.equal(Object.hasOwn(attached, "KernelCaps"), false);
  assert.deepEqual(liveCapabilityFailures(attached), ["cap-drop"]);
});

void test("an inbound all-zero KernelCaps from the engine never passes the live proof (D-51)", () => {
  const inspect: LibpodInspect = {
    State: { Pid: 4321 },
    KernelCaps: { CapInh: "0000000000000000", CapPrm: "0000000000000000", CapEff: "0000000000000000", CapBnd: "0000000000000000", CapAmb: "0000000000000000" },
  };
  const attached = attachKernelCaps(inspect, () => {
    throw new Error("EACCES");
  });
  assert.deepEqual(liveCapabilityFailures(attached), ["cap-drop"]);
});

void test("an inbound all-zero KernelCaps is replaced by the host read, which decides the proof (D-51)", () => {
  const inspect: LibpodInspect = { State: { Pid: 4321 }, KernelCaps: { CapInh: "0000000000000000" } };
  assert.deepEqual(liveCapabilityFailures(attachKernelCaps(inspect, () => FULL_STATUS)), ["cap-drop"]);
  assert.deepEqual(liveCapabilityFailures(attachKernelCaps(inspect, () => ZERO_STATUS)), []);
});

void test("a missing or invalid pid never reads /proc and refuses with cap-drop (D-51)", () => {
  let reads = 0;
  const reader = (): string => {
    reads += 1;
    return ZERO_STATUS;
  };
  for (const inspect of [{}, { State: {} }, { State: { Pid: 0 } }, { State: { Pid: "4321" } }] as LibpodInspect[]) {
    assert.deepEqual(liveCapabilityFailures(attachKernelCaps(inspect, reader)), ["cap-drop"]);
  }
  assert.equal(reads, 0);
});

void test("the seccomp mode and the no_new_privs flag are parsed from the status, and the filter count line is not the mode (F5)", () => {
  const status = ["Name:\tinit", "NoNewPrivs:\t1", "Seccomp:\t2", "Seccomp_filters:\t3", "Speculation_Store_Bypass:\tthread force mitigated"].join("\n");
  assert.deepEqual(kernelStatusOf(status), { NoNewPrivs: "1", Seccomp: "2" });
  assert.deepEqual(kernelStatusOf("Seccomp_filters:\t3\nSeccomp:\tx\nNoNewPrivs:"), {});
  const attached = attachKernelCaps({ State: { Pid: 4321 } }, () => status);
  assert.deepEqual(attached[KERNEL_STATUS_FIELD], { NoNewPrivs: "1", Seccomp: "2" });
});

void test("an inbound KernelStatus from the engine is dropped, and a status that cannot be read attaches none (F5)", () => {
  const inspect: LibpodInspect = { State: { Pid: 4321 }, [KERNEL_STATUS_FIELD]: { Seccomp: "2", NoNewPrivs: "1" } };
  const attached = attachKernelCaps(inspect, () => {
    throw new Error("EACCES");
  });
  assert.equal(Object.hasOwn(attached, KERNEL_STATUS_FIELD), false);
  assert.deepEqual(attachKernelCaps(inspect, () => "Seccomp:\t0")[KERNEL_STATUS_FIELD], { Seccomp: "0" });
});

void test("a State that is not a plain object never supplies a pid, even when it carries a Pid property (F5)", () => {
  let reads = 0;
  const reader = (): string => {
    reads += 1;
    return ZERO_STATUS;
  };
  const states: readonly unknown[] = [Object.assign([], { Pid: 4321 }), "Pid", 4321, null, undefined, true];
  for (const state of states) {
    const attached = attachKernelCaps({ State: state }, reader);
    assert.equal(Object.hasOwn(attached, "KernelCaps"), false);
    assert.deepEqual(liveCapabilityFailures(attached), ["cap-drop"]);
  }
  assert.equal(reads, 0);
});
