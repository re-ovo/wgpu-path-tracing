import potpack, { PotpackBox } from 'potpack';
import { GLTFPostprocessedExt } from './loader';
import {
  GLTFMaterialPostprocessed,
  GLTFTexturePostprocessed,
} from '@loaders.gl/gltf';

export interface PackedAtlas {
  texture: OffscreenCanvas;
  materials: Map<GLTFMaterialPostprocessed, MaterialTextures>;
}

export interface MaterialTextures {
  albedo: AtlasTexture;
  normal: AtlasTexture;
  pbr: AtlasTexture;
  emissive: AtlasTexture;
}

// 纹理在atlas中的位置 (0~1)
export interface AtlasTexture {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function packing(scene: GLTFPostprocessedExt) {
  const boxes: PotpackBox[] = [];
  const materials: Map<GLTFMaterialPostprocessed, MaterialTextures> = new Map();

  for (const material of scene.materials) {
    const normalTexture = material.normalTexture;
    const emissiveTexture = material.emissiveTexture;
    const albedoTexture = material.pbrMetallicRoughness?.baseColorTexture;
    const pbrTexture = material.pbrMetallicRoughness?.metallicRoughnessTexture;

    const normalBox = toBox(normalTexture?.texture);
    const emissiveBox = toBox(emissiveTexture?.texture);
    const albedoBox = toBox(albedoTexture?.texture);
    const pbrBox = toBox(pbrTexture?.texture);

    materials.set(material, {
      albedo: albedoBox,
      normal: normalBox,
      pbr: pbrBox,
      emissive: emissiveBox,
    });

    if (normalBox) boxes.push(normalBox);
    if (emissiveBox) boxes.push(emissiveBox);
    if (albedoBox) boxes.push(albedoBox);
    if (pbrBox) boxes.push(pbrBox);
  }

  const { w, h } = potpack(boxes);

  // 构建atlas
  const textureSize = Math.max(
    1,
    Math.pow(2, Math.ceil(Math.log2(Math.max(w, h)))),
  );
  const canvas = buildCanvas(textureSize, materials);

  return {
    texture: canvas,
    materials,
  };
}

function toBox(texture?: GLTFTexturePostprocessed): AtlasTexture {
  const img = texture?.source?.image;
  if (!img) {
    return {
      w: 0,
      h: 0,
      x: 0,
      y: 0,
    };
  }
  const width = img?.width ?? 0;
  const height = img?.height ?? 0;
  return {
    w: width,
    h: height,
    x: 0,
    y: 0,
  };
}

function buildCanvas(
  size: number,
  materials: Map<GLTFMaterialPostprocessed, MaterialTextures>,
): OffscreenCanvas {
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Failed to create canvas context');
  }

  ctx.fillStyle = 'black';
  ctx.fillRect(0, 0, size, size);

  const drawTexture = async (
    info: AtlasTexture,
    material?: GLTFTexturePostprocessed,
  ) => {
    if (!material) return;
    const img = material.source?.image;
    if (!img) return;
    console.log('draw', img);
    // @ts-expect-error 类型错误
    ctx.drawImage(img, info.x, info.y, info.w, info.h);
  };

  for (const [material, textures] of materials.entries()) {
    const { albedo, normal, pbr, emissive } = textures;
    drawTexture(
      albedo,
      material.pbrMetallicRoughness?.baseColorTexture?.texture,
    );
    drawTexture(normal, material.normalTexture?.texture);
    drawTexture(
      pbr,
      material.pbrMetallicRoughness?.metallicRoughnessTexture?.texture,
    );
    drawTexture(emissive, material.emissiveTexture?.texture);
  }

  return canvas;
}
