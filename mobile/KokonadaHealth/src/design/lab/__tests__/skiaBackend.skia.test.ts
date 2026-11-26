import { Skia } from '@shopify/react-native-skia';
import { readSkiaBackend } from '../skiaBackend';

// UI-276, on a real Skia: the CanvasKit-backed API of this project (react-native-skia 2.6.9's own jest environment) is no
// Ganesh GL backend. It is not the Graphite build, and its offscreen surface is a CPU surface with no native texture,
// so the read must say it cannot name the backend, never ganesh-gl. This is the backend the reports' twins draw with.

it('CanvasKit in node: not Graphite, and its offscreen surface has no GL texture, so null with the reason', () => {
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    expect(Skia.hasDevice()).toBe(false);
    expect(readSkiaBackend(Skia)).toEqual({
      backend: null, readBy: null,
      reason: 'Skia.hasDevice() is false (Ganesh), and the offscreen surface\'s native texture names no GL texture (glTarget undefined, glID undefined)',
    });
    // CanvasKit says so itself: its surfaces have no backend texture on the web build.
    expect(warn).toHaveBeenCalledWith('getBackendTexture is not implemented on Web');
  } finally {
    warn.mockRestore();
  }
});
