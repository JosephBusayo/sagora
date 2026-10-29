import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import tseslint from "typescript-eslint";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Type-aware rules, switched on for the move to an asynchronous database.
  //
  // The compiler catches a missing `await` wherever the value is used. It does NOT catch the
  // dangerous case: `if (bookingFor(id))` is always true, because a Promise is an object. These
  // three rules do, and they are the reason the conversion can be trusted.
  {
    files: ["src/**/*.ts", "src/**/*.tsx", "scripts/**/*.ts", "scripts/**/*.mts", "e2e/**/*.ts"],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    plugins: { "@typescript-eslint": tseslint.plugin },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/await-thenable": "error",
    },
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
