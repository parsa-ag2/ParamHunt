import { describe, expect, it } from 'vitest';
import { categorize, extractEndpoints } from './endpoints';

const PAGE = 'https://target.example.com/dashboard';
const SRC = 'https://target.example.com/assets/app.js';

describe('extractEndpoints', () => {
  it('fetch with explicit relative path', () => {
    const rows = extractEndpoints(`fetch("/api/users");`, { pageUrl: PAGE, sourceUrl: SRC, source: 'js-bundle' });
    expect(rows).toHaveLength(1);
    expect(rows[0]!).toMatchObject({ path: '/api/users', method: 'GET', methodConfidence: 'inferred', source: 'js-bundle' });
    expect(rows[0]!.evidence.url).toBe(SRC);
    expect(rows[0]!.evidence.line).toBe(1);
  });

  it('axios methods are explicit', () => {
    const rows = extractEndpoints(`axios.post("/api/orders");axios.get("/api/users");`, {
      pageUrl: PAGE,
      source: 'js-bundle',
    });
    expect(rows.find((r) => r.path === '/api/orders'))!.toMatchObject({ method: 'POST', methodConfidence: 'explicit', source: 'js-bundle' });
    expect(rows.find((r) => r.path === '/api/users'))!.toMatchObject({ method: 'GET' });
  });

  it('XMLHttpRequest.open gives explicit method', () => {
    const rows = extractEndpoints(`x.open("DELETE", "/api/items/5");`, { pageUrl: PAGE, source: 'js-bundle' });
    expect(rows[0]!).toMatchObject({ path: '/api/items/5', method: 'DELETE', methodConfidence: 'explicit', source: 'js-bundle' });
  });

  it('axios.create baseURL resolves relative paths', () => {
    const rows = extractEndpoints(
      `axios.create({ baseURL: "https://api.target.com/v2" }); axios.get("/users");`,
      { pageUrl: PAGE, source: 'js-bundle' },
    );
    const users = rows.find((r) => r.path === '/users' || r.path.includes('/users'));
    expect(users?.url).toBe('https://api.target.com/v2/users');
    expect(rows.some((r) => r.path === 'https://api.target.com/v2' || r.url === 'https://api.target.com/v2')).toBe(true);
  });

  it('route templates are categorized as ROUTE', () => {
    const rows = extractEndpoints(`const r = { path: "/users/:id", method: "get" };`, {
      pageUrl: PAGE,
      source: 'js-bundle',
    });
    expect(rows.some((r) => r.path === '/users/:id' && r.category === 'ROUTE')).toBe(true);
  });

  it('WebSocket endpoints detected', () => {
    const rows = extractEndpoints(`new WebSocket("wss://t.com/ws/chat");`, { pageUrl: PAGE, source: 'js-bundle' });
    expect(rows[0]!).toMatchObject({ url: 'wss://t.com/ws/chat', category: 'WEBSOCKET' });
  });

  it('absolute URLs resolved with full URL + origin', () => {
    const rows = extractEndpoints(`fetch("https://api.target.com/v1/export");`, { pageUrl: PAGE, source: 'js-bundle' });
    expect(rows[0]!).toMatchObject({ url: 'https://api.target.com/v1/export', category: 'DOWNLOAD' });
  });

  it('evidence: line numbers are exact and snippets correspond to source', () => {
    const code = `const a = 1;\nfetch("/api/alpha");\nconst b = 2;`;
    const rows = extractEndpoints(code, { pageUrl: PAGE, sourceUrl: SRC, source: 'js-bundle' });
    expect(rows[0]!.evidence.line).toBe(2);
    expect(rows[0]!.evidence.snippet).toContain('fetch("/api/alpha")');
  });

  it('minified single-char names never become endpoints', () => {
    const rows = extractEndpoints(`fetch(e);`, { pageUrl: PAGE, source: 'js-bundle' });
    expect(rows).toEqual([]);
  });
});

describe('categorize', () => {
  it('matches evidence-based categories', () => {
    expect(categorize('/api/v1/users')).toBe('USER');
    expect(categorize('/api/v1/orders')).toBe('PAYMENT');
    expect(categorize('/api/v1/stats')).toBe('API');
    expect(categorize('/users/:id')).toBe('ROUTE');
    expect(categorize('/auth/login')).toBe('AUTH');
    expect(categorize('/uploads/file')).toBe('UPLOAD');
    expect(categorize('/graphql')).toBe('GRAPHQL');
    expect(categorize('/ws/chat')).toBe('WEBSOCKET');
    expect(categorize('/admin/panel')).toBe('ADMIN');
    expect(categorize('/about')).toBe('OTHER');
  });
});
