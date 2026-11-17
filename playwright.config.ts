import { defineConfig } from 'playwright/test';

/**
 * Extension E2E per developer.chrome.com "How to test" + Playwright docs:
 * launch chromium with --load-extension, use chrome.runtime URL targets.
 * TODO(M1): first real spec once the findings pipeline lands.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  use: {
    // eslint-disable-next-line no-restricted-properties
    browserName: 'chromium',
    launchOptions: {
      args: [
        ...(process.env.EXTENSION_PATH
          ? [`--disable-extensions-except=${process.env.EXTENSION_PATH}`, `--load-extension=${process.env.EXTENSION_PATH}`]
          : []),
      ],
    },
  },
});
