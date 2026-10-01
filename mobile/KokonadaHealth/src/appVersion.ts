// The build identity a consent grant records (MB-062, REG-034), so the record can show which build's
// consent screen a grantor saw. It mirrors the native version fields — Android versionName and
// versionCode (android/app/build.gradle), iOS MARKETING_VERSION and CURRENT_PROJECT_VERSION — and
// appVersion.test.ts fails if one of them moves without the others. Bump them together.
export const APP_VERSION_NAME = '1.0';
export const APP_VERSION_CODE = 1;
export const APP_VERSION = `${APP_VERSION_NAME} (${APP_VERSION_CODE})`;
