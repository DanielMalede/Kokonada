// Who hears that a FieldSurface rendered its first image (RA-50). FieldSurface tells the nearest listener once its UI
// thread has rendered the frame into an image (renderFieldImage gave one: Skia had an offscreen surface and the effect
// drew into it), crossing to JS as FieldView's first-frame signal does. The app mounts none, and then FieldSurface mounts
// nothing more and runs no extra worklet; the Design Lab's witness and grain scenes listen, so their READY says `ready`
// only for surfaces that drew, never for a stage still blank. It is not a FieldSurface prop: FieldSurface takes no
// lab-only knob.

import { createContext } from 'react';

export type SurfaceDrawListener = () => void;

export const FieldSurfaceDrawReport = createContext<SurfaceDrawListener | null>(null);
