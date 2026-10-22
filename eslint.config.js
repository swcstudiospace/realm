import js from "@eslint/js";
import tseslint from "typescript-eslint";

// Type-aware rules apply to TypeScript sources only. JavaScript modules (scripts) use the untyped preset,
// because type-aware rules need a TypeScript project to answer their questions.
const typeCheckedTs = tseslint.configs.strictTypeChecked.map((config) => ({ ...config, files: ["**/*.ts"] }));
const untypedJs = tseslint.configs.strict.map((config) => ({ ...config, files: ["**/*.mjs", "**/*.js"] }));

export default tseslint.config(
  {
    ignores: ["dist/**", "coverage/**", "node_modules/**"],
  },
  js.configs.recommended,
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
);
