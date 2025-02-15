import { Pane } from 'tweakpane';
import {
  getSizeAndAlignmentOfUnsizedArrayElement,
  makeShaderDataDefinitions,
  makeStructuredView,
} from 'webgpu-utils';
import { mat4, vec3 } from 'wgpu-matrix';
import blitShaderSource from '../shader/blit.wgsl?raw';
import ptShaderSource from '../shader/pt.wgsl?raw';
import { WebGPUProfiler } from '../utils/profiler';
import { PackedAtlas } from './atlas';
import { Controller } from './controller';
import { CameraCPU, SceneData } from './gpu';
import { loadModel } from './loader';

const MAX_FRAMES: number = -1;

export class Renderer {
  private device: GPUDevice;
  private context: GPUCanvasContext;
  private frameIndex: number = 0;

  private profiler?: WebGPUProfiler;
  private statsPane: Pane;

  private onUpdateTasks: ((deltaTime: number) => void)[] = [];

  // Scene data
  private sceneData!: SceneData;
  private atlas!: PackedAtlas;

  // Pipelines
  private pathTracePipeline!: GPUComputePipeline;
  private blitPipeline!: GPURenderPipeline;

  // Buffers and Bindings
  private outputBuffer!: GPUBuffer;
  private trianglesBuffer!: GPUBuffer;
  private materialsBuffer!: GPUBuffer;
  private cameraBuffer!: GPUBuffer;
  private bvhBuffer!: GPUBuffer;
  private lightsBuffer!: GPUBuffer;
  private atlasTexture!: GPUTextureView;
  private computeBindGroup!: GPUBindGroup;
  private blitBindGroup!: GPUBindGroup;

  // Camera
  public camera!: CameraCPU;
  private animationFrameId: number | null = null;
  private lastTime: number = 0;

  constructor(device: GPUDevice, context: GPUCanvasContext) {
    this.device = device;
    this.context = context;

    if (device.features.has('timestamp-query')) {
      this.profiler = new WebGPUProfiler(device);
    }

    this.setupCamera();
    this.createPipelines();

    this.statsPane = new Pane({
      title: 'WebGPU PathTracing',
    });

    this.statsPane.addBinding(this.camera, 'frameIndex', {
      label: 'Frame Index',
      view: 'text',
      readonly: true,
    });

    if (this.profiler) {
      const stats = this.profiler.getStats();
      const folder = this.statsPane.addFolder({
        title: 'Profiler',
      });
      folder.addBinding(stats, 'path-trace-pass', {
        label: 'Path Trace Pass (ms)',
        view: 'text',
        readonly: true,
      });
      folder.addBinding(stats, 'path-trace-pass', {
        readonly: true,
        view: 'graph',
        min: 0,
        label: 'Path Trace',
      });
      folder.addBinding(stats, 'blit-pass', {
        readonly: true,
        view: 'text',
        label: 'Blit Pass (ms)',
      });
      folder.addBinding(stats, 'blit-pass', {
        readonly: true,
        view: 'graph',
        min: 0,
        label: 'Blit',
      });
    }

    const controlsFolder = this.statsPane.addFolder({
      title: 'Controls',
    });

    controlsFolder
      .addButton({
        title: 'Stop',
        label: 'Stop',
      })
      .on('click', () => {
        this.stop();
      });

    controlsFolder
      .addButton({
        title: 'Restart',
        label: 'Restart',
      })
      .on('click', () => {
        this.resetOutputBuffer();
        this.start();
      });
  }

  public addOnUpdate(callback: (deltaTime: number) => void) {
    this.onUpdateTasks.push(callback);
  }

  public async loadModel(modelPath: string) {
    [this.sceneData, this.atlas] = await loadModel(modelPath);
    this.createBuffers();
    this.createBindGroups();
  }

