import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import * as RN from 'react-native';
import { StyleSheet } from 'react-native';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import emotionReducer from '../../../state/cold/emotionSlice';
import { PromptBox } from '../PromptBox';
import { MAX_PROMPT_LENGTH } from '../promptSanitizer';
import { colors, type ThemeName } from '../../../design/tokens';

const makeStore = () => configureStore({ reducer: { emotion: emotionReducer } });

function renderWith(scheme: ThemeName, el: React.ReactElement, store = makeStore()) {
  jest.spyOn(RN, 'useColorScheme').mockReturnValue(scheme);
  let tree!: ReactTestRenderer.ReactTestRenderer;
  ReactTestRenderer.act(() => { tree = ReactTestRenderer.create(<Provider store={store}>{el}</Provider>); });
  return { tree, store };
}
const input = (tree: ReactTestRenderer.ReactTestRenderer) => tree.root.findByType(RN.TextInput);
afterEach(() => jest.restoreAllMocks());

describe('PromptBox — tokenised field + focus lifecycle (Fork 3A)', () => {
  it('the field is the token raised surface with token placeholder ink, in BOTH themes', () => {
    const dark = input(renderWith('dark', <PromptBox />).tree);
    expect(StyleSheet.flatten(dark.props.style).backgroundColor).toBe(colors.dark.surface.raised);
    expect(dark.props.placeholderTextColor).toBe(colors.dark.content.tertiary);
    const light = input(renderWith('light', <PromptBox />).tree);
    expect(StyleSheet.flatten(light.props.style).backgroundColor).toBe(colors.light.surface.raised);
    expect(light.props.placeholderTextColor).toBe(colors.light.content.tertiary);
  });

  it('caps the native input at MAX_PROMPT_LENGTH (first line of defence)', () => {
    expect(input(renderWith('dark', <PromptBox />).tree).props.maxLength).toBe(MAX_PROMPT_LENGTH);
  });

  it('commits typed text through the sanitising reducer', () => {
    const { tree, store } = renderWith('dark', <PromptBox />);
    ReactTestRenderer.act(() => { input(tree).props.onChangeText('rainy sunday'); });
    expect(store.getState().emotion.textPrompt).toBe('rainy sunday');
  });

  it('fires onFocus and onBlur so the screen can drive the mini-ring (Fork 3A)', () => {
    const onFocus = jest.fn();
    const onBlur = jest.fn();
    const { tree } = renderWith('dark', <PromptBox onFocus={onFocus} onBlur={onBlur} />);
    ReactTestRenderer.act(() => { input(tree).props.onFocus(); });
    ReactTestRenderer.act(() => { input(tree).props.onBlur(); });
    expect(onFocus).toHaveBeenCalledTimes(1);
    expect(onBlur).toHaveBeenCalledTimes(1);
  });
});
