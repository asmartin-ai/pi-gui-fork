import { defineConfig } from '@playwright/test';
import base from '../../../../apps/desktop/playwright.config';
export default defineConfig({ ...base, testDir: '.', testMatch: 'proof.spec.ts', retries: 0 });
