import { describe, expect, it } from 'vitest';
import { buildOutput, buildQueryPairs, type BuilderPair } from './builder';

const pairs: BuilderPair[] = [
  { name: 'category_code', value: '42452068' },
  { name: 'vendor_code', value: '1048' },
  { name: 'returnUrl', value: 'parsa' },
  { name: 'callback', value: 'test' },
];

describe('buildQueryPairs', () => {
  it('deduplicates by case-insensitive name, last write wins, first spelling displayed', () => {
    const merged = buildQueryPairs([
      { name: 'next', value: 'a' },
      { name: 'Next', value: 'b' },
      { name: 'next', value: 'c' },
    ]);
    expect(merged).toEqual([{ name: 'next', value: 'c' }]);
  });

  it('drops blank names but keeps empty values', () => {
    const merged = buildQueryPairs([
      { name: '   ', value: 'x' },
      { name: 'keep', value: '' },
    ]);
    expect(merged).toEqual([{ name: 'keep', value: '' }]);
  });
});

describe('buildOutput', () => {
  it('query format: leading ? + form-style encoding', () => {
    expect(buildOutput(pairs, 'query')).toBe('?category_code=42452068&vendor_code=1048&returnUrl=parsa&callback=test');
  });

  it('raw format: no leading question mark', () => {
    expect(buildOutput(pairs, 'raw')).toBe('category_code=42452068&vendor_code=1048&returnUrl=parsa&callback=test');
  });

  it('lines format: one name=value per line', () => {
    expect(buildOutput(pairs, 'lines').split('\n')).toHaveLength(4);
    expect(buildOutput(pairs, 'lines')).toContain('returnUrl=parsa');
  });

  it('json format: object with all pairs', () => {
    expect(JSON.parse(buildOutput(pairs, 'json'))).toEqual({
      category_code: '42452068',
      vendor_code: '1048',
      returnUrl: 'parsa',
      callback: 'test',
    });
  });

  it('url format joins correctly with and without an existing query', () => {
    expect(buildOutput([{ name: 'page', value: '2' }], 'url', { baseUrl: 'https://t.com/list' })).toBe(
      'https://t.com/list?page=2',
    );
    expect(buildOutput([{ name: 'page', value: '2' }], 'url', { baseUrl: 'https://t.com/list?lang=en' })).toBe(
      'https://t.com/list?lang=en&page=2',
    );
  });

  it('encodes spaces (+), unicode, and special characters correctly', () => {
    const out = buildOutput(
      [
        { name: 'q', value: 'hello world' },
        { name: '名前', value: 'پارسا' },
        { name: 'sym', value: 'a&b=c' },
      ],
      'raw',
    );
    const parts = out.split('&');
    expect(parts[0]).toBe('q=hello+world');                       // space as +
    expect(parts[2]).toBe('sym=a%26b%3Dc');                      // & and = escaped
    // unicode round-trips through the encoding (no hand-computed bytes)
    const unicodePair = parts[1]?.split('=') ?? [];
    expect(decodeURIComponent(unicodePair[0] ?? '')).toBe('名前');
    expect(decodeURIComponent(unicodePair[1] ?? '')).toBe('پارسا');
  });

  it('empty values stay explicit (key=)', () => {
    expect(buildOutput([{ name: 'empty', value: '' }], 'raw')).toBe('empty=');
  });

  it('empty selection → empty outputs', () => {
    expect(buildOutput([], 'query')).toBe('');
    expect(buildOutput([], 'lines')).toBe('');
    expect(buildOutput([], 'json')).toBe('{}');
    expect(buildOutput([], 'url', { baseUrl: 'https://t.com/x' })).toBe('https://t.com/x');
  });

  it('same value for all selected (bulk assignment case)', () => {
    const bulk = pairs.map((p) => ({ ...p, value: 'parsa' }));
    expect(buildOutput(bulk, 'raw')).toBe(
      'category_code=parsa&vendor_code=parsa&returnUrl=parsa&callback=parsa',
    );
  });
});
