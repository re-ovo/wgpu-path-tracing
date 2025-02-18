import potpack, { PotpackBox } from 'potpack';
import { GLTFPostprocessedExt } from './loader';
import {
  GLTFMaterialPostprocessed,
  GLTFTexturePostprocessed,
} from '@loaders.gl/gltf';

// 纹理缩放比例
// 以更低分辨率来构建atlas，可以减少显存占用和atlas大小
const TEXTURE_PIXEL_RATIO = 0.5;

export interface PackedAtlas {
  texture: OffscreenCanvas;
  materials: Map<GLTFMaterialPostprocessed, MaterialTextures>;
}

export interface MaterialTextures {
  albedoMap: AtlasTexture;
  normalMap: AtlasTexture;
  pbrMap: AtlasTexture;
  emissiveMap: AtlasTexture;
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
    const albedoTexture = material.pbrMetallicRoughness?.baseColorTexture;
    const pbrTexture = material.pbrMetallicRoughness?.metallicRoughnessTexture;
    const emissionTexture = material.emissiveTexture;

    const normalBox = toBox(normalTexture?.texture);
    const albedoBox = toBox(albedoTexture?.texture);
    const pbrBox = toBox(pbrTexture?.texture);
    const emissionBox = toBox(emissionTexture?.texture);

    materials.set(material, {
      albedoMap: albedoBox,
      normalMap: normalBox,
      pbrMap: pbrBox,
      emissiveMap: emissionBox,
    });

    if (normalBox) boxes.push(normalBox);
    if (albedoBox) boxes.push(albedoBox);
    if (pbrBox) boxes.push(pbrBox);
    if (emissionBox) boxes.push(emissionBox);
  }

  const { w, h } = potpack(boxes);
  console.log('Atlas size', w, h);

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
    w: width * TEXTURE_PIXEL_RATIO,
    h: height * TEXTURE_PIXEL_RATIO,
    x: 0,
    y: 0,
  };
}

function buildCanvas(
  size: number,
  materials: Map<GLTFMaterialPostprocessed, MaterialTextures>,
): OffscreenCanvas {
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) {
    throw new Error('Failed to create canvas context');
  }

  ctx.fillStyle = 'black';
  ctx.fillRect(0, 0, size, size);

  const drawTexture = async (
    info: AtlasTexture,
    material?: GLTFTexturePostprocessed,
    isAlbedo = false,
  ) => {
    if (!material) return;
    const img = material.source?.image as unknown as ImageBitmap;
    if (!img) return;
    console.log('draw', img);

    if (isAlbedo) {
      // 创建一个临时canvas来进行gamma矫正
      const tempCanvas = new OffscreenCanvas(info.w, info.h);
      const tempCtx = tempCanvas.getContext('2d');
      if (!tempCtx) return;

      // 绘制原始图像到临时canvas，需要考虑缩放
      tempCtx.drawImage(
        img,
        0,
        0,
        img.width,
        img.height, // 源图像的位置和尺寸
        0,
        0,
        info.w,
        info.h, // 目标位置和尺寸
      );

      // 获取像素数据
      const imageData = tempCtx.getImageData(0, 0, info.w, info.h);
      const data = imageData.data;

      // 进行gamma矫正 (sRGB to linear)
      for (let i = 0; i < data.length; i += 4) {
        data[i] = Math.pow(data[i] / 255, 2.2) * 255;
        data[i + 1] = Math.pow(data[i + 1] / 255, 2.2) * 255;
        data[i + 2] = Math.pow(data[i + 2] / 255, 2.2) * 255;
      }

      tempCtx.putImageData(imageData, 0, 0);
      // 将处理后的图像绘制到主canvas
      ctx.drawImage(tempCanvas, info.x, info.y);
    } else {
      // 对于非albedo纹理，直接绘制并缩放
      ctx.drawImage(
        img,
        0,
        0,
        img.width,
        img.height, // 源图像的位置和尺寸
        info.x,
        info.y,
        info.w,
        info.h, // 目标位置和尺寸
      );
    }
  };

  for (const [material, textures] of materials.entries()) {
    const { albedoMap, normalMap, pbrMap, emissiveMap } = textures;
    drawTexture(
      albedoMap,
      material.pbrMetallicRoughness?.baseColorTexture?.texture,
      true, // 标记为albedo纹理
    );
    drawTexture(normalMap, material.normalTexture?.texture);
    drawTexture(
      pbrMap,
      material.pbrMetallicRoughness?.metallicRoughnessTexture?.texture,
    );
    drawTexture(emissiveMap, material.emissiveTexture?.texture);
  }

  return canvas;
}
