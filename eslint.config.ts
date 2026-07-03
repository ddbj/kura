import js from "@eslint/js"
import stylistic from "@stylistic/eslint-plugin"
import vitest from "@vitest/eslint-plugin"
import importX from "eslint-plugin-import-x"
import reactHooks from "eslint-plugin-react-hooks"
import simpleImportSort from "eslint-plugin-simple-import-sort"
import globals from "globals"
import tseslint from "typescript-eslint"

const HEX_LITERAL_RULE = {
  selector: "Literal[value=/^#[0-9A-Fa-f]{3,8}$/]",
  message: "生 hex 禁止。app/styles/tailwind.css の @theme token を utility class (例: bg-brand) 経由で参照する。token が無い色は @theme に追加してから使う。",
}

const ARBITRARY_CLASSNAME_RULE = {
  selector: "JSXAttribute[name.name='className'] Literal[value=/\\[(#[0-9A-Fa-f]{3,8}|-?\\d+(\\.\\d+)?(px|rem|em|%))\\]/]",
  message: "Tailwind arbitrary value 禁止。@theme token を utility class 経由で参照する。token が無い値は @theme に追加してから使う。",
}

const FORBIDDEN_ELEMENT_RULES = [
  ["button", "生 <button> 禁止。~/ui の <Button> / <IconButton> を使う。"],
  ["a", "生 <a> 禁止。~/ui の <TextLink> / <ExternalLink> または react-router の <Link> を使う。"],
  ["input", "生 <input> 禁止。~/ui の <TextInput> / <FmtRadio> / <FmtCheck> 等の primitive を使う。"],
  ["select", "生 <select> 禁止。~/ui の <Select> を使う。"],
  ["textarea", "生 <textarea> 禁止。~/ui の <TextArea> を使う。"],
].map(([element, message]) => ({
  selector: `JSXOpeningElement[name.name='${element}']`,
  message,
}))

export default tseslint.config(
  { ignores: ["node_modules/", "dist/", "build/", ".react-router/", "tests/setup/.jwks/", ".claude/"] },
  js.configs.recommended,
  tseslint.configs.strict,
  tseslint.configs.stylistic,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    settings: {
      "import-x/resolver": {
        typescript: { project: "./tsconfig.app.json" },
      },
    },
    plugins: {
      "react-hooks": reactHooks,
      "@stylistic": stylistic,
      "simple-import-sort": simpleImportSort,
      "import-x": importX,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Deliberate prop -> state sync effects (Combobox / Select / SearchBox /
      // DateFacet) are a supported pattern; this compiler-oriented rule is
      // advisory, unlike the correctness rules kept above.
      "react-hooks/set-state-in-effect": "off",
      "func-style": ["error", "expression"],
      "prefer-arrow-callback": "error",
      "no-console": "warn",
      "simple-import-sort/imports": "error",
      "simple-import-sort/exports": "error",
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/consistent-type-definitions": "off",
      "@typescript-eslint/array-type": ["error", { default: "array" }],
      "@typescript-eslint/no-unused-vars": ["error", {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        ignoreRestSiblings: true,
      }],
      // Layer boundaries: routes -> shell -> (lib | ui); lib and ui are
      // self-contained and must not depend on each other.
      "import-x/no-restricted-paths": ["error", {
        zones: [
          { target: "./app/ui", from: "./app/routes" },
          { target: "./app/ui", from: "./app/shell" },
          { target: "./app/ui", from: "./app/lib" },
          { target: "./app/lib", from: "./app/routes" },
          { target: "./app/lib", from: "./app/shell" },
          { target: "./app/lib", from: "./app/ui" },
          { target: "./app/shell", from: "./app/routes" },
        ],
      }],
      "@stylistic/semi": ["error", "never"],
      "@stylistic/quotes": ["error", "double", { avoidEscape: true }],
      "@stylistic/indent": ["error", 2, { SwitchCase: 1 }],
      "@stylistic/comma-dangle": ["error", "always-multiline"],
      "@stylistic/brace-style": ["error", "1tbs", { allowSingleLine: true }],
      "@stylistic/eol-last": ["error", "always"],
      "@stylistic/jsx-quotes": ["error", "prefer-double"],
      "@stylistic/no-multi-spaces": "error",
      "@stylistic/no-multiple-empty-lines": ["error", { max: 1 }],
      "@stylistic/no-trailing-spaces": "error",
      "@stylistic/object-curly-spacing": ["error", "always"],
      "@stylistic/member-delimiter-style": [
        "error",
        {
          multiline: { delimiter: "none" },
          singleline: { delimiter: "semi" },
        },
      ],
    },
  },
  {
    files: ["app/routes/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": ["error", HEX_LITERAL_RULE, ARBITRARY_CLASSNAME_RULE, ...FORBIDDEN_ELEMENT_RULES],
    },
  },
  {
    files: ["app/{ui,shell}/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": ["error", HEX_LITERAL_RULE],
    },
  },
  {
    files: ["tests/**/*.{ts,tsx}"],
    plugins: { vitest },
    rules: {
      ...vitest.configs.recommended.rules,
      "vitest/expect-expect": "error",
      "vitest/valid-expect": ["error", { maxArgs: 2 }],
      "@typescript-eslint/no-non-null-assertion": "off",
      "no-console": "off",
    },
  },
  {
    files: ["tests/pbt/**/*.{ts,tsx}"],
    rules: {
      "vitest/no-standalone-expect": "off",
    },
  },
  {
    files: ["**/*.config.ts"],
    rules: {
      "func-style": "off",
      "prefer-arrow-callback": "off",
      "no-console": "off",
    },
  },
  {
    // 運用スクリプト: 実行ログは console に出す
    files: ["scripts/**/*.ts"],
    rules: {
      "no-console": "off",
    },
  },
)
