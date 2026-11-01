import { defineConfig } from 'vitest/config'

const gate = (lines: number, branches?: number, functions?: number, statements?: number) => ({
  lines,
  ...(branches !== undefined && { branches }),
  ...(functions !== undefined && { functions }),
  ...(statements !== undefined && { statements }),
})

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts', 'scripts/**/*.test.ts', 'src/**/*.test.{ts,tsx}'],
    environment: 'node',
    testTimeout: 20000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}', 'scripts/**/*.ts'],
      exclude: [
        '**/*.test.{ts,tsx}',
        '**/*.d.ts',
        'src/test-utils/**',
        // Legacy v1 screens: replaced wholesale by Slices 5-12, so they are not measured meanwhile.
        // New files under src/pages/ ARE measured. Delete an entry as each screen is replaced.
        'src/pages/{Dashboard,Import,Installments,Payments,Settings,Transactions}.tsx',
      ],
      reporter: ['text-summary', 'json-summary'],
      // Per-glob gates from docs/intent/dev-loop.md. A glob that matches no files is not an error.
      thresholds: {
        'src/domain/**': gate(100, 100, 100, 100),
        'src/data/**': gate(95, 90),
        'src/ai/**': gate(95),
        'src/ai/tagging/**': gate(95, 90),
        'src/import/**': gate(95),
        'src/pages/**': gate(80),
        'src/components/**': gate(80),
        'src/features/**': gate(80),
      },
    },
  },
})
