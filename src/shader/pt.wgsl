// 常量
const PI = 3.14159265359;
const EPSILON = 0.001;
const MAX_BOUNCES = 8;

// 结构体定义
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


// 光线结构
struct Ray {
    origin: vec3f,
    direction: vec3f,
}

// 相交信息
struct HitInfo {
    t: f32,
    position: vec3f,
    normal: vec3f,
    uv: vec2f,
    materialIndex: u32,
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
    closest.t = 9999999.0;
    
    for (var i = 0u; i < arrayLength(&triangles); i++) {
        let hit = rayTriangleIntersect(ray, triangles[i]);
        if (hit.t > 0.0 && hit.t < closest.t) {
            closest = hit;
        }
    }
    
    return closest;
}

// BRDF采样
fn sampleBRDF(normal: vec3f, material: Material) -> vec3f {
    let r = randomInUnitSphere();
    return normalize(normal + r);
}

// 路径追踪主函数
fn trace(ray: Ray) -> vec3f {
    var throughput = vec3f(1.0);
    var result = vec3f(0.0);
    var currentRay = ray;
    
    for (var bounce = 0; bounce < MAX_BOUNCES; bounce++) {
        let hit = sceneIntersect(currentRay);
        
        if (hit.t < 0.0) {
            // 未击中，返回环境光
            result += throughput * vec3f(0.3);  // 增加环境光强度
            break;
        }
        
        let material = materials[hit.materialIndex];
        
        // 添加自发光
        result += throughput * material.emission * material.emissiveStrength;
        
        // 俄罗斯轮盘赌 - 调整概率
        var p = max(max(material.baseColor.r, material.baseColor.g), material.baseColor.b);
        p = max(p, 0.25);  // 设置最小继续概率为0.25
        if (rand() > p) {
            break;
        }
        throughput /= p;
        
        // 生成新光线
        let newDir = sampleBRDF(hit.normal, material);
        currentRay = Ray(hit.position + hit.normal * EPSILON, newDir);
        
        // 更新throughput
        throughput *= material.baseColor;
    }
    
    return result;
}

// 计算着色器入口
@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) id: vec3u) {
    let dims = vec2u(camera.width, camera.height);
    if (id.x >= dims.x || id.y >= dims.y) {
        return;
    }

    initRNG(id.xy, camera.frameIndex);
    
    // 生成光线
    let pixel = vec2f(f32(id.x) + rand(), f32(id.y) + rand());
    let uv = (pixel / vec2f(dims)) * 2.0 - 1.0;
    
    let rayDir = normalize(
        camera.forward +
        uv.x * camera.right * tan(camera.fov * 0.5) * camera.aspect +
        uv.y * camera.up * tan(camera.fov * 0.5)
    );
    
    let ray = Ray(camera.position, rayDir);
    var color = trace(ray);
    
    // 累积多帧结果
    let bufferIndex = id.y * camera.width + id.x;  // 使用简单的线性索引
    if (camera.frameIndex > 0u) {
        let prevColor = outputBuffer[bufferIndex].rgb;
        let t = 1.0 / f32(camera.frameIndex + 1u);
        color = mix(prevColor, color, t);
    }

    // 输出颜色
    outputBuffer[bufferIndex] = color;
}
