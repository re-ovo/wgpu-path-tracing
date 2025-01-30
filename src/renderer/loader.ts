import { load } from '@loaders.gl/core';
import { GLTFLoader, postProcessGLTF } from '@loaders.gl/gltf';

export async function loadGLTF(url: string) {
  const gltf = await load(url, GLTFLoader);
  const processed = postProcessGLTF(gltf);
  console.log(processed);
  return processed;
}
