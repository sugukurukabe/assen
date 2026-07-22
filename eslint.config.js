// @ts-check
/**
 * ESLint 9 flat config。チームルール「anyの使用は禁止」を機械的に強制する
 * ESLint 9 flat config. Mechanically enforces the team rule "any is forbidden"
 * Flat config ESLint 9. Menegakkan aturan tim "any dilarang" secara mekanis
 */
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**", "src/apps/approval-ui/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
    },
  },
  {
    files: ["test/**/*.ts"],
    rules: {
      // テストではnullableアサーションで簡潔さを優先する / prioritize test brevity over strict null narrowing / prioritaskan keringkasan test daripada narrowing null yang ketat
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
);
