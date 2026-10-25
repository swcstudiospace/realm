import { test } from "node:test";
import assert from "node:assert/strict";
import { attachKernelCaps } from "../../src/runtime/kernel-caps.js";
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

void test("a missing capability set is left out, so the cap-drop check fails closed on it", () => {
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

void test("a status that cannot be read attaches no capability sets", () => {
  const inspect: LibpodInspect = { State: { Pid: 4321 } };
  const attached = attachKernelCaps(inspect, () => {
    throw new Error("ENOENT");
  });
  assert.deepEqual(attached, { State: { Pid: 4321 } });
  assert.equal(Object.hasOwn(attached, "KernelCaps"), false);
});

void test("an inbound KernelCaps from the engine is dropped when the read throws", () => {
  const inspect: LibpodInspect = {
    State: { Pid: 4321 },
    KernelCaps: {
      CapInh: "0000000000000000",
      CapPrm: "0000000000000000",
      CapEff: "0000000000000000",
      CapBnd: "0000000000000000",
      CapAmb: "0000000000000000",
    },
  };
  const attached = attachKernelCaps(inspect, () => {
    throw new Error("EACCES");
  });
  assert.equal(Object.hasOwn(attached, "KernelCaps"), false);
  assert.deepEqual(attached, { State: { Pid: 4321 } });
});

void test("an inbound KernelCaps from the engine is replaced by the host read, never kept", () => {
  const inspect: LibpodInspect = { State: { Pid: 4321 }, KernelCaps: { CapInh: "ffffffffffffffff" } };
  const attached = attachKernelCaps(inspect, () => FULL_STATUS);
  assert.equal((attached.KernelCaps as Readonly<Record<string, string>>).CapInh, "0000000000000000");
});

void test("a missing or invalid pid attaches no capability sets and never reads /proc", () => {
  let reads = 0;
  const reader = (): string => {
    reads += 1;
    return FULL_STATUS;
  };
  for (const inspect of [{}, { State: {} }, { State: { Pid: 0 } }, { State: { Pid: "4321" } }] as LibpodInspect[]) {
    const attached = attachKernelCaps(inspect, reader);
    assert.equal(Object.hasOwn(attached, "KernelCaps"), false);
  }
  assert.equal(reads, 0);
});
