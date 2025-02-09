import { prepareScene } from '../renderer/gpu';
import { loadGLTF } from '../renderer/loader';

self.onmessage = async (e: MessageEvent) => {
  const { modelPath } = e.data;

  try {
    // Send loading state
    self.postMessage({
      type: 'loading',
      message: 'Loading model...',
    });

    // Load GLTF model
    const gltf = await loadGLTF(modelPath);

    // Send progress update
    self.postMessage({
      type: 'loading',
      message: 'Processing scene data...',
    });

    // Prepare scene data
    const sceneData = prepareScene(gltf);

    // Send the prepared scene data back to main thread
    self.postMessage({
      type: 'success',
      data: sceneData,
    });
  } catch (error) {
    self.postMessage({
      type: 'error',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};
