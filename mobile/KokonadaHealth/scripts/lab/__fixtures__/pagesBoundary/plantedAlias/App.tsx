// The release root reaches the local package by its package name only: no relative specifier names the page.
// The package is declared in this fixture's package.json and never installed, so tsc cannot resolve it (the
// full-project ratchet, scripts/tsc); the guard resolves it from package.json, as Metro does from node_modules.
// @ts-expect-error TS2307: the fixture's local package is not installed under node_modules
import { AlphaPage } from '@pages-boundary-fixture/shared';
export default AlphaPage;
