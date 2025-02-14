# wgpu-path-tracing

A experimental Path Tracing implementation using WebGPU.

> This project is mainly used to explore the possibilities of modern Web graphics APIs in implementing Path Tracing. Due to the lack of support for [ray tracing pipelines](https://github.com/gpuweb/gpuweb/issues/535) and [bindless resources](https://github.com/gpuweb/gpuweb/issues/380) in WebGPU, it can currently only be implemented based on compute shaders and texture atlases.

<img src="/docs/img/screenshot.png" alt="screenshot" width="400" />

## Usage

```bash
# Install dependencies
npm install

# Run the development server
npm run dev
```

## Features

- [x] PBR Materials (with Metallic/Roughness/Transmission/Emissive)
- [x] GLTF Scene Loading
- [x] Drag and Drop model file to load (asynchronous via web worker)
- [x] GPU and CPU Time Profiler
- [x] BVH Acceleration (with SAH)
- [x] Multiple Importance Sampling
- [ ] Texture support (based on texture atlas)
- [ ] Environment Mapping
- [x] Tone Mapping
- [x] HDR support

## GLTF Extensions Supported

- [KHR_lights_punctual](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_lights_punctual/README.md)
- [KHR_materials_ior](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_materials_ior/README.md)
- [KHR_materials_transmission](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_materials_transmission/README.md)
- [KHR_materials_emissive_strength](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_materials_emissive_strength/README.md)

## How it works

### Data Loading

The `gpu.ts` file contains the core logic for loading data from a GLTF file.

It uses the `@loaders.gl/gltf` library to load the GLTF file and preprocess the data to extract the scene's information.

All the data will be uploaded to the GPU at once.

### BVH Construction

The `bvh.ts` file contains the core logic for constructing the BVH.

It uses SAH (Surface Area Heuristic) to find the best split point for the BVH.

### Rendering

The `renderer.ts` file contains the core logic for rendering the scene using WebGPU.

There are two main passes:

1. **Compute Pass**: This pass is responsible for path tracing. It uses a compute shader to calculate the color of each pixel by simulating the paths of light rays through the scene. The results are stored in a buffer.

2. **Render Pass**: This pass takes the results from the compute pass and renders them to the screen. It uses a render pipeline to draw the final image onto the canvas.

## Libraries

- [webgpu-utils](https://github.com/greggman/webgpu-utils)
- [@loaders.gl/gltf](https://www.npmjs.com/package/@loaders.gl/gltf)
- [potpack](https://github.com/mapbox/potpack)

## References

- [Demystifying multiple importance sampling](https://lisyarus.github.io/blog/posts/multiple-importance-sampling.html#section-monte-carlo-integration)
- [sample microfacet brdf](https://agraphicsguynotes.com/posts/sample_microfacet_brdf/)
- [RayTracing (by pozero)](https://github.com/pozero/RayTracing)
- [BVH with SAH](https://www.cnblogs.com/lookof/p/3546320.html)
