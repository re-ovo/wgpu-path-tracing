import { GLTFPostprocessed } from '@loaders.gl/gltf';
import * as d from 'typegpu/data';

export const AABB = d.struct({
  min: d.vec3f,
  max: d.vec3f,
});

export const BVHNode = d.struct({
  aabb: AABB,
  left: d.i32,
  right: d.i32,
  first_triangle: d.u32,
  triangle_count: d.u32,
});

// Texture Atlas Entry - 记录每个纹理在图集中的位置和大小
export const TextureAtlasEntry = d.struct({
  offset: d.vec2f, // 在图集中的起始位置（标准化坐标 0-1）
  scale: d.vec2f, // 在图集中的缩放（标准化坐标 0-1）
});

// Material properties
export const Material = d.struct({
  baseColor: d.vec3f,
  emission: d.vec3f,
  metallic: d.f32,
  roughness: d.f32,
  ior: d.f32, // Index of refraction
  transmission: d.f32,
  // 纹理索引，-1表示不使用该纹理
  baseColorTexId: d.i32,
  metallicRoughnessTexId: d.i32,
  normalTexId: d.i32,
  emissionTexId: d.i32,
});

// Triangle structure with vertices and material index
export const Triangle = d.struct({
  v0: d.vec3f,
  v1: d.vec3f,
  v2: d.vec3f,
  n0: d.vec3f, // vertex normals
  n1: d.vec3f,
  n2: d.vec3f,
  uv0: d.vec2f, // texture coordinates
  uv1: d.vec2f,
  uv2: d.vec2f,
  materialIndex: d.u32,
});

export type TriangleType = d.Infer<typeof Triangle>;

// Camera parameters
export const Camera = d.struct({
  position: d.vec3f,
  forward: d.vec3f,
  right: d.vec3f,
  up: d.vec3f,
  fov: d.f32,
  aspect: d.f32,
});

// 渲染全局参数
export const RenderParams = d.struct({
  atlasSize: d.vec2f, // 纹理图集的大小
  maxTextureCount: d.u32, // 最大纹理数量
  frameIndex: d.u32, // 当前帧索引（用于累积）
  // ... 其他渲染参数
});

export interface SceneData {
  triangles: TriangleType[];
}

export function prepareScene(gltf: GLTFPostprocessed): SceneData {
  const triangles: TriangleType[] = [];

  for (const mesh of gltf.meshes) {
    for (const primitive of mesh.primitives) {
      const triangle = primitive.attributes.position.value;
      triangles.push(triangle);
    }
  }

  return { triangles };
}
