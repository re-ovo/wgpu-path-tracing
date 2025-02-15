import { load } from '@loaders.gl/core';
import {
  GLTFLoader,
  GLTFNodePostprocessed,
  GLTFPostprocessed,
  postProcessGLTF,
} from '@loaders.gl/gltf';
import { toast } from 'sonner';
import SceneWorker from '../workers/scene.worker?worker';
import { PackedAtlas, packing } from './atlas';
import { SceneData } from './gpu';

export async function loadGLTF(url: string): Promise<GLTFPostprocessedExt> {
  const gltf = await load(url, GLTFLoader);
  const processed = postProcessGLTF(gltf);
  return processed as GLTFPostprocessedExt;
}

export async function loadModel(
  url: string,
): Promise<[SceneData, PackedAtlas]> {
  const gltf = await loadGLTF(url);
  const atlas = packing(gltf);

  const promise = new Promise<[SceneData, PackedAtlas]>((resolve, reject) => {
    const worker = new SceneWorker();

    // handler message from worker
    worker.onmessage = (e: MessageEvent) => {
      const { type, data, error } = e.data;
      if (type === 'error') {
        reject(new Error(error));
        return;
      }
      resolve([data, atlas]);
    };

    worker.postMessage({ gltf, atlas: atlas.materials });
  });
  toast.promise(promise, {
    loading: 'Loading...',
    success: 'Loaded',
    error: 'Failed to load model',
  });

  return promise;
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
