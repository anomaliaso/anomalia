import { defineConfig } from 'vite';
import { resolve } from 'node:path';
const r = (p: string) => resolve(import.meta.dirname, p);
export default defineConfig({
  resolve: {
    alias: {
      '$app/environment': r('_shims/app-environment.ts'),
      '$env/dynamic/private': r('_shims/env-private.ts'),
      '$env/dynamic/public': r('_shims/env-public.ts'),
      '$env/static/public': r('_shims/env-static-public.ts'),
      '$lib': r('../src/lib')
    }
  }
});
