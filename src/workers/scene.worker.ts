import { prepareScene } from '../renderer/gpu';

self.onmessage = async (e: MessageEvent) => {
  const { gltf, atlas } = e.data;

  try {
    // Prepare scene data
    const sceneData = prepareScene(gltf, atlas);

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
