import React from 'react';
import { Text } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';

// The debug app's root swap (devRoot.tsx): index.js wraps App under __DEV__ only, and the wrapper adds one
// dev-menu item that swaps the root between App and the field preview. FieldPreview has its own test;
// here it is a marker that records its onClose, so the swap itself is what is checked.
const preview: { onClose?: () => void } = {};
jest.mock('../FieldPreview.tsx', () => ({
  FieldPreview: (props: { onClose?: () => void }) => {
    preview.onClose = props.onClose;
    return null;
  },
}));

import { FIELD_PREVIEW_MENU_ITEM, withFieldPreview } from '../devRoot.tsx';
import { FieldPreview } from '../FieldPreview.tsx';

/** A dev menu that keeps its items as Android's does: by title, a re-added title replacing the old one. */
function fakeDevMenu() {
  const items = new Map<string, () => void>();
  return { addMenuItem: jest.fn((title: string, handler: () => void) => { items.set(title, handler); }), choose: (title: string) => act(() => items.get(title)!()), items };
}

let appMounts = 0;
function App({ greeting }: { greeting: string }) {
  React.useEffect(() => { appMounts += 1; }, []);
  return <Text>{greeting}</Text>;
}

beforeEach(() => { appMounts = 0; preview.onClose = undefined; });

describe('withFieldPreview', () => {
  it('adds exactly one dev-menu item, named for the preview, when it wraps the app', () => {
    const menu = fakeDevMenu();
    withFieldPreview(App, menu);
    expect(menu.addMenuItem).toHaveBeenCalledTimes(1);
    expect(menu.addMenuItem.mock.calls[0][0]).toBe(FIELD_PREVIEW_MENU_ITEM);
    expect(FIELD_PREVIEW_MENU_ITEM).toBe('Field preview');
  });

  it('renders the app with its root props until the item is chosen; then the preview; then the app again', () => {
    const menu = fakeDevMenu();
    const Root = withFieldPreview(App, menu);
    let r!: ReactTestRenderer.ReactTestRenderer;
    act(() => { r = ReactTestRenderer.create(<Root greeting="hello" />); });
    expect(r.root.findByType(Text).props.children).toBe('hello');
    expect(r.root.findAllByType(FieldPreview)).toHaveLength(0);
    menu.choose(FIELD_PREVIEW_MENU_ITEM);
    expect(r.root.findAllByType(FieldPreview)).toHaveLength(1);
    expect(r.root.findAllByType(App)).toHaveLength(0);
    menu.choose(FIELD_PREVIEW_MENU_ITEM);
    expect(r.root.findAllByType(FieldPreview)).toHaveLength(0);
    expect(r.root.findByType(Text).props.children).toBe('hello');
    expect(appMounts).toBe(2);
    act(() => r.unmount());
  });

  it('the preview\'s close goes back to the app', () => {
    const menu = fakeDevMenu();
    const Root = withFieldPreview(App, menu);
    let r!: ReactTestRenderer.ReactTestRenderer;
    act(() => { r = ReactTestRenderer.create(<Root greeting="hi" />); });
    menu.choose(FIELD_PREVIEW_MENU_ITEM);
    act(() => preview.onClose!());
    expect(r.root.findAllByType(FieldPreview)).toHaveLength(0);
    expect(r.root.findByType(Text).props.children).toBe('hi');
    act(() => r.unmount());
  });

  it('choosing the item while no root is mounted is kept for the next mount, and an unmounted root stops listening', () => {
    const menu = fakeDevMenu();
    const Root = withFieldPreview(App, menu);
    let r!: ReactTestRenderer.ReactTestRenderer;
    act(() => { r = ReactTestRenderer.create(<Root greeting="a" />); });
    act(() => r.unmount());
    menu.choose(FIELD_PREVIEW_MENU_ITEM);
    act(() => { r = ReactTestRenderer.create(<Root greeting="a" />); });
    expect(r.root.findAllByType(FieldPreview)).toHaveLength(1);
    act(() => r.unmount());
  });
});
