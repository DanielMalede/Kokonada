const path = require('path');

// Local-library autolinking: treat modules/spotify-remote as an installed native
// dependency without publishing it to npm or copying it into node_modules.
module.exports = {
  // Fonts to bundle + link (via `npx react-native-asset`). AURORA bundles Manrope (OFL) as the
  // one app-wide face: the five static weights (Manrope-Regular/Medium/SemiBold/Bold/ExtraBold.ttf)
  // drop into assets/fonts. Screens reference typography.family.display/text (both → 'Manrope'),
  // so linking adopts them with no screen change. iOS also lists each .ttf in Info.plist UIAppFonts.
  assets: ['./assets/fonts'],
  dependencies: {
    '@kokonada/spotify-remote': {
      root: path.join(__dirname, 'modules/spotify-remote'),
    },
  },
};
