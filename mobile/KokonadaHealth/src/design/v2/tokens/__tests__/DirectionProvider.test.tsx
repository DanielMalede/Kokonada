import React from 'react';
import * as RN from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { DirectionProvider } from '../DirectionProvider.tsx';
import { BASE, DIRECTIONS, type DirectionId, type Face } from '../tokens.generated.ts';
import { useTokens, type Tokens } from '../useTokens.ts';

const { act } = ReactTestRenderer;

// The preset installs useColorScheme as jest.fn(() => 'light'). spyOn on an existing mock
// registers no restore, so its implementation is captured and put back by hand.
const colorScheme = RN.useColorScheme as unknown as jest.Mock;
const PRESET_SCHEME = colorScheme.getMockImplementation();
afterEach(() => colorScheme.mockImplementation(PRESET_SCHEME));

function render(choice: { direction: DirectionId; face?: Face } | null) {
  const seen: Tokens[] = [];
  function Probe() {
    seen.push(useTokens());
    return null;
  }
  const tree = (c: typeof choice) => (c ? <DirectionProvider direction={c.direction} face={c.face}><Probe /></DirectionProvider> : <Probe />);
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    renderer = ReactTestRenderer.create(tree(choice));
  });
  return {
    latest: () => seen[seen.length - 1],
    all: () => seen,
    update: (next: typeof choice) => act(() => renderer.update(tree(next))),
    unmount: () => act(() => renderer.unmount()),
  };
}

describe('DirectionProvider and useTokens', () => {
  it('give the chosen direction’s tokens for the chosen face', () => {
    const view = render({ direction: 'linen', face: 'dark' });
    const tokens = view.latest();
    expect(tokens.id).toBe('linen');
    expect(tokens.face).toBe('dark');
    expect(tokens.base).toBe(BASE);
    expect(tokens.direction).toBe(DIRECTIONS.linen);
    expect(tokens.color).toBe(DIRECTIONS.linen.color.dark);
    view.unmount();
  });

  // One build, three token sets: the swap is a prop, never a code path.
  it('swap every token when the direction changes', () => {
    const view = render({ direction: 'linen', face: 'light' });
    view.update({ direction: 'basin', face: 'light' });
    expect(view.latest().direction).toBe(DIRECTIONS.basin);
    expect(view.latest().color).toBe(DIRECTIONS.basin.color.light);
    view.update({ direction: 'abyss', face: 'light' });
    expect(view.latest().color).toBe(DIRECTIONS.abyss.color.light);
    view.unmount();
  });

  it('follow the phone’s face when none is forced', () => {
    colorScheme.mockImplementation(() => 'dark');
    const dark = render({ direction: 'abyss' });
    expect(dark.latest().face).toBe('dark');
    expect(dark.latest().color).toBe(DIRECTIONS.abyss.color.dark);
    dark.unmount();

    colorScheme.mockImplementation(() => 'light');
    const light = render({ direction: 'abyss' });
    expect(light.latest().face).toBe('light');
    light.unmount();
  });

  it('read an unknown phone setting as the light face', () => {
    colorScheme.mockImplementation(() => null);
    const view = render({ direction: 'abyss' });
    expect(view.latest().face).toBe('light');
    view.unmount();
  });

  it('a forced face wins over the phone', () => {
    colorScheme.mockImplementation(() => 'dark');
    const view = render({ direction: 'basin', face: 'light' });
    expect(view.latest().face).toBe('light');
    view.unmount();
  });

  it('keep the same object across re-renders with the same choice', () => {
    const view = render({ direction: 'linen', face: 'dark' });
    view.update({ direction: 'linen', face: 'dark' });
    const [first, ...rest] = view.all();
    for (const tokens of rest) expect(tokens).toBe(first);
    view.unmount();
  });

  describe('fail loudly', () => {
    let errors: jest.SpyInstance;
    beforeEach(() => {
      errors = jest.spyOn(console, 'error').mockImplementation(() => {});
    });
    afterEach(() => errors.mockRestore());

    it('without a provider', () => {
      expect(() => render(null)).toThrow(/DirectionProvider/);
    });

    it('for a direction the tokens do not have', () => {
      expect(() => render({ direction: 'paper' as DirectionId })).toThrow(/paper/);
    });

    // An inherited key such as 'constructor' is truthy on any object, so a plain lookup would
    // hand back Object's constructor and fail later with a vague TypeError instead.
    it.each(['constructor', 'toString', '__proto__'])('for the inherited key %p, with the named error', (key) => {
      expect(() => render({ direction: key as DirectionId })).toThrow(new RegExp(`no tokens for direction ${key}`));
    });
  });
});
