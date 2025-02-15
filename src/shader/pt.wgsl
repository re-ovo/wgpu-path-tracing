const PI = 3.14159265359;
const EPSILON = 1e-6;
const MAX_BOUNCES = 8;

struct AtlasTexture {
    x: u32,
    y: u32,
    w: u32,
    h: u32,
}

struct Material {
    baseColor: vec3f,
    metallic: f32,
    roughness: f32,
    emission: vec3f,
    emissiveStrength: f32,
    ior: f32,
    transmission: f32,
    albedo: AtlasTexture,
    normal: AtlasTexture,
    pbr: AtlasTexture,
    emissive: AtlasTexture,
}

struct Triangle {
    v0: vec3f,
    v1: vec3f,
    v2: vec3f,
    n0: vec3f,
    n1: vec3f,
    n2: vec3f,
    uv0: vec2f,
    uv1: vec2f,
    uv2: vec2f,
    materialIndex: u32,
}

const LIGHT_TYPE_EMISSIVE = 0u;
const LIGHT_TYPE_DIRECTIONAL = 1u;
const LIGHT_TYPE_POINT = 2u;

struct Light {
    position: vec3f, // (position or direction)
    lightType: u32, // light type (align)
    color: vec3f,
    intensity: f32,
    triangleIndex: u32, // only for emissive light
}

struct Camera {
    position: vec3f,
    forward: vec3f,
    right: vec3f,
    up: vec3f,
    fov: f32,
    aspect: f32,
    width: u32,
    height: u32,
    frameIndex: u32,
}

struct AABB {
    min: vec3f,
    max: vec3f,
}

struct BVHNode {
    aabb: AABB,
    left: u32,
    right: u32,
    triangleOffset: u32,
    triangleCount: u32,
}

struct Ray {
    origin: vec3f,
    direction: vec3f,
}

// 相交信息
struct HitInfo {
    position: vec3f, // 位置
    t: f32, // 距离
    normal: vec3f, // 法线
    materialIndex: u32, // 材质索引
    uv: vec2f, // 纹理坐标
    isFront: bool, // 是否正面
}
    
// 绑定组
@group(0) @binding(0) var<storage, read_write> outputBuffer: array<vec3f>;
@group(0) @binding(1) var<storage> triangles: array<Triangle>;
@group(0) @binding(2) var<storage> materials: array<Material>;
@group(0) @binding(3) var<uniform> camera: Camera;
@group(0) @binding(4) var<storage> bvhNodes: array<BVHNode>;
@group(0) @binding(5) var<storage> lights: array<Light>;
@group(0) @binding(6) var atlas: texture_2d<f32>;

// 随机数生成
var<private> rngState: u32;

fn initRNG(pixel: vec2u, frame: u32) {
    rngState = pixel.x + pixel.y * 1000u + frame * 100000u;
}

fn rand() -> f32 {
    rngState = rngState * 747796405u + 2891336453u;
    var result = ((rngState >> ((rngState >> 28u) + 4u)) ^ rngState) * 277803737u;
    result = (result >> 22u) ^ result;
    return f32(result) / 4294967295.0;
}

fn randInt(min: u32, max: u32) -> u32 {
    return min + u32(rand() * f32(max - min + 1));
}

fn getTextureColor(texture: AtlasTexture, uv: vec2f, fallback: vec4f) -> vec4f {
    // 如果纹理宽度或高度为0，返回默认值
    if (texture.w == 0u || texture.h == 0u) {
        return fallback;
    }
    
    // 计算纹理在图集中的实际UV坐标
    let atlasUV = vec2f(
        (f32(texture.x) + uv.x * f32(texture.w)),
        (f32(texture.y) + uv.y * f32(texture.h))
    );
    
    // 采样纹理
    return textureLoad(atlas, vec2u(atlasUV), 0);
}

