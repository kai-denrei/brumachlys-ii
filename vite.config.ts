import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig(({ command }) => ({
  // GitHub Pages serves from /brumachlys-ii/; dev serves from root.
  base: command === 'build' ? '/brumachlys-ii/' : '/',
  plugins: [react()],
  test: {
    environment: 'node',
  },
}));
