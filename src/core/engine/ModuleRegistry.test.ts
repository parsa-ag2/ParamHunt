import { describe, expect, it } from 'vitest';
import { DuplicateModuleError, ModuleRegistry } from './ModuleRegistry';
import type { ModuleDefinition } from '@shared/types/module';

function fakeModule(id: ModuleDefinition['id']): ModuleDefinition {
  return {
    id,
    name: id,
    description: 'test module',
    contexts: ['background'],
    requiredApis: [],
    start: () => {},
  };
}

describe('ModuleRegistry', () => {
  it('registers and retrieves modules by id', () => {
    const reg = new ModuleRegistry();
    const mod = fakeModule('results-manager');
    reg.register(mod);
    expect(reg.get('results-manager')).toBe(mod);
    expect(reg.list()).toHaveLength(1);
  });

  it('rejects duplicate ids (engine cannot boot with ambiguity)', () => {
    const reg = new ModuleRegistry();
    reg.register(fakeModule('results-manager'));
    expect(() => reg.register(fakeModule('results-manager'))).toThrow(DuplicateModuleError);
  });

  it('get() returns undefined for unknown ids', () => {
    const reg = new ModuleRegistry();
    expect(reg.get('export-engine')).toBeUndefined();
  });

  it('list() returns all registered modules', () => {
    const reg = new ModuleRegistry();
    reg.register(fakeModule('results-manager'));
    reg.register(fakeModule('export-engine'));
    expect(reg.list().map((m) => m.id)).toEqual(['results-manager', 'export-engine']);
  });

  it('resolveStartOrder preserves insertion order while cycle detection is a TODO(M0)', () => {
    const reg = new ModuleRegistry();
    reg.register(fakeModule('results-manager'));
    reg.register(fakeModule('export-engine'));
    expect(reg.resolveStartOrder().map((m) => m.id)).toEqual([
      'results-manager',
      'export-engine',
    ]);
  });
});
