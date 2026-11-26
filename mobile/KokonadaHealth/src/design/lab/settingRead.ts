// How long the lab waits for a device setting it reads (UI-241): the reduced-motion read that starts the real-time
// clock, and the motion policy's reduced-motion read through the ports LabRoot gives a policy scene (battery saver is the
// activity's launch prop, answered at once, labPowerSaveSource.ts). A
// read that has not settled by then is refused with "no answer within … ms", so the lab sends an ERROR naming the setting
// instead of holding READY in silence until the harness's READY timeout.
//
// 10 s: a settings read answers in one bridge round trip (milliseconds), so 10 s is no normal read's time; and it is at
// most half of every capture plan's readyTimeoutMs (30 s in every plan; labSettingsRead.test.tsx pins the half), so the
// ERROR reaches the harness while it still waits, with the other half left for the launch and the JS start before the
// read begins.

export const SETTING_READ_DEADLINE_MS = 10_000;

export type SettingReads = {
  /** The read, refused with "no answer within … ms" if it has not settled by the deadline. */
  read(source: () => Promise<boolean>): Promise<boolean>;
  /** Clears every pending deadline (on unmount): a read after that is never refused by time. */
  clear(): void;
};

export function createSettingReads(deadlineMs: number = SETTING_READ_DEADLINE_MS): SettingReads {
  const pending = new Set<ReturnType<typeof setTimeout>>();
  return {
    read(source) {
      return new Promise<boolean>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(timer);
          reject(new Error(`no answer within ${deadlineMs} ms`));
        }, deadlineMs);
        pending.add(timer);
        const settle = () => {
          clearTimeout(timer);
          pending.delete(timer);
        };
        source().then((value) => { settle(); resolve(value); }, (e: unknown) => { settle(); reject(e); });
      });
    },
    clear() {
      for (const timer of pending) clearTimeout(timer);
      pending.clear();
    },
  };
}
