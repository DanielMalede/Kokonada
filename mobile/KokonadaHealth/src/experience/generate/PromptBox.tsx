import React from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';
import { useSelector, useDispatch } from 'react-redux';
import { setTextPrompt } from '../../state/cold/emotionSlice';
import { MAX_PROMPT_LENGTH } from './promptSanitizer';
import { useTheme } from '../../design/theme';
import { space, radius, type as typography } from '../../design/tokens';

// The Emotional Prompt box. maxLength caps the native input as a first line of defence; the
// reducer's sanitizePrompt is the authoritative guard (strips control bytes, hard-caps length) so
// even a programmatic paste can't bloat state or MMKV. Tokenised (light + dark). onFocus/onBlur
// (Fork 3A) let the Generate screen collapse the wheel to a mini-ring while typing; the quiet
// character counter appears only as the cap approaches.
const COUNTER_THRESHOLD = MAX_PROMPT_LENGTH - 60; // ~440/500 — surface the counter only when close

export function PromptBox({ onFocus, onBlur }: { onFocus?: () => void; onBlur?: () => void }) {
  const dispatch = useDispatch();
  const { c } = useTheme();
  const value = useSelector((s: any) => s.emotion.textPrompt as string);

  return (
    <View style={styles.wrap}>
      <TextInput
        value={value}
        onChangeText={(t) => dispatch(setTextPrompt(t))}
        onFocus={onFocus}
        onBlur={onBlur}
        placeholder="Describe the vibe…"
        placeholderTextColor={c.content.tertiary}
        maxLength={MAX_PROMPT_LENGTH}
        multiline={false}
        style={[styles.field, { backgroundColor: c.surface.raised, borderColor: c.surface.hairline, color: c.content.primary }]}
      />
      {value.length > COUNTER_THRESHOLD ? (
        <Text style={[styles.counter, { color: c.content.tertiary }]}>{`${value.length}/${MAX_PROMPT_LENGTH}`}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: '100%', paddingHorizontal: space.xl, gap: space.xs },
  field: {
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    fontSize: typography.size.callout,
  },
  counter: { alignSelf: 'flex-end', fontSize: typography.size.caption, letterSpacing: typography.tracking.caption },
});
