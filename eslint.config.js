import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist/**", "coverage/**", "node_modules/**"],
  },
  js.configs.recommended,
  tseslint.configs.strict,
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
