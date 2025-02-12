import potpack, { PotpackBox } from 'potpack';
import { GLTFPostprocessedExt } from './loader';
import { GLTFMaterialPostprocessed } from '@loaders.gl/gltf';

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

export interface AtlasTexture {
    x: number;
    y: number;
    w: number;
    h: number;
}

export function packing(scene: GLTFPostprocessedExt) {
    for(const material of scene.materials) {
        const normalTexture = material.normalTexture
        const emissiveTexture = material.emissiveTexture
        const albedoTexture = material.pbrMetallicRoughness?.baseColorTexture
        const pbrTexture = material.pbrMetallicRoughness?.metallicRoughnessTexture
        
    }
}