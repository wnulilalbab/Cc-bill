import js from '@eslint/js'
import tseslint from 'typescript-eslint'

// Scope: the new, tested layers and the tooling. The legacy screens in src/pages are replaced in
// later slices and are deliberately not linted. Add folders here as they are created.
const scope = [
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
