import js from '@eslint/js'
import tseslint from 'typescript-eslint'

// Scope: the new, tested layers and the tooling. The legacy screens in src/pages are replaced in
// later slices and are deliberately not linted. Add folders here as they are created.
const scope = [
  'src/domain/**/*.ts',
  'src/data/**/*.ts',
  'src/ai/**/*.ts',
  'src/import/**/*.ts',
  'scripts/**/*.ts',
  'test/**/*.ts',
  'e2e/**/*.ts',
]

export default tseslint.config(
  { ignores: ['dist/**', 'coverage/**', 'reports/**', '.stryker-tmp/**', 'node_modules/**'] },
  {
    files: scope,
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
  },
)
