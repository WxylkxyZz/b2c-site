import { FlatCompat } from "@eslint/eslintrc"
import { defineConfig } from "eslint/config"

const compat = new FlatCompat({
  baseDirectory: import.meta.dirname,
})

export default defineConfig([
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
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
  {
    ignores: [
      ".next/**",
      "next-env.d.ts",
      "next.config.js",
      "tailwind.config.js",
      "check-env-variables.js",
    ],
  },
])
