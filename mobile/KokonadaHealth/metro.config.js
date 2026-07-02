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
      /[/\\]android[/\\]app[/\\]\.cxx[/\\].*/,
      /[/\\]android[/\\]app[/\\]build[/\\].*/,
      /[/\\]android[/\\]\.gradle[/\\].*/,
      /[/\\]android[/\\]build[/\\].*/,
    ],
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
