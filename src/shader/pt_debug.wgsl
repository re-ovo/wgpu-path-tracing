// 结构体定义
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

struct Material {
    baseColor: vec3f,
    metallic: f32,
    roughness: f32,
    emission: vec3f,
    emissiveStrength: f32,
    ior: f32,
    transmission: f32,
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

// 绑定组
@group(0) @binding(0) var<storage, read_write> outputBuffer: array<vec3f>;
@group(0) @binding(1) var<storage> triangles: array<Triangle>;
@group(0) @binding(2) var<storage> materials: array<Material>;
@group(0) @binding(3) var<uniform> camera: Camera;
@group(0) @binding(4) var<storage> bvhNodes: array<BVHNode>;

const EPSILON = 1e-6;

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
    closest.t = -1.0;
    var hasHit = false;
    
    for (var i = 0u; i < arrayLength(&triangles); i++) {
        let hit = rayTriangleIntersect(ray, triangles[i]);
        let material = materials[hit.materialIndex];
        if (hit.t > 0.0 && (hit.t < closest.t || !hasHit)) {
            closest = hit;
            hasHit = true;
        }

    }
    
    return closest;
}

// 将法线映射到颜色空间
fn normalToColor(normal: vec3f) -> vec3f {
    return (normal + 1.0) * 0.5;
}

// 计算着色器入口
@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) id: vec3u) {
    let dims = vec2u(camera.width, camera.height);
    if (id.x >= dims.x || id.y >= dims.y) {
        return;
    }

    let node = bvhNodes[0]; // force auto layout
    
    // 生成光线
    let pixel = vec2f(f32(id.x) + 0.5, f32(id.y) + 0.5);
    let uv = (pixel / vec2f(dims)) * 2.0 - 1.0;
    
    let rayDir = normalize(
        camera.forward +
        uv.x * camera.right * tan(camera.fov * 0.5) * camera.aspect +
        uv.y * camera.up * tan(camera.fov * 0.5)
    );
    
    let ray = Ray(camera.position, rayDir);
    let hit = sceneIntersect(ray);
    
    let bufferIndex = id.y * camera.width + id.x;
    
    if (hit.t > 0.0) {
        // 计算视线方向与法线的点积，判断是否是背面
        let viewDir = -rayDir;  // 视线方向是光线方向的反方向
        let facingFront = dot(viewDir, hit.normal) >= 0.0;
        
        if (facingFront) {
            // 正面显示法线颜色
            outputBuffer[bufferIndex] = normalToColor(hit.normal);

            // let material = materials[hit.materialIndex];
            // outputBuffer[bufferIndex] = vec3f(material.metallic);
        } else {
            // 背面显示红色
            outputBuffer[bufferIndex] = vec3f(1.0, 0.0, 0.0);
        }
    } else {
        // 如果没有击中，显示背景色
        outputBuffer[bufferIndex] = vec3f(0.0, 0.0, 0.0);
    }
}
