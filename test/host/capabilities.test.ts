import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validate, type Policy } from "../../src/contract/validate.js";
import {
  HOST_CAPABILITIES,
  integrationCeiling,
  isWithinCeiling,
  resolveCapabilities,
} from "../../src/host/capabilities.js";
import type { HostCapabilityRequest } from "../../src/host/types.js";

function policy(over: Partial<Policy> = {}): Policy {
  const base = validate("policy", {});
  assert.ok(base.ok);
  return Object.freeze({ ...base.value, ...over });
}

const req = (capability: HostCapabilityRequest["capability"], scope?: string): HostCapabilityRequest =>
  scope === undefined ? { capability } : { capability, scope };

function code(request: HostCapabilityRequest, p: Policy): string | null {
  const r = resolveCapabilities([request], p);
  return r.denied[0]?.code ?? null;
}

void test("catalog and ceilings", () => {
  assert.deepEqual([...HOST_CAPABILITIES], [
    "daemon.attach", "fs.read", "fs.write", "fs.list", "exec.argv", "exec.shell", "net.egress", "credential.read", "host.tools.restrict",
  ]);
  assert.deepEqual([...integrationCeiling("mcp-config")], ["daemon.attach", "fs.read", "fs.write", "fs.list", "exec.argv", "exec.shell"]);
  assert.deepEqual([...integrationCeiling("extension")], [...HOST_CAPABILITIES]);
  assert.equal(isWithinCeiling("mcp-config", req("net.egress", "a:1")), false);
  assert.equal(isWithinCeiling("extension", req("net.egress", "a:1")), true);
});

void test("daemon.attach and exec.argv are granted under every policy", () => {
  for (const p of [policy(), policy({ mode: "fail-closed" })]) {
    assert.equal(code(req("daemon.attach"), p), null);
    assert.equal(code(req("exec.argv"), p), null);
  }
});

void test("fs capabilities need workspace roots", () => {
  for (const c of ["fs.read", "fs.write", "fs.list"] as const) {
    assert.equal(code(req(c), policy({ workspaceRoots: [] })), "POLICY_DENIED");
    assert.equal(code(req(c), policy({ workspaceRoots: ["/w"] })), null);
  }
});

void test("exec.shell needs shellEnabled", () => {
  assert.equal(code(req("exec.shell"), policy({ shellEnabled: false })), "SHELL_NOT_ALLOWED");
  assert.equal(code(req("exec.shell"), policy({ shellEnabled: true })), null);
});

void test("net.egress needs an exact host:port rule", () => {
  const p = policy({ egressAllow: [{ host: "api.example.com", port: 443 }] });
  assert.equal(code(req("net.egress", "api.example.com:443"), p), null);
  assert.equal(code(req("net.egress", "api.example.com:80"), p), "EGRESS_DENIED");
  assert.equal(code(req("net.egress", "example.com:443"), p), "EGRESS_DENIED");
  assert.equal(code(req("net.egress", "*.example.com:443"), p), "EGRESS_DENIED");
  assert.equal(code(req("net.egress"), p), "SCHEMA_INVALID");
  assert.equal(code(req("net.egress", "nohostport"), p), "SCHEMA_INVALID");
  assert.equal(code(req("net.egress", "h:0"), p), "SCHEMA_INVALID");
  assert.equal(code(req("net.egress", "h:70000"), p), "SCHEMA_INVALID");
});

void test("credential.read needs an exact allowed pattern", () => {
  const p = policy({ credentialAllow: ["~/.netrc"] });
  assert.equal(code(req("credential.read", "~/.netrc"), p), null);
  assert.equal(code(req("credential.read", "~/.*"), p), "CREDENTIAL_PATH_DENIED");
  assert.equal(code(req("credential.read", ""), p), "SCHEMA_INVALID");
  assert.equal(code(req("credential.read"), p), "SCHEMA_INVALID");
});

void test("host.tools.restrict needs fail-closed mode", () => {
  assert.equal(code(req("host.tools.restrict"), policy({ mode: "advisory" })), "POLICY_DENIED");
  assert.equal(code(req("host.tools.restrict"), policy({ mode: "fail-closed" })), null);
});

void test("a scope on a scope-less capability is SCHEMA_INVALID", () => {
  assert.equal(code(req("fs.read", "/x"), policy({ workspaceRoots: ["/w"] })), "SCHEMA_INVALID");
  assert.equal(code(req("daemon.attach", "x"), policy()), "SCHEMA_INVALID");
});

void test("results preserve request order", () => {
  const r = resolveCapabilities([req("exec.shell"), req("daemon.attach"), req("fs.read"), req("exec.argv")], policy());
  assert.deepEqual(r.granted.map((x) => x.capability), ["daemon.attach", "exec.argv"]);
  assert.deepEqual(r.denied.map((x) => x.request.capability), ["exec.shell", "fs.read"]);
});

void test("intersection grid: nothing is granted that the policy does not admit; policy is never mutated", () => {
  const policies: Policy[] = [
    policy(),
    policy({ shellEnabled: true }),
    policy({ workspaceRoots: ["/w"] }),
    policy({ egressAllow: [{ host: "h", port: 1 }] }),
    policy({ credentialAllow: ["p"] }),
    policy({ mode: "advisory" }),
    policy({ mode: "fail-closed" }),
  ];
  const requests: HostCapabilityRequest[] = [
    ...HOST_CAPABILITIES.map((c) => req(c)),
    req("net.egress", "h:1"), req("net.egress", "x:2"), req("credential.read", "p"), req("credential.read", "q"),
  ];
  for (const p of policies) {
    const before = JSON.stringify(p);
    const r = resolveCapabilities(requests, p);
    assert.equal(JSON.stringify(p), before);
    assert.equal(r.granted.length + r.denied.length, requests.length);
    for (const g of r.granted) {
      switch (g.capability) {
        case "fs.read": case "fs.write": case "fs.list": assert.ok(p.workspaceRoots.length > 0); break;
        case "exec.shell": assert.ok(p.shellEnabled); break;
        case "host.tools.restrict": assert.equal(p.mode, "fail-closed"); break;
        case "net.egress": assert.ok(p.egressAllow.some((e) => `${e.host}:${String(e.port)}` === g.scope)); break;
        case "credential.read": assert.ok(p.credentialAllow.includes(g.scope as string)); break;
        default: break;
      }
    }
  }
});

void test("no second enforcement path in src/host/capabilities.ts", () => {
  const source = readFileSync(new URL("../../../src/host/capabilities.ts", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  for (const forbidden of ["checkExecPolicy", "decideMutation", "isCredentialAllowed", "appendAudit", "withTimeout", "node:child_process", "process.env"]) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
});