// 光线-三角形相交测试
fn rayTriangleIntersect(ray: Ray, triangle: Triangle) -> HitInfo {
    var hit: HitInfo;
    hit.t = -1.0;
    
    // Möller-Trumbore 算法实现
    let edge1 = triangle.v1 - triangle.v0;
    let edge2 = triangle.v2 - triangle.v0;
    let h = cross(ray.direction, edge2);
    let a = dot(edge1, h);
    
    // 判断光线是否平行于三角形
    if (abs(a) < EPSILON) {
        return hit;
    }
    
    let f = 1.0 / a;
    let s = ray.origin - triangle.v0;
    let u = f * dot(s, h);
    
    // 检查u是否在有效范围
    if (u < 0.0 || u > 1.0) {
        return hit;
    }
    
    let q = cross(s, edge1);
    let v = f * dot(ray.direction, q);
    
    // 检查v和u+v是否在有效范围
    if (v < 0.0 || u + v > 1.0) {
        return hit;
    }
    
    // 计算交点距离
    let t = f * dot(edge2, q);
    if (t > EPSILON) {
        hit.t = t;
        hit.position = ray.origin + ray.direction * t;
        
        // 计算重心坐标
        let w = 1.0 - u - v;
        
        // 计算几何法线
        let geometryNormal = normalize(cross(edge1, edge2));
        
        // 计算插值法线
        let interpolatedNormal = normalize(
            triangle.n0 * w +
            triangle.n1 * u +
            triangle.n2 * v
        );
        
        // 计算切线空间
        // 计算切线和副切线
        let deltaPos1 = triangle.v1 - triangle.v0;
        let deltaPos2 = triangle.v2 - triangle.v0;
        let deltaUV1 = triangle.uv1 - triangle.uv0;
        let deltaUV2 = triangle.uv2 - triangle.uv0;
        
        let r = 1.0 / (deltaUV1.x * deltaUV2.y - deltaUV1.y * deltaUV2.x);
        let tangent = normalize((deltaPos1 * deltaUV2.y - deltaPos2 * deltaUV1.y) * r);
        let bitangent = normalize((deltaPos2 * deltaUV1.x - deltaPos1 * deltaUV2.x) * r);
        
        // 构建TBN矩阵
        let N = interpolatedNormal;
        let T = normalize(tangent - N * dot(N, tangent));
        let B = normalize(cross(N, T));
        let TBN = mat3x3f(T, B, N);
        
        // 计算插值UV坐标
        hit.uv = triangle.uv0 * w + triangle.uv1 * u + triangle.uv2 * v;
        hit.materialIndex = triangle.materialIndex;
        
        // 确定光线是从正面还是背面击中三角形
        let facingFront = dot(geometryNormal, ray.direction) < 0.0;
        hit.isFront = facingFront;
        
        // 获取材质
        let material = materials[hit.materialIndex];
        
        // 采样法线贴图
        let normalMap = getTextureColor(material.normal, hit.uv, vec4f(0.5, 0.5, 1.0, 1.0)).xyz;
        if (normalMap.x != 0.5 || normalMap.y != 0.5 || normalMap.z != 1.0) {
            // 将法线从 [0,1] 转换到 [-1,1] 空间
            let tangentNormal = normalMap * 2.0 - 1.0;
            
            // 将切线空间法线转换到世界空间
            let worldNormal = normalize(TBN * tangentNormal);

            hit.normal = worldNormal;
        } else {
            hit.normal = interpolatedNormal;
        }
    }
    
    return hit;
}


// 光线-AABB相交测试
fn rayAABBIntersect(ray: Ray, aabb: AABB) -> bool {
    let t1 = (aabb.min - ray.origin) / ray.direction;
    let t2 = (aabb.max - ray.origin) / ray.direction;
    
    let tmin = min(t1, t2);
    let tmax = max(t1, t2);
    
    let t_min = max(max(tmin.x, tmin.y), tmin.z);
    let t_max = min(min(tmax.x, tmax.y), tmax.z);
    
    return t_max >= t_min && t_max >= 0.0;
}

// BVH遍历函数
fn traverseBVH(ray: Ray) -> HitInfo {
    var stack: array<u32, 64>; // BVH遍历栈
    var stackPtr: u32 = 0u;    // 栈指针
    
    var closest: HitInfo;
    closest.t = -1.0;
    var hasHit = false;
    
    // 从根节点开始
    stack[stackPtr] = 0u;
    stackPtr += 1u;
    
    while (stackPtr > 0u) {
        stackPtr -= 1u;
        let nodeIdx = stack[stackPtr];
        let node = bvhNodes[nodeIdx];
        
        // 检查光线是否与当前节点的AABB相交
        if (!rayAABBIntersect(ray, node.aabb)) {
            continue;
        }
        
        // 如果是叶子节点，测试所有三角形
        if (node.triangleCount > 0u) {
            for (var i = 0u; i < node.triangleCount; i++) {
                let triIdx = node.triangleOffset + i;
                let hit = rayTriangleIntersect(ray, triangles[triIdx]);
                if (hit.t > 0.0 && (hit.t < closest.t || !hasHit)) {
                    closest = hit;
                    hasHit = true;
                }
            }
        } else {
            // 不是叶子节点，将子节点压入栈中
            // 注意：这里假设内部节点总是有两个子节点
            stack[stackPtr] = node.right;
            stackPtr += 1u;
            stack[stackPtr] = node.left;
            stackPtr += 1u;
        }
    }
    
    return closest;
}

