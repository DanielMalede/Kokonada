// Who hears why the field fell back (UI-223, RA-36). FieldFallback hands the reason FieldView already gives it (an effect
// that cannot draw, or a builder throw on the UI thread) to the nearest listener. The app mounts none, so nothing is
// reported anywhere (REG-066); the Design Lab's field scene listens, so its READY can say which surface drew a shot. It
// is not a FieldView prop: FieldView takes no lab-only knob.

import { createContext } from 'react';

export type FallbackListener = (reason: string) => void;

export const FieldFallbackReport = createContext<FallbackListener | null>(null);
