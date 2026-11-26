// Who hears that the field drew its first frame (UI-233, RA-44). FieldView tells the nearest listener, once per mount
// (so once per key: direction, face and scene), when its frame worklet first writes non-null uniforms, crossing to JS as
// onStart does. The app mounts none, so FieldView calls nothing; the Design Lab's field scene listens, so its READY says
// `ready` only for a field that was drawn, never for a stage still blank. It is not a FieldView prop: FieldView takes no
// lab-only knob.

import { createContext } from 'react';

export type FirstFrameListener = () => void;

export const FieldFirstFrameReport = createContext<FirstFrameListener | null>(null);
