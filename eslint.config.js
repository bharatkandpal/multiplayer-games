import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/coverage/**",
      "**/playwright-report/**",
      "**/test-results/**",
      // Agent-managed git worktrees (`Agent` tool's `isolation: "worktree"`,
      // or a manual `EnterWorktree`) live inside the repo tree and carry
      // their own tsconfig — left unignored, ESLint's TS project service
      // sees two candidate tsconfigRootDirs and refuses to parse anything
      // ("multiple candidate TSConfigRootDirs"), breaking `pnpm lint`
      // repo-wide for everyone until the worktree is cleaned up.
      ".claude/worktrees/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
    },
  },
  {
    // TypeScript's compiler already resolves globals/identifiers, so ESLint's
    // no-undef would produce false positives on TS files (e.g. Node globals).
    files: ["**/*.{ts,tsx}"],
    rules: {
      "no-undef": "off",
      // Allow intentionally-unused identifiers when prefixed with `_`
      // (e.g. interface params a given implementation doesn't need).
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
  // Keep ESLint out of formatting's lane; Prettier owns style.
  prettier,
);
