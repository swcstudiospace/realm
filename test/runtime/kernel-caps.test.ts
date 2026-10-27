import { test } from "node:test";
import assert from "node:assert/strict";
import { attachKernelCaps, liveCapabilityFailures } from "../../src/runtime/kernel-caps.js";
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
