import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import prettier from 'eslint-config-prettier'

export default tseslint.config(
  { ignores: ['dist/**', 'dist-electron/**', 'release/**', 'build/**', 'node_modules/**', 'scripts/**'] },
  js.configs.recommended,
  // 类型感知规则（含 recommended 全部规则），自动匹配各 tsconfig（如 no-floating-promises）
  ...tseslint.configs.recommendedTypeChecked.map((config) => ({
    ...config,
    files: ['**/*.{ts,tsx}']
  })),
  {
    // 三个子项目覆盖全部源码：web（渲染端+shared）/ electron（主进程+shared）/ tests
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.web.json', './tsconfig.electron.json', './tsconfig.tests.json'],
        tsconfigRootDir: import.meta.dirname
      }
    }
  },
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        ecmaFeatures: { jsx: true }
      }
    },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }]
    }
  },
  {
    files: ['electron/**/*.ts', 'tests/**/*.ts', 'tests/**/*.tsx'],
    rules: {
      // 主进程与测试中的 console 输出是有意为之（生产日志 / 断言上下文）
      'no-console': 'off',
      // 测试中解析 JSON / 构造夹具属于受控场景，运行时正确性由断言保证
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off'
    }
  },
  {
    // 根目录构建配置文件不在任何 tsconfig 中，跳过类型感知规则
    files: ['*.config.ts', '*.config.mjs'],
    extends: [tseslint.configs.disableTypeChecked]
  },
  prettier
)
