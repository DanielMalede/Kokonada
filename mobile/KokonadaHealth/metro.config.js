const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const config = {
  resolver: {
    // Android native build outputs are never part of the JS graph, and watching them
    // races with CMake's ephemeral temp dirs during a Gradle build — on Windows that
    // crashes Metro's fallback watcher (ENOENT on .cxx/CMakeFiles/CMakeTmp/...). Exclude
    // them so Metro can run safely alongside a native rebuild.
    blockList: [
      // Any CMake native build temp dir, in the app OR a node_modules library (e.g.
      // react-native-reanimated/android/.cxx/...). CMake creates+deletes ephemeral
      // cmTC_*.dir folders during a Gradle build; on Windows (no Watchman) watching
      // them crashes Metro's fallback watcher with ENOENT. This catch-all is the fix.
      /[/\\]\.cxx[/\\].*/,
      /[/\\]android[/\\]app[/\\]build[/\\].*/,
      /[/\\]android[/\\]\.gradle[/\\].*/,
      /[/\\]android[/\\]build[/\\].*/,
      // Native build outputs inside node_modules libraries are never in the JS graph.
      /[/\\]node_modules[/\\][^/\\]+[/\\]android[/\\]build[/\\].*/,
    ],
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
