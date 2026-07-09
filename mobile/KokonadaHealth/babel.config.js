module.exports = {
  presets: ['module:@react-native/babel-preset'],
  // @tamagui/babel-plugin extracts styled-component usage at compile time; it must run
  // BEFORE Reanimated's worklet plugin, which in turn MUST be listed last. Required by
  // the hot-lane gesture worklets in the radial wheel; a no-op for files without worklets.
  plugins: [
    [
      '@tamagui/babel-plugin',
      {
        components: ['tamagui'],
        config: './tamagui.config.ts',
        disableExtraction: process.env.NODE_ENV === 'development',
      },
    ],
    'react-native-reanimated/plugin',
  ],
};
