import { GLTFMaterialPostprocessed, GLTFPostprocessed } from '@loaders.gl/gltf';
import { vec2, Vec2, vec3, Vec3 } from 'wgpu-matrix';

export interface MaterialCPU {
  baseColor: Vec3;
  metallic: number;
  roughness: number;
  emission: Vec3;
  emissiveStrength: number;
  ior: number;
  transmission: number;
}

export interface TriangleCPU {
  v0: Vec3;
  v1: Vec3;
  v2: Vec3;
  n0: Vec3;
  n1: Vec3;
  n2: Vec3;
  uv0: Vec2;
  uv1: Vec2;
  uv2: Vec2;
  materialIndex: number;
}

// Camera parameters
export interface CameraCPU {
  position: Vec3;
  forward: Vec3;
  right: Vec3;
  up: Vec3;
  fov: number;
  aspect: number;
  width: number;
  height: number;
  frameIndex: number;
}

export interface SceneData {
  triangles: TriangleCPU[];
  materials: MaterialCPU[];
}

export function prepareScene(gltf: GLTFPostprocessed): SceneData {
  const allTriangles: TriangleCPU[] = [];
  const allMaterials: MaterialCPU[] = [];

  console.log(gltf.nodes);

  for (const mesh of gltf.meshes) {
    for (const primitive of mesh.primitives) {
      const position = primitive.attributes['POSITION'];
      const normal = primitive.attributes['NORMAL'];
      const uv = primitive.attributes['TEXCOORD_0'];
      const index = primitive.indices;

      console.log('mesh', mesh);

      // build triangles
      const triangles = buildTriangles(
        position.value as Float32Array,
        normal.value as Float32Array,
        uv.value as Float32Array,
        index?.value as Uint16Array,
      );

      // build material
      const material = buildMaterial(primitive.material);
      allMaterials.push(material);

      // apply material to triangles
      triangles.forEach((triangle) => {
        triangle.materialIndex = allMaterials.length - 1;
      });
      allTriangles.push(...triangles);
    }
  }

  return { triangles: allTriangles, materials: allMaterials };
}

function buildTriangles(
  position: Float32Array,
  normal: Float32Array,
  uv: Float32Array,
  index: Uint16Array,
) {
  if (index instanceof Uint32Array) {
    throw new Error('Uint32Array is not supported yet');
  }

  const triangles: TriangleCPU[] = [];
  if (index) {
    for (let i = 0; i < index.length; i += 3) {
      const i0 = index[i] * 3;
      const i1 = index[i + 1] * 3;
      const i2 = index[i + 2] * 3;

      const uv0 = index[i] * 2;
      const uv1 = index[i + 1] * 2;
      const uv2 = index[i + 2] * 2;

      const triangle: TriangleCPU = {
        v0: vec3.create(position[i0], position[i0 + 1], position[i0 + 2]),
        v1: vec3.create(position[i1], position[i1 + 1], position[i1 + 2]),
        v2: vec3.create(position[i2], position[i2 + 1], position[i2 + 2]),
        n0: vec3.create(normal[i0], normal[i0 + 1], normal[i0 + 2]),
        n1: vec3.create(normal[i1], normal[i1 + 1], normal[i1 + 2]),
        n2: vec3.create(normal[i2], normal[i2 + 1], normal[i2 + 2]),
        uv0: vec2.create(uv[uv0], uv[uv0 + 1]),
        uv1: vec2.create(uv[uv1], uv[uv1 + 1]),
        uv2: vec2.create(uv[uv2], uv[uv2 + 1]),
        materialIndex: 0,
      };
      triangles.push(triangle);
    }
  } else {
    for (let i = 0; i < position.length; i += 9) {
      const triangle: TriangleCPU = {
        v0: vec3.create(position[i], position[i + 1], position[i + 2]),
        v1: vec3.create(position[i + 3], position[i + 4], position[i + 5]),
        v2: vec3.create(position[i + 6], position[i + 7], position[i + 8]),
        n0: vec3.create(normal[i], normal[i + 1], normal[i + 2]),
        n1: vec3.create(normal[i + 3], normal[i + 4], normal[i + 5]),
        n2: vec3.create(normal[i + 6], normal[i + 7], normal[i + 8]),
        uv0: vec2.create(uv[(i / 3) * 2], uv[(i / 3) * 2 + 1]),
        uv1: vec2.create(uv[(i / 3 + 1) * 2], uv[(i / 3 + 1) * 2 + 1]),
        uv2: vec2.create(uv[(i / 3 + 2) * 2], uv[(i / 3 + 2) * 2 + 1]),
        materialIndex: 0,
      };
      triangles.push(triangle);
    }
  }

  return triangles;
}

function buildMaterial(
  material: GLTFMaterialPostprocessed | undefined,
): MaterialCPU {
  if (!material) {
    return {
      baseColor: vec3.create(1.0, 1.0, 1.0),
      emission: vec3.create(0.0, 0.0, 0.0),
      emissiveStrength: 0.0,
      metallic: 0.0,
      roughness: 0.1,
      ior: 1.5,
      transmission: 0.0,
    };
  }

  const baseColor = material.pbrMetallicRoughness?.baseColorFactor ?? [
    1.0, 1.0, 1.0, 1.0,
  ];
  const metallic = material.pbrMetallicRoughness?.metallicFactor ?? 0.0;
  const roughness = material.pbrMetallicRoughness?.roughnessFactor ?? 0.5;

  const emissive = material.emissiveFactor ?? [0.0, 0.0, 0.0];
  const emissiveStrength =
    material.extensions?.KHR_materials_emissive_strength?.emissiveStrength ??
    1.0;

  const ior = material.extensions?.KHR_materials_ior?.ior ?? 1.5;
  const transmission =
    material.extensions?.KHR_materials_transmission?.transmissionFactor ?? 0.0;

  return {
    baseColor: vec3.create(baseColor[0], baseColor[1], baseColor[2]),
    metallic,
    roughness,
    emission: vec3.create(emissive[0], emissive[1], emissive[2]),
    emissiveStrength,
    ior,
    transmission,
  };
}
