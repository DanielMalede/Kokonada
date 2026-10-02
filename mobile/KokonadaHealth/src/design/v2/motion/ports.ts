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

export interface MotionPorts {
  readonly reduceMotion: ReduceMotionSource;
  readonly powerSave: PowerSaveSource;
}
