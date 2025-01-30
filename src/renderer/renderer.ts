import { GLTFPostprocessed } from '@loaders.gl/gltf';
import tgpu, { TgpuRoot } from 'typegpu';
import ptShaderSource from '../shader/pt.wgsl?raw';
import { loadGLTF } from './loader';

export async function setupRenderer(canvas: HTMLCanvasElement) {
  const root = await tgpu.init();
  const context = canvas.getContext('webgpu');
  if (!context) {
    throw new Error('Failed to create WebGPU context');
  }

  const gltf = await loadGLTF('/models/cornell.glb');

  const presentationFormat = navigator.gpu.getPreferredCanvasFormat();
  context.configure({
    device: root.device,
    format: presentationFormat,
  });

  render(root, context, gltf);
}

function render(
  root: TgpuRoot,
  context: GPUCanvasContext,
  gltf: GLTFPostprocessed,
) {
  const device = root.device;

  const ptShader = device.createShaderModule({
    code: ptShaderSource,
  });
  console.log(ptShader);
}
