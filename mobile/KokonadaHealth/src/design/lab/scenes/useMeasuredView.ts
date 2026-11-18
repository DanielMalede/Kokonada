// The measured size of a lab scene's view (T14): a scene that draws the field is its composition root, so it measures,
// and mounts what it draws only once the view has a non-zero size (UI-175). Shared by FieldScene and FallbackScene, so
// neither imports the other (FallbackScene's closure never reaches FieldView).

import { useCallback, useState } from 'react';
import type { LayoutChangeEvent } from 'react-native';

/** The view's size in dp, or null until it has a non-zero one; pass onLayout to the view. */
export function useMeasuredView() {
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize(width > 0 && height > 0 ? { width, height } : null);
  }, []);
  return { size, onLayout };
}
