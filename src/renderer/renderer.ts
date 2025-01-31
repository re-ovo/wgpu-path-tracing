import {
  getSizeAndAlignmentOfUnsizedArrayElement,
  makeShaderDataDefinitions,
  makeStructuredView,
} from 'webgpu-utils';
import ptShaderSource from '../shader/pt.wgsl?raw';
import { prepareScene, SceneData, CameraCPU } from './gpu';
import { loadGLTF } from './loader';
import { mat4, vec3 } from 'wgpu-matrix';
import blitShaderSource from '../shader/blit.wgsl?raw';

const MAX_FRAMES = -1;

class Renderer {
  private device: GPUDevice;
  private context: GPUCanvasContext;
  private sceneData: SceneData;
  private frameIndex: number = 0;

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

  constructor(
    device: GPUDevice,
    context: GPUCanvasContext,
    sceneData: SceneData,
  ) {
    this.device = device;
    this.context = context;
    this.sceneData = sceneData;

    this.setupCamera();
    this.createPipelines();
    this.createBuffers();
    this.createBindGroups();
  }

  private setupCamera() {
    this.camera = {
      position: vec3.create(0, 1.0, 2.5),
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
      size: this.context.canvas.width * this.context.canvas.height * 16, // vec3f per pixel, 4 bytes per float (aligned)
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
    this.device.queue.writeBuffer(
      this.outputBuffer,
      0,
      new ArrayBuffer(
        this.context.canvas.width * this.context.canvas.height * 16,
      ),
    );
    this.frameIndex = 0;
    this.camera.frameIndex = 0;
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
    const computePass = commandEncoder.beginComputePass();
    computePass.setPipeline(this.pathTracePipeline);
    computePass.setBindGroup(0, this.computeBindGroup);
    computePass.dispatchWorkgroups(
      Math.ceil(this.context.canvas.width / 16),
      Math.ceil(this.context.canvas.height / 16),
    );
    computePass.end();

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
    });

    renderPass.setPipeline(this.blitPipeline);
    renderPass.setBindGroup(0, this.blitBindGroup);
    renderPass.draw(4, 1, 0, 0);
    renderPass.end();

    this.device.queue.submit([commandEncoder.finish()]);
    this.frameIndex++;
  }

  public start() {
    const animate = () => {
      this.renderFrame();
      this.animationFrameId = requestAnimationFrame(animate);

      if (MAX_FRAMES !== -1 && this.frameIndex > MAX_FRAMES) {
        this.stop();
      }
    };
    animate();
  }

  public stop() {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
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
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) {
    throw new Error('Failed to request WebGPU adapter');
  }

  const device = await adapter.requestDevice();
  const context = canvas.getContext('webgpu');
  if (!context) {
    throw new Error('Failed to create WebGPU context');
  }

  const gltf = await loadGLTF('/models/transform.glb');
  const sceneData = prepareScene(gltf);

  const presentationFormat = navigator.gpu.getPreferredCanvasFormat();
  context.configure({
    device: device,
    format: presentationFormat,
  });

  const renderer = new Renderer(device, context, sceneData);
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
