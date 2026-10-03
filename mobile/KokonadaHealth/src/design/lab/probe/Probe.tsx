// <Probe>: an element the capture harness samples on the device (MB-085). When laid out, it
// measures itself in WINDOW coordinates and reports its rect in dp and px to the nearest
// <ProbeRegistry>. READY waits until every probe the scene declares has reported.

import React, { createContext, useCallback, useContext, useRef, type ReactNode } from 'react';
import { PixelRatio, View, type StyleProp, type ViewStyle } from 'react-native';
import { probeRect, type ProbeRect } from './geometry';

type Report = (id: string, rect: ProbeRect) => void;
const ProbeContext = createContext<Report | null>(null);

export function ProbeRegistry({ onMeasure, children }: { onMeasure: Report; children?: ReactNode }) {
  return <ProbeContext.Provider value={onMeasure}>{children}</ProbeContext.Provider>;
}

export function Probe({ id, style, children }: { id: string; style?: StyleProp<ViewStyle>; children?: ReactNode }) {
  const report = useContext(ProbeContext);
  if (report === null) throw new Error(`<Probe id="${id}"> must be inside a <ProbeRegistry>: its measurement would go nowhere`);
  const ref = useRef<View>(null);
  const onLayout = useCallback(() => {
    ref.current?.measureInWindow((x, y, width, height) => {
      const rect = probeRect({ x, y, width, height }, PixelRatio.get());
      if (rect) report(id, rect);
    });
  }, [id, report]);
  // collapsable={false}: a layout-only view may be flattened away by the renderer, and then there
  // is nothing to measure.
  return (
    <View ref={ref} nativeID={`probe-${id}`} collapsable={false} onLayout={onLayout} style={style}>
      {children}
    </View>
  );
}
