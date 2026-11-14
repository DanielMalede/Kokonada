// Which surface drew the scene (UI-223, RA-36), for READY's shaderStatus and the capture manifest. A scene reports it
// through this context, which LabRoot provides:
//   · ready           a field scene drawn by the field shader;
//   · fallback        a field scene that FieldFallback drew instead: the effect could not draw, or the builder threw;
//   · fallback-scene  a fallback scene: FieldFallback mounted by design.
// A scene that draws no field reports nothing, and READY says null. The harness refuses a field.* shot that is not
// `ready` and a fallback.* shot that is not `fallback-scene` (scripts/lab/capture.mjs). Nothing here imports FieldView,
// so a fallback scene's closure still never reaches it.

import { createContext } from 'react';

export type ShaderStatus = 'ready' | 'fallback' | 'fallback-scene';
export type ShaderReport = { readonly status: ShaderStatus; readonly reason: string | null };

export const ShaderReportContext = createContext<((report: ShaderReport) => void) | null>(null);
