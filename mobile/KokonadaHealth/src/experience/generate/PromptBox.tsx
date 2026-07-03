import React from 'react';
import { TextInput } from 'react-native';
import { useSelector, useDispatch } from 'react-redux';
import { setTextPrompt } from '../../state/cold/emotionSlice';
import { MAX_PROMPT_LENGTH } from './promptSanitizer';

// The Emotional Prompt box. maxLength caps the native input as a first line of
// defense; the reducer's sanitizePrompt is the authoritative guard (strips control
// bytes, hard-caps length) so even a programmatic paste can't bloat state or MMKV.
export function PromptBox() {
  const dispatch = useDispatch();
  const value = useSelector((s: any) => s.emotion.textPrompt as string);

  return (
    <TextInput
      value={value}
      onChangeText={(t) => dispatch(setTextPrompt(t))}
      placeholder="Describe the vibe…"
      placeholderTextColor="#8888aa"
      maxLength={MAX_PROMPT_LENGTH}
      multiline={false}
      style={{
        marginHorizontal: 24, paddingHorizontal: 16, paddingVertical: 12,
        borderRadius: 14, backgroundColor: '#1a1a28', color: 'white', fontSize: 15,
      }}
    />
  );
}
