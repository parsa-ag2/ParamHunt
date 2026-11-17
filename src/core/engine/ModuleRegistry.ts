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
   * Topologically sort registered modules so dependencies start first.
   * Throws DependencyCycleError on cyclic graphs (engine refuses to boot).
   * TODO(M0): implement Kahn's algorithm; skeleton returns insertion order.
   */
  resolveStartOrder(): readonly ModuleDefinition[] {
    // TODO(M0): implement dependency resolution with cycle detection.
    return this.list();
  }
}