  private setupCamera() {
    this.camera = {
      position: vec3.create(0, 1.0, 2.8),
      forward: vec3.create(0, 0, -1),
      right: vec3.create(1, 0, 0),
      up: vec3.create(0, 1, 0),
      fov: Math.PI / 3,
      aspect: this.context.canvas.width / this.context.canvas.height,
      width: this.context.canvas.width,
      height: this.context.canvas.height,
      frameIndex: 0,
    };
  }

  public moveCamera(forward: number, right: number, up: number) {
    // Update camera position
    const movement = vec3.create(
      right * this.camera.right[0] +
        forward * this.camera.forward[0] +
        up * this.camera.up[0],
      right * this.camera.right[1] +
        forward * this.camera.forward[1] +
        up * this.camera.up[1],
      right * this.camera.right[2] +
        forward * this.camera.forward[2] +
        up * this.camera.up[2],
    );

    vec3.add(this.camera.position, movement, this.camera.position);

    this.resetOutputBuffer();
  }

  public rotateCamera(yaw: number, pitch: number) {
    // 创建一个组合旋转矩阵
    const rotation = mat4.identity();
    mat4.rotateY(rotation, yaw, rotation);

    // 计算当前俯仰角
    const currentPitch = Math.asin(this.camera.forward[1]);

    // 限制新的俯仰角在 -89° 到 89° 之间
    const newPitch = Math.max(
      Math.min(currentPitch + pitch, (Math.PI / 2) * 0.99),
      (-Math.PI / 2) * 0.99,
    );
    // 只应用差值
    const pitchDelta = newPitch - currentPitch;
    mat4.rotateX(rotation, pitchDelta, rotation);

    // 应用旋转到前向向量
    vec3.transformMat4(this.camera.forward, rotation, this.camera.forward);
    vec3.normalize(this.camera.forward, this.camera.forward);

    // 重新计算右向量
    vec3.cross(this.camera.forward, vec3.create(0, 1, 0), this.camera.right);
    vec3.normalize(this.camera.right, this.camera.right);

    // 重新计算上向量
    vec3.cross(this.camera.right, this.camera.forward, this.camera.up);
    vec3.normalize(this.camera.up, this.camera.up);

    this.resetOutputBuffer();
  }

