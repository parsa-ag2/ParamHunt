import { test, expect } from 'playwright/test';

/**
 * Smoke spec — proves the extension loads (roadmap M1 replaces with real flow).
 * Requires built extension: EXTENSION_PATH=.output/chrome-mv3 npm run test:e2e
 */
test.skip(process.env.EXTENSION_PATH === undefined, 'build the extension first');
test('extension loads and background boots', async ({ context }) => {
  const page = await context.newPage();
  await page.goto('https://example.com/');
  // TODO(M1): open the panel / assert engine status via service worker console.
  expect(page.url()).toContain('example.com');
});
