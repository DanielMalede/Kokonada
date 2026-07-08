import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { NeuralAnalysisLoader } from '../NeuralAnalysisLoader';

// The Skia render is verified on-device (like BioAura); the math is unit-tested in
// neuralLoaderMath.test.ts. This smoke test guards the component BOUNDARY: it mounts,
// survives idle→active and engagement extremes (including NaN, the Skia-crash guard),
// and unmounts — so wiring it into the Generate screen can never crash the app.
it('mounts, updates across idle→active and engagement extremes, and unmounts without throwing', async () => {
  await ReactTestRenderer.act(async () => {
    const tree = ReactTestRenderer.create(
      <NeuralAnalysisLoader active={false} engagement={{ value: 0 } as any} />,
    );
    tree.update(<NeuralAnalysisLoader active engagement={{ value: 1 } as any} />);
    tree.update(<NeuralAnalysisLoader active engagement={{ value: NaN } as any} />);
    tree.unmount();
  });
});
