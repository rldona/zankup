import { defineConfig } from 'vitest/config';

// Only pure modules are unit-tested here; screens run on a phone or the emulator.
export default defineConfig({ test: { include: ['src/**/*.test.ts'], environment: 'node' } });
