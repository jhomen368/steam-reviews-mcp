import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-plugin-prettier";
import eslintConfigPrettier from "eslint-config-prettier";

export default [
  // Ignore patterns
  {
    ignores: ["build/**", "node_modules/**", "**/*.js"],
  },
  // Base JavaScript recommended config
  js.configs.recommended,
  // TypeScript configs
  ...tseslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  // Prettier config (turns off conflicting rules)
  eslintConfigPrettier,
  // Main configuration for TypeScript files
  {
    files: ["**/*.ts"],
    languageOptions: {
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
        project: "./tsconfig.json",
      },
    },
    plugins: {
      prettier: prettier,
    },
    rules: {
      "prettier/prettier": "error",
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/explicit-function-return-type": "off",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/require-await": "off",
    },
  },
];