// 修改场景相交测试函数，使用BVH
fn sceneIntersect(ray: Ray) -> HitInfo {
    return traverseBVH(ray);
}

// 改进的随机数生成
fn randomCosineDirection() -> vec3f {
    let r1 = rand();
    let r2 = rand();
    let z = sqrt(1.0 - r2);
    let phi = 2.0 * PI * r1;
    let x = cos(phi) * sqrt(r2);
    let y = sin(phi) * sqrt(r2);
    return vec3f(x, y, z);
}

struct BSDFSample {
    direction: vec3f,
    color: vec3f,
    pdf: f32,
}

// GGX 分布函数
fn distributionGGX(N: vec3f, H: vec3f, roughness: f32) -> f32 {
    let a = roughness * roughness;
    let a2 = a * a;
    let NdotH = max(dot(N, H), 0.0);
    let NdotH2 = NdotH * NdotH;

    let num = a2;
    let denom = (NdotH2 * (a2 - 1.0) + 1.0);
    return max(a2 / (PI * denom * denom), 0.0);
}

// 几何函数
fn geometrySchlickGGX(NdotV: f32, roughness: f32) -> f32 {
    let r = roughness + 1.0;
    let k = (r * r) / 8.0;
    return NdotV / (NdotV * (1.0 - k) + k);
}

fn geometrySmith(N: vec3f, V: vec3f, L: vec3f, roughness: f32) -> f32 {
    let NdotV = max(dot(N, V), 0.0);
    let NdotL = max(dot(N, L), 0.0);
    let ggx2 = geometrySchlickGGX(NdotV, roughness);
    let ggx1 = geometrySchlickGGX(NdotL, roughness);
    return ggx1 * ggx2;
}

// Fresnel-Schlick
fn fresnelSchlick(cosTheta: f32, F0: vec3f) -> vec3f {
    return F0 + (vec3f(1.0) - F0) * pow(1.0 - cosTheta, 5.0);
}

// GGX 法线分布采样
fn sampleGGXNormal(normal: vec3f, roughness: f32) -> vec3f {
    let r1 = rand();
    let r2 = rand();
    let a = roughness * roughness;
    let phi = 2.0 * PI * r1;
    let cosTheta = sqrt((1.0 - r2) / (1.0 + (a * a - 1.0) * r2));
    let sinTheta = sqrt(1.0 - cosTheta * cosTheta);

    let N = vec3f(
        sinTheta * cos(phi),
        sinTheta * sin(phi),
        cosTheta
    );

    let tbn = constructTBN(normal);
    return normalize(tbn * N);
}

struct LightSample {
    intensity: vec3f, // 光源颜色和强度
    lightType: u32, // 光源类型
    wi: vec3f, // 光源方向
    pdf: f32, // 概率密度
}

