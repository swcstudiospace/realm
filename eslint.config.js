import js from "@eslint/js";
import tseslint from "typescript-eslint";

// Type-aware rules apply to TypeScript sources only. JavaScript modules (scripts) use the untyped preset,
// because type-aware rules need a TypeScript project to answer their questions.
const typeCheckedTs = tseslint.configs.strictTypeChecked.map((config) => ({ ...config, files: ["**/*.ts"] }));
const untypedJs = tseslint.configs.strict.map((config) => ({ ...config, files: ["**/*.mjs", "**/*.js"] }));

// Architecture invariants over src/**/*.ts. These replace source-scanning tests (child_process allowlist,
// D-99 guarded symbols, D-88 file functions, spawn sites), so the checks run as lint rules.
const CHILD_PROCESS_PATHS = ["child_process", "node:child_process"];
const CHILD_PROCESS_ALLOWED = ["src/cli/main.ts", "src/doctor/checks.ts", "src/runtime/session-execution.ts"];
const GATE_MODULES = ["src/core/policy.ts", "src/core/states.ts", "src/core/errors.ts", "src/contract/validate.ts"];
const SPECIAL_SRC = [
  "src/tools/**/*.ts",
  "src/runtime/openshell.ts",
  "src/runtime/session-execution.ts",
  "src/fs/write.ts",
  "src/fs/read.ts",
  "src/fs/list.ts",
  "src/cli/main.ts",
  "src/doctor/checks.ts",
];
const SPAWN_MESSAGE = "P6-D1: spawn( is allowed only in src/runtime/session-execution.ts and src/cli/main.ts.";
const GUARD_OWNER = {
  buildExecArgv: "src/runtime/openshell.ts",
  lockedWrite: "src/fs/write.ts",
  readFileCapped: "src/fs/read.ts",
  listDir: "src/fs/list.ts",
  spawnOpenShellRunner: "src/runtime/session-execution.ts",
};
/** @param {keyof typeof GUARD_OWNER} name */
const guard = (name) => ({
  selector: `Identifier[name="${name}"]`,
  message: `D-99: ${name} may be referenced only in ${GUARD_OWNER[name]}, src/tools/, and the shared runtime modules.`,
});
/** @param {string} name */
const fileFunction = (name) => ({
  selector: `Identifier[name="${name}"]`,
  message: `D-88: under src/tools/ only src/tools/workspace.ts may reference ${name}.`,
});
const SYNTAX = {
  cpDynamic: {
    selector: 'ImportExpression[source.value=/^(node:)?child_process$/]',
    message: "TOOL-02: child_process is never loaded with import(); only allowlisted modules import it, by named static import.",
  },
  cpRequire: {
    selector: 'CallExpression[callee.name="require"] > Literal[value=/^(node:)?child_process$/]',
    message: "TOOL-02: child_process is never loaded with require().",
  },
  cpReexport: {
    selector: 'ExportNamedDeclaration[source.value=/^(node:)?child_process$/]',
    message: "TOOL-02: child_process is never re-exported; allowlisted modules keep it private.",
  },
  cpReexportAll: {
    selector: 'ExportAllDeclaration[source.value=/^(node:)?child_process$/]',
    message: "TOOL-02: child_process is never re-exported with export *.",
  },
  cpSideEffect: {
    selector: 'ImportDeclaration[source.value=/^(node:)?child_process$/]:not(:has(ImportSpecifier))',
    message: "TOOL-02: an allowlisted module imports child_process by name; a side-effect import is refused.",
  },
  cpDefault: {
    selector: 'ImportDeclaration[source.value=/^(node:)?child_process$/] > ImportDefaultSpecifier',
    message: "TOOL-02: an allowlisted module imports child_process by name; a default import is refused.",
  },
  cpNamespace: {
    selector: 'ImportDeclaration[source.value=/^(node:)?child_process$/] > ImportNamespaceSpecifier',
    message: "TOOL-02: an allowlisted module imports child_process by name; a namespace import is refused.",
  },
  spawnCall: { selector: 'CallExpression[callee.name="spawn"]', message: SPAWN_MESSAGE },
  spawnMember: { selector: 'CallExpression[callee.property.name="spawn"]', message: SPAWN_MESSAGE },
  openshellBinary: {
    selector: 'Identifier[name="OPENSHELL_BINARY"]',
    message: "D-99/C-5: OPENSHELL_BINARY may be referenced only in src/tools/, src/runtime/openshell.ts, src/runtime/session-execution.ts, and src/doctor/checks.ts.",
  },
  "guard:buildExecArgv": guard("buildExecArgv"),
  "guard:lockedWrite": guard("lockedWrite"),
  "guard:readFileCapped": guard("readFileCapped"),
  "guard:listDir": guard("listDir"),
  "guard:spawnOpenShellRunner": guard("spawnOpenShellRunner"),
  "fileFn:lockedWrite": fileFunction("lockedWrite"),
  "fileFn:readFileCapped": fileFunction("readFileCapped"),
  "fileFn:listDir": fileFunction("listDir"),
};
/** @typedef {keyof typeof SYNTAX} SyntaxKey */
/**
 * @param {readonly SyntaxKey[]} keys
 * @returns {["error", ...object[]]}
 */
