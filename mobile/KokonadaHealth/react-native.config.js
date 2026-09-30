const path = require('path');

// Local-library autolinking: treat modules/spotify-remote as an installed native
// dependency without publishing it to npm or copying it into node_modules.
module.exports = {
  // Fonts to bundle + link (via `npx react-native-asset`). None ships today: the display and
  // text faces are the platform System face. A font added to assets/fonts must carry its SIL
  // OFL text beside it (src/design/__tests__/fontLicence.test.ts); see assets/fonts/README.md.
  assets: ['./assets/fonts'],
  dependencies: {
    '@kokonada/spotify-remote': {
      root: path.join(__dirname, 'modules/spotify-remote'),
    },
  },
};