// 采样光源
fn sampleLight(in: Ray, hitPosition: vec3f) -> LightSample {
    let light = lights[randInt(0u, arrayLength(&lights) - 1u)];
    let lightType = light.lightType;
    
    var sample: LightSample;
    
    sample.lightType = lightType;
    sample.intensity = vec3f(0.0);
    sample.wi = vec3f(0.0);
    sample.pdf = 0.0;

    if (lightType == LIGHT_TYPE_DIRECTIONAL) {
        // 平行光采样
        // 方向已经在light.position中定义
        let wi = normalize(-light.position);
        
        // 检查是否有遮挡
        let shadowRay = Ray(hitPosition + wi * EPSILON, wi);
        let shadowHit = sceneIntersect(shadowRay);
        
        if (shadowHit.t > 0.0) {
            // 有遮挡，返回零贡献
            sample.intensity = vec3f(0.0);
            sample.wi = wi;
            sample.pdf = 0.0;
            return sample;
        }
        
        // 平行光不考虑距离衰减
        sample.intensity = light.color * light.intensity;
        sample.wi = wi;
        // 平行光的PDF是1，因为只有一个方向
        sample.pdf = 1.0 / f32(arrayLength(&lights)) * 1000.0;
    } else if (lightType == LIGHT_TYPE_POINT) {
        // 点光源采样
        let toLight = light.position - hitPosition;
        let dist = length(toLight);

        // 如果距离大于100.0，则忽略该光源
        if(dist > 100.0) {
            return sample;
        }
    
        let wi = toLight / dist;
        
        // 检查是否有遮挡
        let shadowRay = Ray(hitPosition + wi * EPSILON, wi);
        let shadowHit = sceneIntersect(shadowRay);
        
        if (shadowHit.t > 0.0 && shadowHit.t < dist - EPSILON * 2.0) {
            // 有遮挡，返回零贡献
            sample.intensity = vec3f(0.0);
            sample.wi = wi;
            sample.pdf = 0.0;
            return sample;
        }
        
        // 计算平方反比衰减
        let attenuation = 1.0 / (dist * dist);
        
        // 设置光源样本
        sample.intensity = light.color * light.intensity * attenuation;
        sample.wi = wi;
        // 点光源的PDF是1/numLights，因为只有一个采样点
        sample.pdf = 1.0 / f32(arrayLength(&lights)) * 10000.0;
    } else if (lightType == LIGHT_TYPE_EMISSIVE) {
        // 发光三角形采样
        let triangle = triangles[light.triangleIndex];
        
        // 均匀采样三角形上的一个点
        let r1 = rand();
        let r2 = rand();
        let u = 1.0 - sqrt(r1);
        let v = r2 * sqrt(r1);
        let w = 1.0 - u - v;
        
        // 计算采样点的位置
        let lightPos = triangle.v0 * w + triangle.v1 * u + triangle.v2 * v;
        
        // 计算三角形法线
        let normal = normalize(triangle.n0 * w + triangle.n1 * u + triangle.n2 * v);
        
        // 计算从着色点到光源的方向和距离
        let toLight = lightPos - hitPosition;
        let dist = length(toLight);
        let wi = toLight / dist;
        
        // 检查是否有遮挡
        let shadowRay = Ray(hitPosition + wi * EPSILON, wi);
        let shadowHit = sceneIntersect(shadowRay);
        
        if (shadowHit.t > 0.0 && shadowHit.t < dist - EPSILON * 2.0) {
            // 有遮挡，返回零贡献
            sample.intensity = vec3f(0.0);
            sample.wi = wi;
            sample.pdf = 0.0;
            return sample;
        }
        
        // 计算三角形面积
        let edge1 = triangle.v1 - triangle.v0;
        let edge2 = triangle.v2 - triangle.v0;
        let triangleArea = length(cross(edge1, edge2)) * 0.5;
        
        // 计算光源的PDF
        // PDF = (1/numLights) * (1/triangleArea) * (dist^2 / |cos(theta)|)
        let cosTheta = abs(dot(normal, -wi));
        sample.pdf = (1.0 / f32(arrayLength(&lights))) * (1.0 / triangleArea) * (dist * dist / max(cosTheta, EPSILON));
        
        // 设置光源样本
        sample.intensity = light.color * light.intensity;
        sample.wi = wi;
    }
    
    return sample;
}

// MIS 权重计算
fn powerHeuristic(nf: f32, fPdf: f32, ng: f32, gPdf: f32) -> f32 {
    let f = nf * fPdf;
    let g = ng * gPdf;
    return (f * f) / (f * f + g * g);
}

