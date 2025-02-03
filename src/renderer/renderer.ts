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
import { buildBVH } from './bvh';
import { CameraCPU, prepareScene, SceneData } from './gpu';
import { loadGLTF } from './loader';

const MAX_FRAMES: number = 1024;

class Renderer {
  private device: GPUDevice;
  private context: GPUCanvasContext;
  private sceneData!: SceneData;
  private frameIndex: number = 0;
  private bvhBuffer!: GPUBuffer;

  private profiler?: WebGPUProfiler;
  private statsPane: Pane;

  private onUpdateTasks: ((deltaTime: number) => void)[] = [];

  // Pipelines
  private pathTracePipeline!: GPUComputePipeline;
  private blitPipeline!: GPURenderPipeline;

  // Buffers and Bindings
  private outputBuffer!: GPUBuffer;
  private trianglesBuffer!: GPUBuffer;
  private materialsBuffer!: GPUBuffer;
  private cameraBuffer!: GPUBuffer;
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
    const gltf = await loadGLTF(modelPath);

    this.sceneData = prepareScene(gltf);

    // Reset frame index when loading new model
    this.frameIndex = 0;
    this.camera.frameIndex = 0;

    // Recreate buffers and bindings for new model
    this.createBuffers();
    this.createBindGroups();
  }

  private setupCamera() {
    this.camera = {
      position: vec3.create(0, 1.0, 2.0),
      forward: vec3.create(0, 0, -1),
      right: vec3.create(1, 0, 0),
      up: vec3.create(0, 1, 0),
      fov: Math.PI / 2,
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
    mat4.rotateX(rotation, pitch, rotation);

    // 应用旋转到前向向量
    vec3.transformMat4(this.camera.forward, rotation, this.camera.forward);
    vec3.normalize(this.camera.forward, this.camera.forward);

    // 重新计算右向量
    vec3.cross(this.camera.forward, vec3.create(0, 1, 0), this.camera.right);
    vec3.normalize(this.camera.right, this.camera.right);

    // 重新计算上向量
    vec3.cross(this.camera.right, this.camera.forward, this.camera.up);
    vec3.normalize(this.camera.up, this.camera.up);

    console.log(rotation);
    console.log(this.camera.forward, this.camera.right, this.camera.up);

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

    // Build BVH
    const bvhNodes = buildBVH(this.sceneData.triangles);
    const bvhView = makeStructuredView(
      ptShaderDefs.storages.bvhNodes,
      new ArrayBuffer(
        bvhNodes.length *
          getSizeAndAlignmentOfUnsizedArrayElement(
            ptShaderDefs.storages.bvhNodes,
          ).size,
      ),
    );
    bvhView.set(bvhNodes);

    // Create BVH buffer
    this.bvhBuffer = this.device.createBuffer({
      label: 'bvh nodes',
      size: bvhView.arrayBuffer.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.bvhBuffer, 0, bvhView.arrayBuffer);

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

    materialsView.set(this.sceneData.materials);
    trianglesView.set(this.sceneData.triangles);

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
  }

  private resetOutputBuffer() {
    // 清空输出缓冲区
    this.device.queue.writeBuffer(
      this.outputBuffer,
      0,
      new ArrayBuffer(
        this.context.canvas.width * this.context.canvas.height * 16,
      ),
    );

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

      this.renderFrame();
      this.animationFrameId = requestAnimationFrame(animate);

      if (MAX_FRAMES !== -1 && this.frameIndex > MAX_FRAMES) {
        this.stop();
      }
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

  const presentationFormat = navigator.gpu.getPreferredCanvasFormat();
  context.configure({
    device: device,
    format: presentationFormat,
  });

  const renderer = new Renderer(device, context);
  await renderer.loadModel('/models/cornell.glb');
  renderer.start();

  // Handle window resize
  window.addEventListener('resize', () => {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    renderer.resize(width, height);
  });

  // Handle keyboard input
  window.addEventListener('keydown', (event) => {
    const key = event.key;
    if (key === 'w') {
      renderer.moveCamera(0.1, 0, 0);
    } else if (key === 's') {
      renderer.moveCamera(-0.1, 0, 0);
    } else if (key === 'a') {
      renderer.moveCamera(0, -0.1, 0);
    } else if (key === 'd') {
      renderer.moveCamera(0, 0.1, 0);
    } else if (key === 'q') {
      renderer.moveCamera(0, 0, 0.1);
    } else if (key === 'e') {
      renderer.moveCamera(0, 0, -0.1);
    } else if (key === 'r') {
      renderer.rotateCamera(0.1, 0);
    } else if (key === 'f') {
      renderer.rotateCamera(-0.1, 0);
    }
  });

  return renderer;
}
