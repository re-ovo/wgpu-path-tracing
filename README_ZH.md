# wgpu-path-tracing

一个使用 WebGPU 实现的实验性路径追踪渲染器。

> 本项目主要用于探索现代 Web 图形 API 在实现路径追踪方面的可能性。由于 WebGPU 目前尚未支持[光线追踪管线](https://github.com/gpuweb/gpuweb/issues/535)和[无绑定资源](https://github.com/gpuweb/gpuweb/issues/380)，目前只能基于计算着色器和纹理图集来实现。

| Cornell (无多重重要性采样/64spp)                                  | Cornell (多重重要性采样/64spp)                         | Cornell (多重重要性采样/512spp)                          |
| ----------------------------------------------------------------- | ------------------------------------------------------ | -------------------------------------------------------- |
| ![CornellBox (No MIS/64spp)](/docs/img/cornell_64spp_mis_off.png) | ![CornellBox (MIS/64spp)](/docs/img/cornell_64spp.png) | ![CornellBox (MIS/512spp)](/docs/img/cornell_512spp.png) |

## 使用方法

```bash
# 安装依赖
npm install

# 运行开发服务器
npm run dev
```

## 特性

- [x] PBR 材质（支持金属度/粗糙度/透射/自发光）
- [x] GLTF 场景加载
- [x] 拖拽模型文件加载（通过 Web Worker 异步加载）
- [x] GPU 和 CPU 时间性能分析
- [x] BVH 加速（使用表面积启发式）
- [x] 多重重要性采样
- [x] 纹理支持（基于纹理图集）
- [x] 景深效果
- [x] 色调映射
- [x] HDR 支持

## 支持的 GLTF 扩展

- [KHR_lights_punctual](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_lights_punctual/README.md)
- [KHR_materials_ior](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_materials_ior/README.md)
- [KHR_materials_transmission](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_materials_transmission/README.md)
- [KHR_materials_emissive_strength](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_materials_emissive_strength/README.md)

## 工作原理

### 数据加载

`gpu.ts` 文件包含了从 GLTF 文件加载数据的核心逻辑。

它使用 `@loaders.gl/gltf` 库来加载 GLTF 文件并预处理数据以提取场景信息。

所有数据将一次性上传到 GPU。

### BVH 构建

`bvh.ts` 文件包含了构建 BVH 的核心逻辑。

它使用表面积启发式（SAH）来寻找 BVH 的最佳分割点。

### 渲染

`renderer.ts` 文件包含了使用 WebGPU 渲染场景的核心逻辑。

主要有两个渲染阶段：

1. **计算阶段**：这个阶段负责路径追踪。它使用计算着色器通过模拟光线在场景中的路径来计算每个像素的颜色。结果存储在缓冲区中。

2. **渲染阶段**：这个阶段将计算阶段的结果渲染到屏幕上。它使用渲染管线将最终图像绘制到画布上。

## 使用的库

- [webgpu-utils](https://github.com/greggman/webgpu-utils)
- [@loaders.gl/gltf](https://www.npmjs.com/package/@loaders.gl/gltf)
- [potpack](https://github.com/mapbox/potpack)

## 参考资料

- [多重重要性采样原理解析](https://lisyarus.github.io/blog/posts/multiple-importance-sampling.html#section-monte-carlo-integration)
- [微表面 BRDF 采样](https://agraphicsguynotes.com/posts/sample_microfacet_brdf/)
- [RayTracing (by pozero)](https://github.com/pozero/RayTracing)
- [使用表面积启发式的 BVH](https://www.cnblogs.com/lookof/p/3546320.html)
