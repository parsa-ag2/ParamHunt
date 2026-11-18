import { describe, expect, it } from 'vitest';
import { DependencyCycleError, DuplicateModuleError, ModuleRegistry } from './ModuleRegistry';
import type { ModuleDefinition, ModuleId } from '@shared/types/module';

function fakeModule(id: string, dependencies?: string[]): ModuleDefinition {
  return {
    id: id as ModuleId,
    name: id,
    description: 'test module',
    contexts: ['background'],
    requiredApis: [],
    dependencies: dependencies as ModuleId[] | undefined,
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

  it('resolveStartOrder: dependencies start before their dependents', () => {
    const reg = new ModuleRegistry();
    reg.register(fakeModule('param-discovery', ['results-manager']));
    reg.register(fakeModule('results-manager'));
    expect(reg.resolveStartOrder().map((m) => m.id)).toEqual(['results-manager', 'param-discovery']);
  });

  it('resolveStartOrder: deep chains order transitively', () => {
    const reg = new ModuleRegistry();
    reg.register(fakeModule('c', ['b']));
    reg.register(fakeModule('b', ['a']));
    reg.register(fakeModule('a'));
    expect(reg.resolveStartOrder().map((m) => m.id)).toEqual(['a', 'b', 'c']);
  });

  it('resolveStartOrder: unknown dependency fails loudly', () => {
    const reg = new ModuleRegistry();
    reg.register(fakeModule('x', ['does-not-exist' as ModuleId]));
    expect(() => reg.resolveStartOrder()).toThrow(/unknown dependency/);
  });

  it('resolveStartOrder: dependency cycle throws with the cycle members', () => {
    const reg = new ModuleRegistry();
    reg.register(fakeModule('a', ['b']));
    reg.register(fakeModule('b', ['a']));
    expect(() => reg.resolveStartOrder()).toThrow(DependencyCycleError);
  });
});
