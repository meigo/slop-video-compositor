import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import svelte from "eslint-plugin-svelte";
import svelteConfig from "./svelte.config.js";
import globals from "globals";
import prettier from "eslint-config-prettier";
import betterTailwind from "eslint-plugin-better-tailwindcss";

// Mirrors slop-audio-editor/eslint.config.js so the family lints the same way.
export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  ...svelte.configs.recommended,
  {
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      "no-constant-condition": "warn",
      "prefer-const": ["warn", { destructuring: "all" }],
    },
  },
  {
    files: ["**/*.svelte", "**/*.svelte.ts", "**/*.svelte.js"],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
        extraFileExtensions: [".svelte"],
        svelteConfig,
      },
    },
  },
  {
    rules: {
      // svelte-check owns compiler + a11y diagnostics.
      "svelte/valid-compile": "off",
      // Drag gestures and the preview canvas write element geometry directly on purpose.
      "svelte/no-dom-manipulating": "off",
      // Pre-existing svelte-ignore directives; may be obsolete with newer svelte versions.
      "svelte/no-unused-svelte-ignore": "warn",
      // Pre-existing code uses Map/Set; Svelte 5 runes not yet applied.
      "svelte/prefer-svelte-reactivity": "warn",
      // Pre-existing code patterns; out of scope for style-alignment task.
      "svelte/require-each-key": "warn",
      // Pre-existing regex in exportName.ts; out of scope for style-alignment task.
      "no-control-regex": "warn",
      // Pre-existing error handling pattern in tauri.ts; out of scope for style-alignment task.
      "preserve-caught-error": "warn",
    },
  },
  {
    files: ["**/*.svelte"],
    rules: {
      "prefer-const": "off",
      "svelte/prefer-const": ["warn", { destructuring: "all" }],
    },
  },
  prettier,
  ...svelte.configs.prettier,
  {
    files: ["**/*.test.ts"],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    // Only the conflict/duplicate rules: two classes fighting over one property is decided by
    // Tailwind's emit order, not by the markup, and reads as a control that silently does nothing.
    files: ["**/*.svelte", "**/*.html"],
    plugins: { "better-tailwindcss": betterTailwind },
    settings: {
      "better-tailwindcss": { entryPoint: "src/app.css" },
    },
    rules: {
      "better-tailwindcss/no-conflicting-classes": "error",
      "better-tailwindcss/no-duplicate-classes": "warn",
      "better-tailwindcss/enforce-canonical-classes": "warn",
      "better-tailwindcss/no-unnecessary-whitespace": "warn",
    },
  },
  {
    ignores: ["build/", ".svelte-kit/", "src-tauri/", "src/app.html"],
  },
);
