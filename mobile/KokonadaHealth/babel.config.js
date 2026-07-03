module.exports = {
  presets: ['module:@react-native/babel-preset'],
  // Reanimated's worklet plugin MUST be listed last. Required by the hot-lane
  // gesture worklets in the radial wheel; a no-op for files without worklets.
  plugins: ['react-native-reanimated/plugin'],
};
