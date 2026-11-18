import { describe, expect, it, vi } from 'vitest';
import { EventBus } from './EventBus';

describe('EventBus', () => {
  it('delivers typed events to subscribers', () => {
    const bus = new EventBus();
    const handler = vi.fn();
    bus.on('finding:new', handler);
    bus.emit('finding:new', {
      source: 'param-discovery',
      type: 'query-param',
      severity: 'info',
      title: 'test',
      location: 'https://t/',
      detail: {},
      observedAt: new Date().toISOString(),
    });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('unsubscribe stops delivery', () => {
    const bus = new EventBus();
    const handler = vi.fn();
    const off = bus.on('finding:new', handler);
    off();
    bus.emit('finding:new', {
      source: 'param-discovery',
      type: 'query-param',
      severity: 'info',
      title: 't',
      location: 'https://t/',
      detail: {},
      observedAt: new Date().toISOString(),
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it('emitting with no subscribers is a no-op', () => {
    const bus = new EventBus();
    expect(() =>
      bus.emit('engine:started', { reason: 'startup' }),
    ).not.toThrow();
  });

  it('handlers unsubscribing mid-dispatch do not break iteration', () => {
    const bus = new EventBus();
    const second = vi.fn();
    bus.on('finding:new', function first() {
      offFirst();
      second();
    });
    const offFirst = bus.on('finding:new', () => {});
    // re-register: 'first' is registered before 'second' via the closure above
    void offFirst;
    expect(() => bus.emit('finding:new', {} as never)).not.toThrow();
  });

  it('clear() removes all subscribers', () => {
    const bus = new EventBus();
    const handler = vi.fn();
    bus.on('engine:started', handler);
    bus.clear();
    bus.emit('engine:started', { reason: 'install' });
    expect(handler).not.toHaveBeenCalled();
  });
});
