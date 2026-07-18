const path = require('path');

// Local-library autolinking: treat modules/spotify-remote as an installed native
// dependency without publishing it to npm or copying it into node_modules.
module.exports = {
  // Fonts to bundle + link (via `npx react-native-asset`). The display face (General Sans
  // Semibold) drops into assets/fonts as GeneralSans-Semibold.otf; the wordmarks already
  // reference typography.family.display, so linking + flipping that token adopts it with no
  // screen change. iOS also lists the .otf in Info.plist UIAppFonts.
  assets: ['./assets/fonts'],
  dependencies: {
    '@kokonada/spotify-remote': {
      root: path.join(__dirname, 'modules/spotify-remote'),
    },
  },
};
