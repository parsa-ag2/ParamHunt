import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

// WXT generates the MV3 manifest from this config at build time.
// See docs/TECHNICAL_DECISIONS.md #2 (why WXT over manual manifest / CRXJS).
export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  vite: () => ({
    plugins: [tailwindcss()],
  }),
  manifest: {
    name: 'ParamHunt',
    description:
      'Browser-based security research tool — parameter discovery, HTTP analysis, DOM & JS inspection. For authorized testing only.',
    version: '0.0.1',
    // Minimum permission set; every entry is justified in docs/SECURITY_MODEL.md.
    permissions: ['storage', 'scripting', 'webRequest', 'tabs', 'activeTab', 'cookies'],
    host_permissions: ['<all_urls>'],
    web_accessible_resources: [
      {
        resources: [],
        matches: [], // populated when a MAIN-world injector lands (roadmap M4)
      },
    ],
    icons: {
      '16': '/icons/icon-16.png',
      '32': '/icons/icon-32.png',
      '48': '/icons/icon-48.png',
      '128': '/icons/icon-128.png',
    },
  },
});
