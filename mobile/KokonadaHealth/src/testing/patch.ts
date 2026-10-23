// Capture-and-restore for the fakes in src/testing (QA-112's rule): a fake replaces a member by
// defining it, remembering the exact own descriptor it replaced (or that there was none), and puts
// it back in reverse order. It never uses jest.spyOn, which on a member that is already a mock
// installs nothing and hands back the shared mock (jest-mock 29.7, build/index.js:737).

export class Patcher {
  private undo: Array<() => void> = [];

  /** Replace obj[key] with `value` (writable, configurable) until restore(). */
  set(obj: object, key: PropertyKey, value: unknown): void {
    const previous = Object.getOwnPropertyDescriptor(obj, key);
    Object.defineProperty(obj, key, { value, writable: true, configurable: true, enumerable: previous?.enumerable ?? true });
    this.push(obj, key, previous);
  }

  /** Define obj[key] with a full descriptor (a getter, say) until restore(). */
  define(obj: object, key: PropertyKey, descriptor: PropertyDescriptor): void {
    const previous = Object.getOwnPropertyDescriptor(obj, key);
    Object.defineProperty(obj, key, { configurable: true, enumerable: previous?.enumerable ?? true, ...descriptor });
    this.push(obj, key, previous);
  }

  get active(): boolean {
    return this.undo.length > 0;
  }

  restore(): void {
    while (this.undo.length > 0) this.undo.pop()!();
  }

  private push(obj: object, key: PropertyKey, previous: PropertyDescriptor | undefined): void {
    this.undo.push(() => {
      if (previous) Object.defineProperty(obj, key, previous);
      else delete (obj as Record<PropertyKey, unknown>)[key];
    });
  }
}
