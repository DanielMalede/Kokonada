// The debug app's root swap for the field preview. index.js wraps App with this under __DEV__ only, so
// Metro folds the branch away in a release bundle and nothing here, nor FieldPreview, is in it
// (scripts/jest/__tests__/devPreviewExcluded.test.ts). One dev-menu item swaps the root between the app
// and the preview; the app unmounts while the preview shows, and mounts afresh when it closes.

import React, { useSyncExternalStore, type ComponentType } from 'react';
import { FieldPreview } from './FieldPreview.tsx';

export const FIELD_PREVIEW_MENU_ITEM = 'Field preview';

/** The part of React Native's DevSettings the swap needs. */
export interface DevMenu {
  addMenuItem(title: string, handler: () => void): void;
}

/** `App` behind a dev-menu item that swaps it for the field preview and back. */
export function withFieldPreview<P extends object>(App: ComponentType<P>, devMenu: DevMenu): ComponentType<P> {
  let showing = false;
  const listeners = new Set<() => void>();
  const set = (next: boolean) => {
    showing = next;
    for (const l of [...listeners]) l();
  };
  const subscribe = (l: () => void) => {
    listeners.add(l);
    return () => { listeners.delete(l); };
  };
  devMenu.addMenuItem(FIELD_PREVIEW_MENU_ITEM, () => set(!showing));

  function DevRoot(props: P) {
    const preview = useSyncExternalStore(subscribe, () => showing);
    return preview ? <FieldPreview onClose={() => set(false)} /> : <App {...props} />;
  }
  return DevRoot;
}
