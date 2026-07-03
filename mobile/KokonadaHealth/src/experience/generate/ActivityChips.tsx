import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { useSelector, useDispatch } from 'react-redux';
import { setActivity } from '../../state/cold/emotionSlice';
import { ACTIVITIES } from './activities';

// Single-select activity chips below the wheel. Re-tapping the active chip clears
// it (toggle off → null). Writes straight to the cold lane, so the committed value
// rides the existing emotion_update payload.
export function ActivityChips() {
  const dispatch = useDispatch();
  const selected = useSelector((s: any) => s.emotion.activity as string | null);

  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center', paddingHorizontal: 16 }}>
      {ACTIVITIES.map((a) => {
        const active = selected === a.key;
        return (
          <Pressable
            key={a.key}
            onPress={() => dispatch(setActivity(active ? null : a.key))}
            style={{
              paddingVertical: 8, paddingHorizontal: 14, borderRadius: 20,
              backgroundColor: active ? '#6c5ce7' : '#23233a',
            }}
          >
            <Text style={{ color: 'white', fontSize: 14 }}>{a.emoji} {a.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
