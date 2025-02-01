const PI = 3.14159265359;
const EPSILON = 1e-4;
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
    hit.t = -1.0;
    
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

// 场景相交测试
fn sceneIntersect(ray: Ray) -> HitInfo {
    var closest: HitInfo;
    closest.t = -1.0;  // 初始化为负值表示未命中
    var hasHit = false;
    
    for (var i = 0u; i < arrayLength(&triangles); i++) {
        let hit = rayTriangleIntersect(ray, triangles[i]);
        if (hit.t > 0.0 && (hit.t < closest.t || !hasHit)) {
            closest = hit;
            hasHit = true;
        }
    }
    
    return closest;
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

// 改进的BRDF采样
fn sampleBRDF(normal: vec3f, material: Material, hitPoint: vec3f) -> vec3f {
    var tangent = vec3f(1.0, 0.0, 0.0);
    if (abs(dot(normal, tangent)) > 0.9) {
        tangent = vec3f(0.0, 1.0, 0.0);
    }
    
    let bitangent = normalize(cross(normal, tangent));
    tangent = normalize(cross(bitangent, normal));
    
    // 构建TBN矩阵
    let tbn = mat3x3f(tangent, bitangent, normal);
    
    // 根据材质属性选择采样策略
    if (material.metallic > 0.5) {
        // 金属材质使用镜面反射
        let reflected = reflect(normalize(-hitPoint), normal);
        let scattered = randomCosineDirection();
        return normalize(mix(reflected, tbn * scattered, material.roughness));
    } else if (material.transmission > 0.5) {
        // 透明材质使用折射
        let eta = select(material.ior, 1.0 / material.ior, dot(normal, -hitPoint) > 0.0);
        var refracted = refract(normalize(-hitPoint), normal, eta);
        if (length(refracted) > 0.0) {
            return normalize(refracted);
        }
        return reflect(normalize(-hitPoint), normal);
    }
    
    // 漫反射材质
    return tbn * randomCosineDirection();
}

fn trace(ray: Ray) -> vec3f {
    var throughput = vec3f(1.0);
    var result = vec3f(0.0);
    var currentRay = ray;

    for (var bounce = 0; bounce < MAX_BOUNCES; bounce++) {
        let hit : HitInfo = sceneIntersect(currentRay);
        
        if (hit.t < 0.0) {
            // 使用基于HDR的环境光照
            let t = 0.5 * (currentRay.direction.y + 1.0);
            let skyColor = mix(
                vec3f(0.5, 0.7, 1.0), // 天空颜色
                vec3f(0.2, 0.2, 0.2), // 地平线颜色
                t
            );
            result += throughput * skyColor;
            break;
        }
        
        let material = materials[hit.materialIndex];
        
        // 添加自发光贡献
        if (length(material.emission) > 0.0) {
            result += throughput * material.emission * material.emissiveStrength;
            // 发光物体直接结束路径
            if (material.emissiveStrength > 0.0) {
                break;
            }
        }
        
        // 俄罗斯轮盘赌
        let p = max(max(throughput.r, throughput.g), throughput.b);
        if (bounce > 2 && rand() > p) {
            break;
        }
        throughput /= p;
        
        // 生成新光线方向
        let newDir = sampleBRDF(hit.normal, material, currentRay.direction);
        currentRay = Ray(hit.position + hit.normal * EPSILON, newDir);
        
        // 更新throughput
        let cosTheta = max(dot(newDir, hit.normal), 0.0);
        throughput *= material.baseColor * cosTheta;
        
        // 处理金属度
        if (material.metallic > 0.0) {
            throughput *= mix(vec3f(1.0), material.baseColor, material.metallic);
        }
        
        // 处理透明度
        if (material.transmission > 0.0) {
            throughput *= vec3f(1.0 - material.roughness);
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
