// Flat config, ESLint 9. typescript-eslint across all three workspaces;
// react-hooks + react-refresh added only for apps/web, which is the only
// workspace with React. No stylistic rules — Prettier is not in this repo,
// and that is a separate decision the owner has not made.
//
// The type-checked rule sets (parserOptions.project per tsconfig) are not
// used here: `no-unsafe-*` alone fires 160+ times on `any` from unparsed
// fetch/JSON response bodies, and the rest of the type-aware rules add
// another ~40 findings across files this change has no reason to touch. A
// pass fixing those belongs to whoever decides to type the I/O boundary,
// not to adding the lint job itself.
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";

export default tseslint.config(
  { ignores: ["**/dist/**"] },
  {
    files: [
      "packages/shared/src/**/*.ts",
      "apps/server/src/**/*.ts",
      "apps/web/src/**/*.{ts,tsx}",
    ],
    extends: [...tseslint.configs.recommended],
  },
  {
    files: ["apps/web/src/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks, "react-refresh": reactRefresh },
    rules: {
      ...reactHooks.configs["recommended-latest"].rules,
      ...reactRefresh.configs.vite.rules,
      // Firing this at error severity would require splitting non-component
      // exports (a handful of small helpers/constants) into their own files
      // across several components — a refactor, not a lint-job addition.
      "react-refresh/only-export-components": "warn",
    },
  },
);
