import { prepareScene } from '../renderer/gpu';
import { loadGLTF } from '../renderer/loader';

self.onmessage = async (e: MessageEvent) => {
  const { modelPath } = e.data;

  try {
    // Load GLTF model
    const gltf = await loadGLTF(modelPath);

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