const syntaxRule = (keys) => ["error", ...keys.map((key) => SYNTAX[key])];
/** @type {SyntaxKey[]} */
const DYNAMIC = ["cpDynamic", "cpRequire", "cpReexport", "cpReexportAll"];
/** @type {SyntaxKey[]} */
const NAMED_ONLY = ["cpSideEffect", "cpDefault", "cpNamespace"];
/** @type {SyntaxKey[]} */
const SPAWN = ["spawnCall", "spawnMember"];
/** @type {SyntaxKey[]} */
const GUARDS = ["guard:buildExecArgv", "guard:lockedWrite", "guard:readFileCapped", "guard:listDir", "guard:spawnOpenShellRunner"];
/** @type {SyntaxKey[]} */
const GENERIC = [...DYNAMIC, ...SPAWN, "openshellBinary", ...GUARDS];
/** @template {string} T @param {readonly T[]} keys @param {T} drop @returns {T[]} */
const withoutKey = (keys, drop) => keys.filter((key) => key !== drop);
const childProcessPaths = CHILD_PROCESS_PATHS.map((name) => ({
  name,
  message: "TOOL-02: only the allowlisted modules (src/cli/main.ts, src/doctor/checks.ts, src/runtime/session-execution.ts) import child_process.",
}));
// Dispatcher internals that host adapters (src/mcp, src/acp, src/omp) must never reference (P5-D11, P5-D12).
const ADAPTER_INTERNALS = [
  "ToolDispatcherDeps",
  "DispatcherController",
  "TOOL_CALL_TIMEOUT_MS",
  "runSandboxExec",
  "withTimeout",
  "appendAudit",
  "summarizeExec",
  "waitLeavingConnecting",
  "checkExecPolicy",
  "refuseRetryIn",
];
/** @param {string} name */
const adapterInternal = (name) => ({
  selector: `Identifier[name="${name}"]`,
  message: `Adapters route tool logic only through ToolDispatcher.call (P5-D11, P5-D12): ${name} is a dispatcher internal and must not be referenced from src/mcp, src/acp or src/omp.`,
});

