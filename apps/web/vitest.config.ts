import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Reine Logik ohne DOM – die Oberfläche selbst wird nicht gerendert.
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
