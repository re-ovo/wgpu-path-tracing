# wgpu-path-tracing

A path tracing implementation using WebGPU.

## Usage

```bash
# Install dependencies
npm install

# Run the development server
npm run dev
```

## Features

- [x] GLTF Scene Loading
- [x] GPU Time Profiler
- [ ] PBR Materials
- [ ] BVH Acceleration
- [ ] Multiple Importance Sampling (MIS)

## GLTF Extensions Supported

- KHR_materials_ior
- KHR_materials_transmission
- KHR_materials_emissive_strength

## How it works

### Data Loading

The `gpu.ts` file contains the core logic for loading data from a GLTF file.

It uses the `@loaders.gl/gltf` library to load the GLTF file and preprocess the data to extract the scene's information.

All the data will be uploaded to the GPU at once.

### Rendering

The `renderer.ts` file contains the core logic for rendering the scene using WebGPU.

There are two main passes:

1. **Compute Pass**: This pass is responsible for path tracing. It uses a compute shader to calculate the color of each pixel by simulating the paths of light rays through the scene. The results are stored in a buffer.

2. **Render Pass**: This pass takes the results from the compute pass and renders them to the screen. It uses a render pipeline to draw the final image onto the canvas.

## Libraries

- [webgpu-utils](https://github.com/greggman/webgpu-utils)
- [@loaders.gl/gltf](https://www.npmjs.com/package/@loaders.gl/gltf)
