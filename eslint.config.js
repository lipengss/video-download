import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import prettierConfig from "eslint-config-prettier";

export default tseslint.config(
  // 全局忽略
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      "dist-renderer/**",
      "downloads/**",
      "engine/**", // 独立 JS 引擎文件
      "*.js", // 根目录 JS 文件（main/preload/server 等后端脚本）
    ],
  },

  // 基础规则 - 所有 TypeScript/TSX 文件
  js.configs.recommended,
  ...tseslint.configs.recommended,

  // React + TypeScript 文件
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      // React Hooks 规则
      ...reactHooks.configs.recommended.rules,
      // TypeScript 宽松规则
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },

  // Prettier 兼容（关闭和 Prettier 冲突的规则）
  prettierConfig,
);
