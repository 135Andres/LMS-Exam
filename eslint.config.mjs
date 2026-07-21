// Config plana compartida (ESLint 9+) para todo el monorepo — dos bloques,
// uno por runtime. Set conservador A PROPÓSITO (plan 12): solo imports/vars
// sin usar, variables sombra, y no-undef del lado JS. Nada de reglas de
// estilo ni los presets "recommended" completos — esos traen de regalo
// no-explicit-any, no-empty, preserve-caught-error, etc., que generan
// cientos de hallazgos de golpe en código preexistente y no es el objetivo
// de este pase inicial.
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      'backend/data/**',
      'backend-python/**',
      '**/*.d.ts',
    ],
  },
  {
    // backend/ — Node + TypeScript. no-undef queda apagado: el compilador de
    // TS ya lo cubre, y sin info de tipos (no usamos parserOptions.project
    // para mantener esto rápido) da falsos positivos con sintaxis TS.
    files: ['backend/src/**/*.ts', 'backend/server.ts'],
    languageOptions: {
      parser: tseslint.parser,
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: {
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      'no-shadow': 'off',
      '@typescript-eslint/no-shadow': 'warn',
    },
  },
  {
    // public/js/ — frontend vanilla, sin build step, ES modules
    files: ['public/js/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        // katex se carga vía <script> de CDN en el HTML, no es un import —
        // sin esto, no-undef tira falso positivo en cada uso.
        katex: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      'no-shadow': 'warn',
      'no-undef': 'warn',
    },
  },
];
