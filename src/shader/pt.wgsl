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
    position: vec3f, // (position or direction)
    lightType: u32, // light type (align)
    color: vec3f,
    intensity: f32,
    radius: f32, // only for point light
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
        
        // 计算几何法线
        let edge1 = triangle.v1 - triangle.v0;
        let edge2 = triangle.v2 - triangle.v0;
        let geometryNormal = normalize(cross(edge1, edge2));
        
        // 计算插值法线
        let w = 1.0 - u - v;
        let interpolatedNormal = normalize(
            triangle.n0 * w +
            triangle.n1 * u +
            triangle.n2 * v
        );
        
        // 确定光线是从正面还是背面击中三角形
        let facingFront = dot(geometryNormal, ray.direction) < 0.0;
        hit.isFront = facingFront;
        
        // 检查插值法线是否与几何法线方向一致
        // 如果不一致，使用几何法线
        if (facingFront) {
            // 如果是正面，插值法线应该朝向光线相反方向
            if (dot(interpolatedNormal, -ray.direction) < 0.0) {
                hit.normal = geometryNormal;
            } else {
                hit.normal = interpolatedNormal;
            }
        } else {
            // 如果是背面，插值法线应该朝向光线方向
            if (dot(interpolatedNormal, ray.direction) < 0.0) {
                hit.normal = -geometryNormal;
            } else {
                hit.normal = interpolatedNormal;
            }
        }
        
        // 插值UV
        hit.uv = 
            triangle.uv0 * w +
            triangle.uv1 * u +
            triangle.uv2 * v;
            
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

    let N = vec3f(
        sinTheta * cos(phi),
        sinTheta * sin(phi),
        cosTheta
    );

    let tbn = constructTBN(normal);
    return normalize(tbn * N);
}

struct LightSample {
    position: vec3f,
    pdf: f32,
    direction: vec3f,
    color: vec3f,
}

// 采样光源
fn sampleLight() -> LightSample {
    let light = lights[randInt(0u, arrayLength(&lights) - 1u)];
    let lightType = light.lightType;
    
    var sample: LightSample;
    
    switch lightType {
        case LIGHT_TYPE_EMISSIVE: {
            // 采样发光三角形
            let triangle = triangles[light.triangleIndex];
            
            // 在三角形上均匀采样一个点
            let r1 = rand();
            let r2 = rand();
            let sqrtR1 = sqrt(r1);
            
            let u = 1.0 - sqrtR1;
            let v = r2 * sqrtR1;
            let w = 1.0 - u - v;
            
            // 计算采样点位置
            sample.direction = triangle.v0 * w + triangle.v1 * u + triangle.v2 * v;
            
            // 计算三角形面积
            let edge1 = triangle.v1 - triangle.v0;
            let edge2 = triangle.v2 - triangle.v0;
            let triangleArea = length(cross(edge1, edge2)) * 0.5;
            
            // PDF是三角形面积的倒数除以光源的总数
            sample.pdf = 1.0 / (triangleArea * f32(arrayLength(&lights)));
            
            // 发光强度
            let material = materials[triangle.materialIndex];
            sample.color = material.emission * material.emissiveStrength;
            sample.position = triangle.v0 * w + triangle.v1 * u + triangle.v2 * v;
        }
        case LIGHT_TYPE_DIRECTIONAL: {
            // 方向光
            sample.direction = -normalize(light.position);
            sample.pdf = 1.0;
            sample.color = light.color * light.intensity;
            sample.position = light.position;
        }
        case LIGHT_TYPE_POINT: {
            // 点光源
            // 在球形光源表面上采样一个点
            let r1 = rand();
            let r2 = rand();
            let cosTheta = 2.0 * r1 - 1.0;
            let sinTheta = sqrt(1.0 - cosTheta * cosTheta);
            let phi = 2.0 * PI * r2;
            
            let x = sinTheta * cos(phi);
            let y = sinTheta * sin(phi);
            let z = cosTheta;
            
            let randomDir = vec3f(x, y, z);
            sample.direction = light.position + randomDir * light.radius;
            
            // PDF是球体表面积的倒数
            sample.pdf = 1.0 / (4.0 * PI * light.radius * light.radius);
            sample.color = light.color * light.intensity;
            sample.position = light.position;
        }
        default: {
            // 默认返回无效光源
            sample.pdf = 0.0;
            sample.direction = vec3f(0.0);
            sample.color = vec3f(0.0);
            sample.position = vec3f(0.0);
        }
    }
    
    return sample;
}

// MIS 权重计算
fn powerHeuristic(nf: f32, fPdf: f32, ng: f32, gPdf: f32) -> f32 {
    let f = nf * fPdf;
    let g = ng * gPdf;
    return (f * f) / (f * f + g * g);
}

fn sampleBSDF(material: Material, normal: vec3f, currentRay: Ray, front: bool) -> BSDFSample {
    var sample: BSDFSample;

    // 计算视线方向（从表面点指向相机）
    let V = -normalize(currentRay.direction);
    let NdotV = max(dot(normal, V), 0.0);
    
    // 基础反射率F0，金属材质使用baseColor，非金属使用0.04
    let F0 = mix(vec3f(0.04), material.baseColor, material.metallic);
    
    // 根据材质属性计算各种BSDF的概率
    let diffuseProb = (1.0 - material.metallic) * (1.0 - material.transmission);
    let specularProb = material.metallic;
    let transmissionProb = (1.0 - material.metallic) * material.transmission;
    
    // 随机选择BSDF类型
    let r = rand();
    
    if (r < diffuseProb) {
        // 漫反射采样
        let localDir = randomCosineDirection();
        let TBN = constructTBN(normal);
        sample.direction = TBN * localDir;
        
        // 计算漫反射BRDF
        let diffuseColor = material.baseColor * (1.0 - material.metallic);
        sample.color = diffuseColor / PI;
        sample.pdf = max(dot(normal, sample.direction), 0.0) / PI * diffuseProb;
        
    } else if (r < diffuseProb + specularProb) {
        // 镜面反射采样（GGX）
        let roughness = max(material.roughness, 0.04);
        let N = sampleGGXNormal(normal, roughness);

        sample.direction = reflect(-V, N);

        // 计算半角向量
        let H = normalize(V + sample.direction);

        let NdotH = max(dot(N, H), 0.0);
        let NdotL = max(dot(N, V), 0.0);
        let HdotV = max(dot(H, sample.direction), 0.0);

        // 计算镜面BRDF
        let D = distributionGGX(N, H, roughness);
        let G = geometrySmith(N, V, sample.direction, roughness);
        let F = fresnelSchlick(HdotV, F0);

        let color = (D * G * F) / max(4.0 * NdotV * NdotL, EPSILON);
        sample.color = color;
        sample.pdf = (D * NdotH / (4.0 * HdotV)) * specularProb;
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
            sample.direction = reflect(-V, N);
            sample.color = material.baseColor;
        } else {
            // 折射
            sample.direction = refract(-V, N, eta);
            sample.color = material.baseColor;
        }
        
        sample.pdf = transmissionProb;
    }
    
    return sample;
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
            // 添加基于距离的衰减
            let distance = hit.t;
            let attenuation = 1.0 / (1.0 + distance * distance);
            result += throughput * material.emission * material.emissiveStrength * attenuation;
            break;
        }

        let bsdfSample = sampleBSDF(material, hit.normal, currentRay, hit.isFront);
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
            hit.position + bsdfSample.direction * EPSILON,
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
