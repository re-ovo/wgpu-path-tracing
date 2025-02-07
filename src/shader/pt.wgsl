const PI = 3.14159265359;
const EPSILON = 1e-6;
const MAX_BOUNCES = 8;

struct Material {
    baseColor: vec3f,
    metallic: f32,
    roughness: f32,
    emission: vec3f,
    emissiveStrength: f32,
    ior: f32,
    transmission: f32,
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
    position: vec3f,    // 点光源的位置 或 方向光的方向(需要归一化)
    lightType: u32, // 光源类型
    color: vec3f, // 光源颜色
    intensity: f32, // 光源强度
    // 点光源参数
    radius: f32,        // 点光源的半径
    range: f32,         // 光照影响范围
    // 发光体参数
    triangleIndex: u32, // 发光三角形索引
    area: f32,         // 发光三角形面积(用于重要性采样)
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
    t: f32, // 距离
    position: vec3f, // 位置
    normal: vec3f, // 法线
    uv: vec2f, // 纹理坐标
    materialIndex: u32, // 材质索引
}
    
// 绑定组
@group(0) @binding(0) var<storage, read_write> outputBuffer: array<vec3f>;
@group(0) @binding(1) var<storage> triangles: array<Triangle>;
@group(0) @binding(2) var<storage> materials: array<Material>;
@group(0) @binding(3) var<uniform> camera: Camera;
@group(0) @binding(4) var<storage> bvhNodes: array<BVHNode>;

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

// 生成单位球内随机点
fn randomInUnitSphere() -> vec3f {
    let theta = rand() * 2.0 * PI;
    let phi = acos(2.0 * rand() - 1.0);
    let r = pow(rand(), 1.0/3.0);
    
    return vec3f(
        r * sin(phi) * cos(theta),
        r * sin(phi) * sin(theta),
        r * cos(phi)
    );
}

// 光线-三角形相交测试
fn rayTriangleIntersect(ray: Ray, triangle: Triangle) -> HitInfo {
    var hit: HitInfo;
    hit.t = -1.0f;
    
    let edge1 = triangle.v1 - triangle.v0;
    let edge2 = triangle.v2 - triangle.v0;
    let h = cross(ray.direction, edge2);
    let a = dot(edge1, h);
    
    if (abs(a) < EPSILON) {
        return hit;
    }
    
    let f = 1.0 / a;
    let s = ray.origin - triangle.v0;
    let u = f * dot(s, h);
    
    if (u < 0.0 || u > 1.0) {
        return hit;
    }
    
    let q = cross(s, edge1);
    let v = f * dot(ray.direction, q);
    
    if (v < 0.0 || u + v > 1.0) {
        return hit;
    }
    
    let t = f * dot(edge2, q);
    
    if (t > EPSILON) {
        hit.t = t;
        hit.position = ray.origin + t * ray.direction;
        
        // 计算重心坐标
        let w = 1.0 - u - v;
        hit.normal = normalize(w * triangle.n0 + u * triangle.n1 + v * triangle.n2);
        hit.uv = w * triangle.uv0 + u * triangle.uv1 + v * triangle.uv2;
        hit.materialIndex = triangle.materialIndex;
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

    let H = vec3f(
        sinTheta * cos(phi),
        sinTheta * sin(phi),
        cosTheta
    );

    return H;
}

fn sampleBSDF(material: Material, normal: vec3f, currentRay: Ray) -> BSDFSample {
    var sample: BSDFSample;
    
    // 入射方向
    let V = -normalize(currentRay.direction);
    
    // TBN Matrix
    let N = normal;
    let T = normalize(cross(N, select(vec3f(0.0, 1.0, 0.0), vec3f(1.0, 0.0, 0.0), abs(N.y) > 0.99)));
    let B = cross(N, T);
    let TBN = mat3x3f(T, B, N);

    // 基于概率采样光线
    let random = rand();
    let reflectProb = material.metallic;
    let refractProb = material.transmission * (1.0 - material.metallic);
    let diffuseProb = max(1.0 - reflectProb - refractProb, 0.0);

    if (random < reflectProb) {
        // 镜面反射采样
        let H = TBN * sampleGGXNormal(N, material.roughness);
        let L = normalize(reflect(-V, H));
        
        let F0 = mix(vec3f(0.04), material.baseColor, material.metallic);
        let F = fresnelSchlick(max(dot(H, V), 0.0), F0);
        
        // 修改PDF计算
        let NdotV = max(dot(N, V), 0.0);
        let NdotH = max(dot(N, H), 0.0);
        let VdotH = max(dot(V, H), 0.0);
        let NdotL = max(dot(N, L), 0.0);
        let D = distributionGGX(N, H, material.roughness);
        let G = geometrySmith(N, V, L, material.roughness);

        let pdf_val = (D * NdotH) / (4.0 * VdotH);
        
        sample.direction = L;
        sample.color = (F * D * G) / (4.0 * max(NdotV, 0.0001) * max(NdotL, 0.0001));
        sample.pdf = pdf_val * reflectProb;
    } else if (random < reflectProb + refractProb) {
        // 透射采样
        let eta = select(1.0 / material.ior, material.ior, dot(N, V) < 0.0);
        let N_t = select(N, -N, dot(N, V) < 0.0);
        let cosThetaI = dot(N_t, V);
        let sin2ThetaI = max(0.0, 1.0 - cosThetaI * cosThetaI);
        let sin2ThetaT = eta * eta * sin2ThetaI;

        if (sin2ThetaT < 1.0) {
            let cosThetaT = sqrt(1.0 - sin2ThetaT);
            let T = eta * V - (cosThetaT + eta * cosThetaI) * N_t;
            sample.direction = normalize(T);
            sample.color = vec3f(1.0); // Assuming no absorption for simplicity
            sample.pdf = refractProb;
        } else {
            // Total internal reflection
            sample.direction = reflect(V, N_t);
            sample.color = vec3f(1.0);
            sample.pdf = 1.0;
        }
    } else {
        // 漫反射采样
        let L = TBN * randomCosineDirection();
        let NdotL = max(dot(N, L), 0.0);
        
        let diffuse = (1.0 - material.metallic) * material.baseColor / PI * NdotL;
        let pdf = NdotL / PI;

        sample.direction = L;
        sample.color = diffuse;
        sample.pdf = pdf * diffuseProb;
    }
    
    return sample;
}

// 修改trace函数，移除PDF相关计算
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

        if (any(material.emission > vec3f(0.0))) {
            result += throughput * material.emission * material.emissiveStrength;
            break;
        }

        let bsdfSample = sampleBSDF(material, hit.normal, currentRay);
        throughput *= bsdfSample.color / max(bsdfSample.pdf, EPSILON);

        // 提前退出条件
        if (bounce > 2) {
            let p = max(max(throughput.x, throughput.y), throughput.z);
            if (rand() > p) {
                break;
            }
            throughput /= p;
        }

        // 更新光线方向
        currentRay = Ray(
            hit.position + hit.normal * EPSILON,
            normalize(bsdfSample.direction)
        );
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