fn sampleBSDF(material: Material, normal: vec3f, currentRay: Ray, front: bool) -> vec3f {
    // 计算视线方向（从表面点指向相机）
    let V = -normalize(currentRay.direction);
    
    // 根据材质属性计算各种BSDF的概率
    let diffuseProb = (1.0 - material.metallic) * (1.0 - material.transmission);
    let specularProb = material.metallic;
    let transmissionProb = (1.0 - material.metallic) * material.transmission;
    
    // 随机选择BSDF类型
    let r = rand();
    
    if (r < diffuseProb) {
        // 漫反射采样 - 使用余弦加权的半球采样
        let localDir = randomCosineDirection();
        let TBN = constructTBN(normal);
        return TBN * localDir;
        
    } else if (r < diffuseProb + specularProb) {
        // 镜面反射采样
        let roughness = max(material.roughness, 0.04);
        let N = sampleGGXNormal(normal, roughness);
        return reflect(-V, N);
        
    } else {
        // 透射采样
        let eta = select(material.ior, 1.0 / material.ior, front);
        let roughness = max(material.roughness, 0.04);
        
        var N = sampleGGXNormal(normal, roughness);
        N = select(-N, N, front);
        
        let cosTheta = dot(N, V);
        let sinTheta = sqrt(1.0 - cosTheta * cosTheta);
        let cannotRefract = eta * sinTheta > 1.0;
        
        // 计算Fresnel反射率
        let F = reflectance(abs(cosTheta), eta);
        
        // 根据Fresnel和roughness决定是反射还是折射
        if (cannotRefract || (rand() < F)) {
            // 全反射或Fresnel反射
            return reflect(-V, N);
        } else {
            // 折射
            return refract(-V, N, eta);
        }
    }
}

fn evalBSDF(material: Material, hitInfo: HitInfo, normal: vec3f, V: vec3f, L: vec3f, front: bool) -> vec4f {
    // V is view direction (from surface to camera)
    // L is light direction (from surface to light)
    // Returns vec4f(bsdf_value.rgb, pdf)

    let albedo = getTextureColor(material.albedo, hitInfo.uv, vec4f(1.0)).xyz * material.baseColor;
    let pbr = getTextureColor(material.pbr, hitInfo.uv, vec4f(1.0)).xyz;
    let metallic = pbr.x * material.metallic;
    let roughness = max(pbr.y, 0.04);
    
    let H = normalize(V + L);
    let NdotL = max(dot(normal, L), 0.0);
    let NdotV = max(dot(normal, V), 0.0);
    let NdotH = max(dot(normal, H), 0.0);
    let VdotH = max(dot(V, H), 0.0);
    
    // 计算基础反射率 F0
    let F0 = mix(vec3f(0.04), albedo, metallic);
    
    // 计算 Fresnel 项
    let F = fresnelSchlick(VdotH, F0);
    
    // 计算几何项
    let G = geometrySmith(normal, V, L, roughness);
    
    // 计算法线分布项
    let D = distributionGGX(normal, H, roughness);
    
    // 计算漫反射项
    let kD = (1.0 - F) * (1.0 - metallic);
    let diffuse = kD * albedo / PI;
    
    // 计算镜面反射项
    let specular = F * G * D / max(4.0 * NdotV * NdotL, EPSILON);
    
    var bsdf = vec3f(0.0);
    var pdf = 0.0;
    
    // 计算透射项
    if (material.transmission > 0.0) {
        let eta = select(material.ior, 1.0 / material.ior, front);
        let cosTheta = dot(normal, V);
        let F_transmission = reflectance(abs(cosTheta), eta);
        
        if (front) {
            // 入射
            bsdf = (1.0 - F_transmission) * albedo;
            pdf = (1.0 - metallic) * material.transmission;
        } else {
            // 出射
            bsdf = (1.0 - F_transmission) * albedo;
            pdf = (1.0 - metallic) * material.transmission;
        }
    } else {
        // 漫反射和镜面反射的组合
        bsdf = (diffuse + specular) * NdotL;
        
        // 计算 PDF
        let diffuseProb = (1.0 - metallic) * (1.0 - material.transmission);
        let specularProb = metallic;
        
        // 漫反射的 PDF (余弦加权)
        let diffusePdf = NdotL / PI;
        
        // 镜面反射的 PDF
        let specularPdf = D * NdotH / (4.0 * VdotH);
        
        // 混合 PDF
        pdf = diffuseProb * diffusePdf + specularProb * specularPdf;
    }
    
    return vec4f(bsdf, max(pdf, EPSILON));
}

fn reflectance(cosTheta: f32, eta: f32) -> f32 {
    var r0 = (1.0 - eta) / (1.0 + eta);
    r0 = r0 * r0;
    return r0 + (1.0 - r0) * pow(1.0 - cosTheta, 5.0);
}


