import js from "@eslint/js";
import nextPlugin from "@next/eslint-plugin-next";
import prettierConfig from "eslint-config-prettier";
import { createTypeScriptImportResolver } from "eslint-import-resolver-typescript";
import importX from "eslint-plugin-import-x";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

/**
 * One configuration for the whole workspace. Flat config already scopes rules by path, so
 * eleven copies of the same setup would only be eleven things to keep in sync.
 *
 * Formatting is not enforced here: Prettier owns it, and `eslint-config-prettier` switches
 * off every stylistic rule that would fight with it. What lives here is the part a formatter
 * cannot check, above all the module boundaries that `docs/specifications/engineering-conventions.md`
 * describes and that nothing was enforcing.
 */

const workspaceLayers = {
  /** The domain is the innermost layer: it must depend on nothing of ours. */
  domain: ["@control-hub/*"],
  /** Use cases may know the domain. Adapters such as the database client are not theirs to import. */
  application: [
    "@control-hub/application",
    "@control-hub/database",
    "@control-hub/config",
    "@control-hub/observability",
    "@control-hub/contracts",
    "@control-hub/i18n",
    "@control-hub/ui"
  ],
  /**
   * A connector may know the domain and nothing else of ours. Everything it needs to reach the
   * outside arrives as a port, which is what keeps a defective connector unable to cross a
   * tenant boundary: there is no adapter in scope to cross it with.
   */
  connectors: [
    "@control-hub/application",
    "@control-hub/config",
    "@control-hub/contracts",
    "@control-hub/database",
    "@control-hub/i18n",
    "@control-hub/observability",
    "@control-hub/persistence",
    "@control-hub/ui"
  ],
  /** Everything else in packages/ is a leaf: shared plumbing with no workspace dependencies. */
  leaf: ["@control-hub/*"]
};

const restrict = (patterns, message) => ({
  "no-restricted-imports": ["error", { patterns: patterns.map((group) => ({ group: [group], message })) }]
});

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
      // The output of `pnpm dev:verify`, which builds into its own directory so a second dev
      // server can run beside the first. Generated code, same as `.next`.
      "**/.next-verify/**",
      // Agent workspaces use a dedicated output directory for the same isolation reason.
      "**/.next-agent/**",
      // Another checkout of this repository, living inside it. Its files belong to whatever branch
      // that worktree has, so linting them here reports problems about code that is not this tree's.
      ".claude/worktrees/**",
      "**/.turbo/**",
      "**/coverage/**",
      "test-results/**",
      "playwright-report/**",
      "apps/web/next-env.d.ts",
      "stitch_avant_business_ecosystem/**"
    ]
  },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  importX.flatConfigs.recommended,

  {
    languageOptions: {
      parserOptions: {
        // `allowDefaultProject` covers the few files that sit outside a package tsconfig, so they
        // are still linted rather than silently skipped. It accepts at most eight of them: the
        // Playwright suite outgrew that and now has its own tsconfig, which the project service
        // finds on its own. Keep this list short for the same reason.
        projectService: {
          allowDefaultProject: ["*.mjs", "*.config.ts", "scripts/*.mjs"]
        },
        tsconfigRootDir: import.meta.dirname
      }
    },
    settings: {
      "import-x/resolver-next": [
        createTypeScriptImportResolver({
          alwaysTryTypes: true,
          project: ["tsconfig.base.json", "apps/*/tsconfig.json", "packages/*/tsconfig.json"]
        })
      ]
    },
    rules: {
      // TypeScript already resolves identifiers; the core rule only produces false positives here.
      "no-undef": "off",
      "no-console": ["error", { allow: ["warn", "error"] }],
      eqeqeq: ["error", "always", { null: "ignore" }],
      "no-var": "error",
      "prefer-const": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" }
      ],
      "import-x/order": [
        "error",
        {
          groups: ["builtin", "external", "internal", "parent", "sibling", "index"],
          pathGroups: [{ pattern: "@control-hub/**", group: "internal", position: "before" }],
          "newlines-between": "never",
          alphabetize: { order: "asc", caseInsensitive: true }
        }
      ],
      "import-x/no-duplicates": "error",
      "import-x/no-cycle": "error"
    }
  },

  {
    files: ["packages/domain/**/*.ts"],
    rules: restrict(workspaceLayers.domain, "The domain layer must not depend on any other workspace package.")
  },
  {
    files: ["packages/application/**/*.ts"],
    rules: restrict(
      workspaceLayers.application,
      "Use cases may only import @control-hub/domain; adapters belong outside this layer."
    )
  },
  {
    files: ["packages/connectors/**/*.ts"],
    rules: restrict(
      workspaceLayers.connectors,
      "A connector may only import @control-hub/domain: everything else it needs arrives as a port."
    )
  },
  {
    files: ["packages/{config,contracts,database,i18n,observability,ui}/**/*.ts"],
    rules: restrict(workspaceLayers.leaf, "Shared packages are leaves and must not depend on other workspace packages.")
  },
  {
    files: ["packages/**/*.ts"],
    rules: restrict(["**/apps/**"], "Packages must never import from an application.")
  },

  {
    files: ["apps/web/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks, "@next/next": nextPlugin },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs["core-web-vitals"].rules
    }
  },

  {
    // Tests reach into fixtures and assert on loosely typed payloads; the type-aware rules
    // about `any` produce noise there without catching anything a reader would care about.
    files: ["**/*.test.ts", "**/*.test.tsx", "tests/**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      // Vitest spies are passed around as bare references on purpose.
      "@typescript-eslint/unbound-method": "off"
    }
  },

  {
    // Operator commands: their whole job is to print progress to whoever ran them.
    files: [
      "apps/api/src/bootstrap.ts",
      "apps/api/src/seed-dev.ts",
      "apps/api/src/seed-e2e.ts",
      "packages/database/src/reset-e2e.ts",
      "scripts/**"
    ],
    rules: { "no-console": "off" }
  },

  {
    files: ["**/*.mjs", "*.config.ts", "**/*.config.ts", "scripts/**"],
    ...tseslint.configs.disableTypeChecked
  },

  prettierConfig
);