export default tseslint.config(
  {
    ignores: ["dist/**", "coverage/**", "node_modules/**"],
  },
  js.configs.recommended,
  {
    // Release and check scripts are Node ESM; declare the Node globals they use.
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      globals: {
        console: "readonly",
        process: "readonly",
      },
    },
  },
  ...typeCheckedTs,
  ...untypedJs,
  {
    files: ["**/*.ts"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ["**/*.ts"],
    rules: {
      // QUAL-01: no silent catch blocks. Empty catch blocks are errors.
      "no-empty": ["error", { allowEmptyCatch: false }],
      // D-08: no suppression comments of any kind for TypeScript.
      "@typescript-eslint/ban-ts-comment": [
        "error",
        {
          "ts-expect-error": true,
          "ts-ignore": true,
          "ts-nocheck": true,
        },
      ],
    },
  },
  {
    files: ["src/**/*.ts"],
    ignores: SPECIAL_SRC,
    rules: { "no-restricted-syntax": syntaxRule(GENERIC) },
  },
  {
    files: ["src/tools/**/*.ts"],
    ignores: ["src/tools/workspace.ts"],
    rules: { "no-restricted-syntax": syntaxRule([...DYNAMIC, ...SPAWN, "fileFn:lockedWrite", "fileFn:readFileCapped", "fileFn:listDir"]) },
  },
  {
    files: ["src/tools/workspace.ts"],
    rules: { "no-restricted-syntax": syntaxRule([...DYNAMIC, ...SPAWN]) },
  },
  {
    files: ["src/runtime/openshell.ts"],
    rules: { "no-restricted-syntax": syntaxRule([...DYNAMIC, ...SPAWN]) },
  },
  {
    files: ["src/runtime/session-execution.ts"],
    rules: { "no-restricted-syntax": syntaxRule([...DYNAMIC, ...NAMED_ONLY]) },
  },
  {
    files: ["src/fs/write.ts"],
    rules: { "no-restricted-syntax": syntaxRule(withoutKey(GENERIC, "guard:lockedWrite")) },
  },
  {
    files: ["src/fs/read.ts"],
    rules: { "no-restricted-syntax": syntaxRule(withoutKey(GENERIC, "guard:readFileCapped")) },
  },
  {
    files: ["src/fs/list.ts"],
    rules: { "no-restricted-syntax": syntaxRule(withoutKey(GENERIC, "guard:listDir")) },
  },
  {
    files: ["src/cli/main.ts"],
    rules: { "no-restricted-syntax": syntaxRule([...DYNAMIC, ...NAMED_ONLY, "openshellBinary", ...GUARDS]) },
  },
  {
    files: ["src/doctor/checks.ts"],
    rules: { "no-restricted-syntax": syntaxRule([...DYNAMIC, ...NAMED_ONLY, ...SPAWN, ...GUARDS]) },
  },
  {
    files: ["src/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", { paths: childProcessPaths }],
    },
  },
  {
    files: CHILD_PROCESS_ALLOWED,
    rules: { "no-restricted-imports": "off" },
  },
  {
    files: GATE_MODULES,
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: childProcessPaths,
          patterns: [
            {
              group: ["../runtime/session-execution*", "../doctor/checks*", "../cli/main*"],
              message: "TOOL-02: exec gate modules must not import an allowlisted child_process module.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/**/*.ts"],
    rules: {
      "no-restricted-properties": [
        "error",
        {
          object: "process",
          property: "env",
          message: "process.env is read only at entry edges (src/cli/main.ts, src/daemon/main.ts, src/omp/extension.ts). Pass the value in as a parameter.",
        },
      ],
    },
  },
  {
    files: ["src/cli/main.ts", "src/daemon/main.ts", "src/omp/extension.ts"],
    rules: { "no-restricted-properties": "off" },
  },
  {
    files: ["src/mcp/**/*.ts", "src/acp/**/*.ts", "src/omp/**/*.ts"],
    rules: {
      "no-restricted-syntax": ["error", ...GENERIC.map((key) => SYNTAX[key]), ...ADAPTER_INTERNALS.map(adapterInternal)],
      "no-restricted-imports": ["error", { paths: childProcessPaths }],
    },
  },
  {
    files: ["src/omp/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: childProcessPaths,
          patterns: [
            {
              group: ["../daemon/*", "!../daemon/client.js", "!../daemon/channel.js", "!../daemon/ensure.js"],
              message: "Adapters route tool logic only through ToolDispatcher.call (P5-D11, P5-D12): Omp reaches the daemon only through DaemonClient, so only ../daemon/client, ../daemon/channel and ../daemon/ensure may be imported.",
            },
          ],
        },
      ],
    },
  },
);
