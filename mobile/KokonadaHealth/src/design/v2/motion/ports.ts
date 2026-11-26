// The motion policy's ports: an OS setting the field must obey, behind an interface, so the policy
// is tested against stateful fakes and each platform supplies a thin adapter. Reduced motion comes
// from React Native (reduceMotionSource.ts). Battery saver comes from the lab's activity in V1 and
// from a native module at F3.

export interface SignalSource {
  /** The setting now. It may reject; the policy then keeps its cautious tier. */
  read(): Promise<boolean>;
  /** Called on every change. Returns the function that stops the calls. */
  subscribe(onChange: (value: boolean) => void): () => void;
}

export type ReduceMotionSource = SignalSource;
export type PowerSaveSource = SignalSource;

/** Each source must be created once (module scope or a stable memo): a new object is a new, unanswered source, so a source rebuilt on every render never answers. */
export interface MotionPorts {
  readonly reduceMotion: ReduceMotionSource;
  readonly powerSave: PowerSaveSource;
}