  private createPipelines() {
    // Create path tracing pipeline
    const ptShader = this.device.createShaderModule({
      code: ptShaderSource,
    });
    this.pathTracePipeline = this.device.createComputePipeline({
      layout: 'auto',
      compute: {
        module: ptShader,
        entryPoint: 'main',
      },
    });

    // Create blit pipeline
    const blitShader = this.device.createShaderModule({
      code: blitShaderSource,
    });
    this.blitPipeline = this.device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: blitShader,
        entryPoint: 'vertexMain',
      },
      fragment: {
        module: blitShader,
        entryPoint: 'fragmentMain',
        targets: [
          {
            format: this.context.getCurrentTexture().format,
          },
        ],
      },
      primitive: {
        topology: 'triangle-strip',
        stripIndexFormat: 'uint32',
      },
    });
  }

  private createBuffers() {
    const ptShaderDefs = makeShaderDataDefinitions(ptShaderSource);

    // Create atlas texture
    const atlasTexture = this.device.createTexture({
      size: [this.atlas.texture.width, this.atlas.texture.height],
      format: 'rgba16float',
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.atlasTexture = atlasTexture.createView();
    this.device.queue.copyExternalImageToTexture(
      {
        source: this.atlas.texture,
      },
      { texture: atlasTexture },
      { width: this.atlas.texture.width, height: this.atlas.texture.height },
    );

    // Create camera buffer
    const cameraValues = makeStructuredView(ptShaderDefs.uniforms.camera);
    this.cameraBuffer = this.device.createBuffer({
      label: 'camera values',
      size: cameraValues.arrayBuffer.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Create output buffer
    this.outputBuffer = this.device.createBuffer({
      label: 'path trace result',
      size: this.context.canvas.width * this.context.canvas.height * 16,
      usage:
        GPUBufferUsage.STORAGE |
        GPUBufferUsage.COPY_SRC |
        GPUBufferUsage.COPY_DST,
    });

    // Create scene data buffers
    const trianglesView = makeStructuredView(
      ptShaderDefs.storages.triangles,
      new ArrayBuffer(
        this.sceneData.triangles.length *
          getSizeAndAlignmentOfUnsizedArrayElement(
            ptShaderDefs.storages.triangles,
          ).size,
      ),
    );
    const materialsView = makeStructuredView(
      ptShaderDefs.storages.materials,
      new ArrayBuffer(
        this.sceneData.materials.length *
          getSizeAndAlignmentOfUnsizedArrayElement(
            ptShaderDefs.storages.materials,
          ).size,
      ),
    );
    const bvhView = makeStructuredView(
      ptShaderDefs.storages.bvhNodes,
      new ArrayBuffer(
        this.sceneData.bvhNodes.length *
          getSizeAndAlignmentOfUnsizedArrayElement(
            ptShaderDefs.storages.bvhNodes,
          ).size,
      ),
    );
    const lightsView = makeStructuredView(
      ptShaderDefs.storages.lights,
      new ArrayBuffer(
        this.sceneData.lights.length *
          getSizeAndAlignmentOfUnsizedArrayElement(ptShaderDefs.storages.lights)
            .size,
      ),
    );
    bvhView.set(this.sceneData.bvhNodes);
    materialsView.set(this.sceneData.materials);
    trianglesView.set(this.sceneData.triangles);
    lightsView.set(this.sceneData.lights);

    this.trianglesBuffer = this.device.createBuffer({
      label: 'triangles',
      size: trianglesView.arrayBuffer.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.materialsBuffer = this.device.createBuffer({
      label: 'materials',
      size: materialsView.arrayBuffer.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.bvhBuffer = this.device.createBuffer({
      label: 'bvh nodes',
      size: bvhView.arrayBuffer.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.lightsBuffer = this.device.createBuffer({
      label: 'lights',
      size: lightsView.arrayBuffer.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    this.device.queue.writeBuffer(
      this.trianglesBuffer,
      0,
      trianglesView.arrayBuffer,
    );
    this.device.queue.writeBuffer(
      this.materialsBuffer,
      0,
      materialsView.arrayBuffer,
    );
    this.device.queue.writeBuffer(this.bvhBuffer, 0, bvhView.arrayBuffer);
    this.device.queue.writeBuffer(this.lightsBuffer, 0, lightsView.arrayBuffer);
  }

  private resetOutputBuffer() {
    // 重置帧索引
    this.frameIndex = 0;
    this.camera.frameIndex = 0;

    // 如果已经停止，则重新开始
    if (this.animationFrameId === null) {
      this.start();
    }
  }

  private createBindGroups() {
    // Create compute bind group
    this.computeBindGroup = this.device.createBindGroup({
      layout: this.pathTracePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.outputBuffer } },
        { binding: 1, resource: { buffer: this.trianglesBuffer } },
        { binding: 2, resource: { buffer: this.materialsBuffer } },
        { binding: 3, resource: { buffer: this.cameraBuffer } },
        { binding: 4, resource: { buffer: this.bvhBuffer } },
        { binding: 5, resource: { buffer: this.lightsBuffer } },
        { binding: 6, resource: this.atlasTexture },
      ],
    });

    // Create blit bind group
    this.blitBindGroup = this.device.createBindGroup({
      layout: this.blitPipeline.getBindGroupLayout(0),
      entries: [
        {
          binding: 0,
          resource: {
            buffer: this.outputBuffer,
          },
        },
        {
          binding: 1,
          resource: {
            buffer: this.cameraBuffer,
          },
        },
      ],
    });
  }

  private updateCamera() {
    const ptShaderDefs = makeShaderDataDefinitions(ptShaderSource);
    const cameraValues = makeStructuredView(ptShaderDefs.uniforms.camera);
    this.camera.frameIndex = this.frameIndex;
    cameraValues.set(this.camera);
    this.device.queue.writeBuffer(
      this.cameraBuffer,
      0,
      cameraValues.arrayBuffer,
    );
  }

  private renderFrame() {
    this.updateCamera();

    const commandEncoder = this.device.createCommandEncoder();

    // Compute pass
    const computePass = commandEncoder.beginComputePass({
      timestampWrites: this.profiler?.getTimestampWrites('path-trace-pass'),
    });
    computePass.setPipeline(this.pathTracePipeline);
    computePass.setBindGroup(0, this.computeBindGroup);
    computePass.dispatchWorkgroups(
      Math.ceil(this.context.canvas.width / 16),
      Math.ceil(this.context.canvas.height / 16),
    );
    computePass.end();
    this.profiler?.resolveResults(commandEncoder, 'path-trace-pass');

    // Render pass
    const renderPass = commandEncoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.context.getCurrentTexture().createView(),
          clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
      timestampWrites: this.profiler?.getTimestampWrites('blit-pass'),
    });
    renderPass.setPipeline(this.blitPipeline);
    renderPass.setBindGroup(0, this.blitBindGroup);
    renderPass.draw(4, 1, 0, 0);
    renderPass.end();
    this.profiler?.resolveResults(commandEncoder, 'blit-pass');

    this.device.queue.submit([commandEncoder.finish()]);
    this.profiler?.onSubmit();
    this.frameIndex++;
  }

  public start() {
    this.lastTime = performance.now();
    const animate = (currentTime: number) => {
      const deltaTime = (currentTime - this.lastTime) / 1000; // Convert to seconds
      this.lastTime = currentTime;

      // Execute all update tasks
      for (const task of this.onUpdateTasks) {
        task(deltaTime);
      }

      if (MAX_FRAMES === -1 || this.frameIndex < MAX_FRAMES) {
        this.renderFrame();
      }
      this.animationFrameId = requestAnimationFrame(animate);
    };
    animate(performance.now());
  }

  public stop() {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  public destroy() {
    this.stop();

    this.cameraBuffer.destroy();
    this.outputBuffer.destroy();
    this.trianglesBuffer.destroy();
    this.materialsBuffer.destroy();
    this.bvhBuffer.destroy();
    this.lightsBuffer.destroy();

    this.statsPane.dispose();
    this.profiler?.destroy();
  }

  public resize(width: number, height: number) {
    // Implement resize handling
    this.context.canvas.width = width;
    this.context.canvas.height = height;
    this.camera.aspect = width / height;
    this.camera.width = width;
    this.camera.height = height;

    // Reset frame index when resizing
    this.frameIndex = 0;

    // Recreate buffers and textures that depend on size
    this.createBuffers();
    this.createBindGroups();
  }
}

export async function setupRenderer(canvas: HTMLCanvasElement) {
  const adapter = await navigator.gpu.requestAdapter({
    powerPreference: 'high-performance',
  });
  if (!adapter) {
    throw new Error('Failed to request WebGPU adapter');
  }

  let device: GPUDevice;
  if (adapter.features.has('timestamp-query')) {
    device = await adapter.requestDevice({
      requiredFeatures: ['timestamp-query'], // enable timestamp query
    });
  } else {
    device = await adapter.requestDevice();
  }

  const context = canvas.getContext('webgpu');
  if (!context) {
    throw new Error('Failed to create WebGPU context');
  }

  context.configure({
    device: device,
    format: 'rgba16float',
    toneMapping: {
      mode: 'extended',
    },
  });

  const renderer = new Renderer(device, context);
  await renderer.loadModel('/models/lights.glb');
  renderer.start();

  // Handle window resize
  window.addEventListener('resize', () => {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    renderer.resize(width, height);
  });

  const controller = new Controller(renderer, canvas);
  renderer.addOnUpdate((deltaTime) => controller.update(deltaTime));

  return renderer;
}
