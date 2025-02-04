const PI = 3.14159265359;
const EPSILON = 1e-6;
const MAX_DEPTH = 24; // 最大遍历深度

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

// 获取遍历深度的颜色
fn getDepthColor(depth: f32) -> vec3f {
    return vec3f(depth, depth, depth);
}

// 计算BVH遍历深度
fn calculateBVHDepth(ray: Ray) -> f32 {
    var stack: array<u32, 64>; // BVH遍历栈
    var stackPtr: u32 = 0u;    // 栈指针
    var maxDepth: f32 = 0.0;   // 最大遍历深度
    
    // 从根节点开始
    stack[stackPtr] = 0u;
    stackPtr += 1u;
    
    while (stackPtr > 0u) {
        stackPtr -= 1u;
        let nodeIdx = stack[stackPtr];
        let node = bvhNodes[nodeIdx];
        
        // 更新最大深度
        maxDepth = max(maxDepth, f32(stackPtr));
        
        // 检查光线是否与当前节点的AABB相交
        if (!rayAABBIntersect(ray, node.aabb)) {
            continue;
        }
        
        // 如果不是叶子节点，将子节点压入栈中
        if (node.triangleCount == 0u) {
            stack[stackPtr] = node.right;
            stackPtr += 1u;
            stack[stackPtr] = node.left;
            stackPtr += 1u;
        }
    }
    
    return maxDepth / f32(MAX_DEPTH); // 归一化深度值
}

// 主计算着色器
@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) id: vec3u) {
    let dims = vec2u(camera.width, camera.height);
    if (id.x >= dims.x || id.y >= dims.y) {
        return;
    }

    let m = materials[0]; // force auto layout
    let aa = triangles[0]; // force auto layout
    
    let pixel = vec2f(f32(id.x) + 0.5, f32(id.y) + 0.5);
    let uv = (pixel / vec2f(dims)) * 2.0 - 1.0;
    
    let rayDir = normalize(
        camera.forward +
        uv.x * camera.right * tan(camera.fov * 0.5) * camera.aspect +
        uv.y * camera.up * tan(camera.fov * 0.5)
    );
    
    let ray = Ray(camera.position, rayDir);
    let depth = calculateBVHDepth(ray);
    let color = getDepthColor(depth);
    
    let bufferIndex = id.y * camera.width + id.x;
    outputBuffer[bufferIndex] = color;
} 