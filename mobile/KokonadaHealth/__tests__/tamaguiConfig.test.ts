/**
 * @format
 */

import tamaguiConfig from '../tamagui.config';

test('tamagui config builds without throwing', () => {
  expect(tamaguiConfig).toBeDefined();
  expect(tamaguiConfig.fonts).toBeDefined();
  expect(tamaguiConfig.themes).toBeDefined();
});
