import {
  GLTFMaterialPostprocessed,
  GLTFNodePostprocessed,
} from '@loaders.gl/gltf';
import { Mat4, mat4, quat, vec2, Vec2, vec3, Vec3 } from 'wgpu-matrix';
import { AtlasTexture, MaterialTextures, PackedAtlas } from './atlas';
import { buildBVH, BVHNode } from './bvh';
import { GLTFNodePostprocessedExt, GLTFPostprocessedExt } from './loader';

export interface MaterialCPU {
  baseColor: Vec3;
  metallic: number;
  roughness: number;
  emission: Vec3;
  emissiveStrength: number;
  ior: number;
  transmission: number;
  albedo: AtlasTexture;
  normal: AtlasTexture;
  pbr: AtlasTexture;
  emissive: AtlasTexture;
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

export interface LightCPU {
  position: Vec3;
  lightType: number;
  color: Vec3;
  intensity: number;
  triangleIndex: number;
}

export interface SceneData {
  triangles: TriangleCPU[];
  materials: MaterialCPU[];
  bvhNodes: BVHNode[];
  lights: LightCPU[];
}

export function prepareScene(
  gltf: GLTFPostprocessedExt,
  atlas: Map<GLTFMaterialPostprocessed, MaterialTextures>,
): SceneData {
  try {
    const allTriangles: TriangleCPU[] = [];
    const allMaterials: MaterialCPU[] = [];
    const allLights: LightCPU[] = [];

    // build parent map
    const parentMap: Map<GLTFNodePostprocessed, GLTFNodePostprocessed> =
      new Map();
    for (const node of gltf.nodes) {
      if (node.children) {
        for (const child of node.children) {
          parentMap.set(child, node);
        }
      }
    }

    // Calculate world matrices for each node
    const worldMatrices: Map<GLTFNodePostprocessed, Mat4> = new Map();
    for (const node of gltf.nodes) {
      const localMatrix = extractNodeMatrix(node);
      const worldMatrix = mat4.clone(localMatrix);

      // Traverse up the parent chain to accumulate transformations
      let currentNode = node;
      while (parentMap.has(currentNode)) {
        const parent = parentMap.get(currentNode)!;
        const parentMatrix = extractNodeMatrix(parent);
        mat4.mul(parentMatrix, worldMatrix, worldMatrix);
        currentNode = parent;
      }

      worldMatrices.set(node, worldMatrix);
    }

    for (const node of gltf.nodes) {
      processNode(
        gltf,
        atlas,
        node,
        allTriangles,
        allMaterials,
        allLights,
        worldMatrices.get(node)!,
      );
    }

    console.log(`${gltf.nodes.length} nodes, ${allTriangles.length} triangles`);

    const bvhNodes = buildBVH(allTriangles);

    // 构建完BVH后，添加emissive light的triangleIndex
    for (let i = 0; i < allTriangles.length; i++) {
      const triangle = allTriangles[i];
      if (triangle.materialIndex >= 0) {
        const material = allMaterials[triangle.materialIndex];
        if (vec3.length(material.emission) > 0.0) {
          // 自发光材质
          const lightCPU: LightCPU = {
            position: vec3.create(0.0, 0.0, 0.0),
            lightType: 0,
            color: material.emission,
            intensity: material.emissiveStrength,
            triangleIndex: i,
          };
          allLights.push(lightCPU);
        }
      }
    }

    return {
      triangles: allTriangles,
      materials: allMaterials,
      bvhNodes: bvhNodes,
      lights: allLights,
    };
  } catch (error) {
    console.error(error);
    throw error;
  }
}

function extractNodeMatrix(node: GLTFNodePostprocessed): Mat4 {
  const matrix = node.matrix ? mat4.create(...node.matrix) : mat4.identity();

  if (!node.matrix) {
    // TRS order
    // The order should be T * R * S for TRS transformation
    if (node.translation) {
      mat4.translate(
        matrix,
        vec3.create(
          node.translation[0],
          node.translation[1],
          node.translation[2],
        ),
        matrix,
      );
    }

    if (node.rotation) {
      const rotationMat = mat4.fromQuat(
        quat.create(
          node.rotation[0],
          node.rotation[1],
          node.rotation[2],
          node.rotation[3],
        ),
      );
      mat4.mul(matrix, rotationMat, matrix);
    }

    if (node.scale) {
      mat4.scale(
        matrix,
        vec3.create(node.scale[0], node.scale[1], node.scale[2]),
        matrix,
      );
    }
  }

  return matrix;
}

function processNode(
  gltf: GLTFPostprocessedExt,
  atlas: Map<GLTFMaterialPostprocessed, MaterialTextures>,
  node: GLTFNodePostprocessedExt,
  allTriangles: TriangleCPU[],
  allMaterials: MaterialCPU[],
  allLights: LightCPU[],
  worldMatrix: Mat4,
) {
  const normalMat = mat4.transpose(mat4.inverse(worldMatrix));

  // Process lights
  if (node.light !== undefined) {
    const lightIndex = node.light;
    const light = gltf.lights[lightIndex];
    if (light.type === 'directional') {
      const rotation = quat.fromMat(worldMatrix);
      const lightCPU: LightCPU = {
        position: vec3.transformQuat(vec3.create(0.0, 0.0, -1.0), rotation),
        lightType: 1,
        color: light.color
          ? vec3.create(light.color[0], light.color[1], light.color[2])
          : vec3.create(1.0, 1.0, 1.0),
        intensity: light.intensity ?? 1.0,
        triangleIndex: 0,
      };
      allLights.push(lightCPU);
      console.log(`directional light: `, lightCPU);
    } else if (light.type === 'point') {
      const lightCPU: LightCPU = {
        position: vec3.transformMat4(vec3.create(0.0, 0.0, 0.0), worldMatrix),
        lightType: 2,
        color: light.color
          ? vec3.create(light.color[0], light.color[1], light.color[2])
          : vec3.create(1.0, 1.0, 1.0),
        intensity: light.intensity ?? 1.0,
        triangleIndex: 0,
      };
      allLights.push(lightCPU);
      console.log(`point light: `, lightCPU);
    } else {
      console.warn(`Unsupported light type: ${light.type}`);
    }
  }

  // Process mesh
  if (node.mesh) {
    for (const primitive of node.mesh.primitives) {
      const position = primitive.attributes['POSITION'];
      const normal = primitive.attributes['NORMAL'];
      const uv = primitive.attributes['TEXCOORD_0'];
      const index = primitive.indices;

      // Transform positions and normals by world matrix
      const transformedPosition = new Float32Array(position.value.length);
      const transformedNormal = new Float32Array(normal.value.length);

      for (let i = 0; i < position.value.length; i += 3) {
        const pos = vec3.transformMat4(
          vec3.create(
            position.value[i],
            position.value[i + 1],
            position.value[i + 2],
          ),
          worldMatrix,
        );
        transformedPosition[i] = pos[0];
        transformedPosition[i + 1] = pos[1];
        transformedPosition[i + 2] = pos[2];

        const norm = vec3.create(
          normal.value[i],
          normal.value[i + 1],
          normal.value[i + 2],
        );
        vec3.transformMat4Upper3x3(norm, normalMat, norm);
        vec3.normalize(norm, norm);
        transformedNormal[i] = norm[0];
        transformedNormal[i + 1] = norm[1];
        transformedNormal[i + 2] = norm[2];
      }

      // build triangles with transformed vertices
      const triangles = buildTriangles(
        transformedPosition,
        transformedNormal,
        uv?.value as Float32Array,
        index?.value as Uint16Array,
      );

      // build material
      const material = buildMaterial(primitive.material, atlas);
      allMaterials.push(material);

      // apply material to triangles
      triangles.forEach((triangle) => {
        triangle.materialIndex = allMaterials.length - 1;
      });

      allTriangles.push(...triangles);
    }
  }
}

function buildTriangles(
  position: Float32Array,
  normal: Float32Array,
  uv: Float32Array,
  index: Uint16Array,
) {
  if (!index || index instanceof Uint32Array) {
    throw new Error('Uint32Array is not supported yet');
  }
  uv = uv ?? new Float32Array(position.length); // default uv (zero)

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
  atlas: Map<GLTFMaterialPostprocessed, MaterialTextures>,
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
      albedo: { x: 0.0, y: 0.0, w: 0.0, h: 0.0 },
      normal: { x: 0.0, y: 0.0, w: 0.0, h: 0.0 },
      pbr: { x: 0.0, y: 0.0, w: 0.0, h: 0.0 },
      emissive: { x: 0.0, y: 0.0, w: 0.0, h: 0.0 },
    };
  }

  const baseColor = material.pbrMetallicRoughness?.baseColorFactor ?? [
    1.0, 1.0, 1.0, 1.0,
  ];
  const metallic = material.pbrMetallicRoughness?.metallicFactor ?? 1.0;
  const roughness = material.pbrMetallicRoughness?.roughnessFactor ?? 1.0;

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
    albedo: atlas.get(material)?.albedo ?? { x: 0.0, y: 0.0, w: 0.0, h: 0.0 },
    normal: atlas.get(material)?.normal ?? { x: 0.0, y: 0.0, w: 0.0, h: 0.0 },
    pbr: atlas.get(material)?.pbr ?? { x: 0.0, y: 0.0, w: 0.0, h: 0.0 },
    emissive: atlas.get(material)?.emissive ?? {
      x: 0.0,
      y: 0.0,
      w: 0.0,
      h: 0.0,
    },
  };
}
