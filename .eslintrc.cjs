module.exports = {
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
  ],
  root: true,
  env: {
    node: true,
    es2021: true,
  },
  parserOptions: {
    ecmaVersion: 12,
    sourceType: 'module',
  },
  rules: {
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    // Add any specific rules here
  },
  overrides: [
    {
      files: ['src/llm/claude-adapter.ts', 'src/git/utils.ts'],
      rules: {
        'no-useless-escape': 'off',
      },
    },
  ],
};