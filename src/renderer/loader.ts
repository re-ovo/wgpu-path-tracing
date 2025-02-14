import { load } from '@loaders.gl/core';
import {
  GLTFLoader,
  GLTFNodePostprocessed,
  GLTFPostprocessed,
  postProcessGLTF,
} from '@loaders.gl/gltf';

export async function loadGLTF(url: string): Promise<GLTFPostprocessedExt> {
  const gltf = await load(url, GLTFLoader);
  const processed = postProcessGLTF(gltf);
  return processed as GLTFPostprocessedExt;
}

export interface GLTFNodePostprocessedExt extends GLTFNodePostprocessed {
  light?: number;
}

export interface GLTFPostprocessedExt extends GLTFPostprocessed {
  lights: GLTFLight[];
}

export interface GLTFLight {
  type: 'directional' | 'point' | 'spot';
  color?: [number, number, number];
  intensity?: number;
}
