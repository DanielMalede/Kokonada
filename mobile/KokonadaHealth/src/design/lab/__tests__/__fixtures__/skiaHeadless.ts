// The unit project's headless Skia stub (jest.setup.js), with the two enums it lacks: FilterMode and MipmapMode, which
// fieldImage.tsx reads when it loads (FIELD_SAMPLING). Since T14 the lab's SCENES reach FieldView, so every unit test whose
// imports reach SCENES or LabRoot loads fieldImage.tsx, and the setup stub alone fails it at import. Each such test mocks
// Skia with this, as the v2 tests that reach FieldView mock it themselves (FieldView.test.tsx, FieldPreview.test.tsx).
// Nothing here draws: these tests render no field. The values are Skia's own. Until the setup stub carries the enums.

import type { ReactNode } from 'react';

const StubView = ({ children }: { children?: ReactNode }) => children ?? null;

export function skiaHeadless() {
  return {
    Canvas: StubView, Group: StubView, Circle: StubView, Blur: StubView, Path: StubView,
    RadialGradient: StubView, LinearGradient: StubView, Fill: StubView, Rect: StubView, RoundedRect: StubView,
    Image: () => null, Picture: () => null,
    vec: (x: number, y: number) => ({ x, y }),
    useClock: () => ({ value: 0 }),
    Skia: { Path: { Make: () => ({ moveTo() {}, lineTo() {}, addCircle() {}, close() {} }) } },
    FilterMode: { Nearest: 0, Linear: 1 },
    MipmapMode: { None: 0, Nearest: 1, Linear: 2 },
  };
}
