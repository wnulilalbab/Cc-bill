import js from '@eslint/js'
import tseslint from 'typescript-eslint'

// Scope: all of the app and the tooling (the legacy screens in src/pages were retired in Slice 12).
const scope = [
  'src/*.{ts,tsx}',
  'src/lib/**/*.ts',
  'src/domain/**/*.ts',
  'src/data/**/*.ts',
  'src/ai/**/*.ts', // incl. src/ai/tagging (Slice 7)
  'src/import/**/*.ts',
  'src/features/**/*.{ts,tsx}',
  'src/components/**/*.{ts,tsx}',
  'src/test-utils/**/*.{ts,tsx}',
  'scripts/**/*.ts',
  'test/**/*.ts',
  'e2e/**/*.ts',
]

export default tseslint.config(
  { ignores: ['dist/**', 'coverage/**', 'reports/**', '.stryker-tmp/**', 'node_modules/**'] },
  {
    files: scope,
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    // Destructuring a field away (`const { x: _x, ...rest } = obj`) is how the domain code drops keys immutably.
    rules: { '@typescript-eslint/no-unused-vars': ['error', { ignoreRestSiblings: true }] },
  },
)
