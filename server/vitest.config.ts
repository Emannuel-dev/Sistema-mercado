import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://mercadinho:mercadinho@localhost:5432/mercadinho_test',
      JWT_SECRET: 'teste',
      TZ: 'America/Sao_Paulo',
    },
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 30000,
  },
});
