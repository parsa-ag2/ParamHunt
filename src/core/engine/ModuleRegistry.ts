/**
 * core/engine/ModuleRegistry.ts — registration + dependency resolution.
 *
 * Skeleton (architecture phase): interfaces and structure are final;
 * lifecycle orchestration is wired in implementation phase (roadmap M0).
 */
import type { ModuleDefinition, ModuleId } from '@shared/types/module';

export class DuplicateModuleError extends Error {
  constructor(id: ModuleId) {
    super(`Module already registered: ${id}`);
    this.name = 'DuplicateModuleError';
  }
}

export class DependencyCycleError extends Error {
  constructor(cycle: readonly ModuleId[]) {
    super(`Dependency cycle: ${cycle.join(' -> ')}`);
    this.name = 'DependencyCycleError';
  }
}

export class ModuleRegistry {
  private readonly modules = new Map<ModuleId, ModuleDefinition>();

  register(definition: ModuleDefinition): void {
    if (this.modules.has(definition.id)) {
      throw new DuplicateModuleError(definition.id);
    }
    this.modules.set(definition.id, definition);
  }

  get(id: ModuleId): ModuleDefinition | undefined {
    return this.modules.get(id);
  }

  list(): readonly ModuleDefinition[] {
    return [...this.modules.values()];
  }

  /**
   * Topological sort so dependencies start before their dependents.
   * Unknown dependencies and cycles fail loudly — the engine refuses to boot.
   * Uses Kahn's algorithm; deterministic within a registration order.
   */
  resolveStartOrder(): readonly ModuleDefinition[] {
    const mods = this.list();
    const byId = new Map<ModuleId, ModuleDefinition>(mods.map((m) => [m.id, m]));
    const indegree = new Map<ModuleId, number>();
    const dependents = new Map<ModuleId, ModuleId[]>();
    for (const m of mods) {
      indegree.set(m.id, 0);
      dependents.set(m.id, []);
    }
    for (const m of mods) {
      for (const dep of m.dependencies ?? []) {
        if (!byId.has(dep)) {
          throw new Error(`module "${m.id}" declares unknown dependency "${dep}"`);
        }
        indegree.set(m.id, (indegree.get(m.id) ?? 0) + 1);
        dependents.get(dep)!.push(m.id);
      }
    }
    const queue = mods.filter((m) => (indegree.get(m.id) ?? 0) === 0).map((m) => m.id);
    const order: ModuleDefinition[] = [];
    while (queue.length > 0) {
      const id = queue.shift() as ModuleId;
      order.push(byId.get(id)!);
      for (const next of dependents.get(id) as ModuleId[]) {
        const d = (indegree.get(next) ?? 0) - 1;
        indegree.set(next, d);
        if (d === 0) queue.push(next);
      }
    }
    if (order.length !== mods.length) {
      const cycle = mods.filter((m) => !order.includes(m)).map((m) => m.id);
      throw new DependencyCycleError(cycle);
    }
    return order;
  }
}
