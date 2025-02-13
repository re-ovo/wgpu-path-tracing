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
    position: vec3f, // 位置
    t: f32, // 距离
    normal: vec3f, // 法线
    materialIndex: u32, // 材质索引
    uv: vec2f, // 纹理坐标
    isFront: bool, // 是否正面
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

struct Light {
    position: vec3f, // (position or direction)
    lightType: u32, // light type (align)
    color: vec3f,
    intensity: f32,
    radius: f32, // only for point light
    triangleIndex: u32, // only for emissive light
}

// 绑定组
@group(0) @binding(0) var<storage, read_write> outputBuffer: array<vec3f>;
@group(0) @binding(1) var<storage> triangles: array<Triangle>;
@group(0) @binding(2) var<storage> materials: array<Material>;
@group(0) @binding(3) var<uniform> camera: Camera;
@group(0) @binding(4) var<storage> bvhNodes: array<BVHNode>;
@group(0) @binding(5) var<storage> lights: array<Light>;

const EPSILON = 1e-6;

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
    var stack: array<u32, 64>;
    var stackPtr: u32 = 0u;
    var closest: HitInfo;
    closest.t = -1.0;
    var hasHit = false;
    
    stack[stackPtr] = 0u;
    stackPtr += 1u;
    
    while (stackPtr > 0u) {
        stackPtr -= 1u;
        let nodeIdx = stack[stackPtr];
        let node = bvhNodes[nodeIdx];
        
        if (!rayAABBIntersect(ray, node.aabb)) {
            continue;
        }
        
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
            stack[stackPtr] = node.right;
            stackPtr += 1u;
            stack[stackPtr] = node.left;
            stackPtr += 1u;
        }
    }
    
    return closest;
}

// 更新场景相交测试函数，使用BVH
fn sceneIntersect(ray: Ray) -> HitInfo {
    return traverseBVH(ray);
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
    let lgt = lights[0];
    
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
        let viewDir = -rayDir;
        if (hit.isFront) {
            // 正面显示法线颜色
            outputBuffer[bufferIndex] = normalToColor(hit.normal);

            let material = materials[hit.materialIndex];
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