// 构建切线空间矩阵
fn constructTBN(N: vec3f) -> mat3x3f {
    // 创建一个正交基
    var T = vec3f(1.0, 0.0, 0.0);
    if (abs(N.x) > 0.9) {
        T = vec3f(0.0, 1.0, 0.0);
    }
    let B = normalize(cross(N, T));
    T = normalize(cross(B, N));
    
    return mat3x3f(T, B, N);
}

const DO_MIS = true;

fn trace(ray: Ray) -> vec3f {
    var throughput = vec3f(1.0); 
    var result = vec3f(0.0);
    var currentRay = ray;

    for (var bounce = 0; bounce < MAX_BOUNCES; bounce++) {
        let hit: HitInfo = sceneIntersect(currentRay);

        if (hit.t < 0.0) {
            result += throughput * vec3f(0.0);
            break;
        }

        let material = materials[hit.materialIndex];

        // 自发光
        if (any(material.emission > vec3f(0.0))) {
            // 添加基于距离的衰减
            let distance = hit.t;
            let attenuation = 1.0 / (1.0 + distance * distance);
            result += throughput * material.emission * material.emissiveStrength * attenuation;
            break;
        }

        // 只对非透射表面进行直接光照采样
        let transmissionProb = (1.0 - material.metallic) * material.transmission;
        if (DO_MIS && transmissionProb < 0.9) {  // 如果不是主要透射材质
            let lightSample = sampleLight(currentRay, hit.position);
            if(lightSample.pdf > 0.0) {
                let isDelta = lightSample.lightType == LIGHT_TYPE_DIRECTIONAL || lightSample.lightType == LIGHT_TYPE_POINT;
                
                // 计算BSDF
                let V = -normalize(currentRay.direction);
                let evalResult = evalBSDF(material, hit, hit.normal, V, lightSample.wi, hit.isFront);
                let bsdfValue = evalResult.xyz;
                let bsdfPdf = evalResult.w;

                // 计算MIS权重
                let misWeight = powerHeuristic(1.0, lightSample.pdf, 1.0, bsdfPdf);
                
                // 计算直接光照贡献
                let directLight = lightSample.intensity * bsdfValue * misWeight / max(lightSample.pdf, EPSILON);
                result += throughput * directLight;
            }
        }

        // 间接光照 - BSDF采样
        let bsdfDir = sampleBSDF(material, hit.normal, currentRay, hit.isFront);
        let evalResult = evalBSDF(material, hit, hit.normal, -normalize(currentRay.direction), bsdfDir, hit.isFront);
        let bsdfValue = evalResult.xyz;
        let bsdfPdf = evalResult.w;

        if (bsdfPdf <= 0.0) {
            break;
        }

        // 对于透射材质，需要考虑折射率变化导致的辐射度变化
        if (DO_MIS && transmissionProb > 0.0) {
            let eta = select(material.ior, 1.0 / material.ior, hit.isFront);
            throughput *= vec3f(eta * eta);
        }

        // 更新光线
        currentRay = Ray(
            hit.position + bsdfDir * EPSILON,
            normalize(bsdfDir)
        );

        // 更新吞吐量
        throughput *= bsdfValue / max(bsdfPdf, EPSILON);

        // 俄罗斯轮盘赌
        if (bounce > 2) {
            let p = max(max(throughput.x, throughput.y), throughput.z);
            if (rand() > p) {
                break;
            }
            throughput /= p;
        }
    }

    return result;
}

// 改进的主计算着色器
@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) id: vec3u) {
    let dims = vec2u(camera.width, camera.height);
    if (id.x >= dims.x || id.y >= dims.y) {
        return;
    }

    initRNG(id.xy, camera.frameIndex);

    let light = lights[0];
    
    let pixel = vec2f(f32(id.x) + rand(), f32(id.y) + rand());
    let uv = (pixel / vec2f(dims)) * 2.0 - 1.0;
    
    let rayDir = normalize(
        camera.forward +
        uv.x * camera.right * tan(camera.fov * 0.5) * camera.aspect +
        uv.y * camera.up * tan(camera.fov * 0.5)
    );
    
    let ray = Ray(camera.position, rayDir);
    var color = trace(ray);
  
    let bufferIndex = id.y * camera.width + id.x;
    if (camera.frameIndex > 0u) {
        // 累积采样
        let prevColor = outputBuffer[bufferIndex];
        let t = 1.0 / f32(camera.frameIndex + 1u);
        color = mix(prevColor, color, t);
    }

    outputBuffer[bufferIndex] = color;
}
