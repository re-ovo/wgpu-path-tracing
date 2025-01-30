struct Ray {
    origin: vec3f,
    direction: vec3f,
}

struct Triangle {
    v0: vec3f,
    v1: vec3f,
    v2: vec3f,
    material: u32,
}

struct Camera {
    position: vec3f,
    forward: vec3f,
    right: vec3f,
    up: vec3f,
    fov: f32,
}

struct Uniforms {
    camera: Camera,
    frame_count: u32,
    resolution: vec2f,
}

@group(0) @binding(0) var output_texture: texture_storage_2d<rgba8unorm, read_write>;
@group(0) @binding(1) var<uniform> uniforms: Uniforms;
@group(0) @binding(2) var<storage> triangles: array<Triangle>;

// 光线和三角形相交测试
fn ray_triangle_intersect(ray: Ray, triangle: Triangle) -> f32 {
    let edge1 = triangle.v1 - triangle.v0;
    let edge2 = triangle.v2 - triangle.v0;
    let h = cross(ray.direction, edge2);
    let a = dot(edge1, h);
    
    if (abs(a) < 0.0001) {
        return -1.0;
    }
    
    let f = 1.0 / a;
    let s = ray.origin - triangle.v0;
    let u = f * dot(s, h);
    
    if (u < 0.0 || u > 1.0) {
        return -1.0;
    }
    
    let q = cross(s, edge1);
    let v = f * dot(ray.direction, q);
    
    if (v < 0.0 || u + v > 1.0) {
        return -1.0;
    }
    
    let t = f * dot(edge2, q);
    if (t > 0.0001) {
        return t;
    }
    
    return -1.0;
}

// 生成随机数
fn wang_hash(seed: u32) -> u32 {
    var s = seed;
    s = (s ^ 61u) ^ (s >> 16u);
    s *= 9u;
    s = s ^ (s >> 4u);
    s *= 0x27d4eb2du;
    s = s ^ (s >> 15u);
    return s;
}

fn rand(seed: ptr<function, u32>) -> f32 {
    *seed = wang_hash(*seed);
    return f32(*seed) / f32(0xFFFFFFFFu);
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let resolution = vec2<u32>(uniforms.resolution);
    if (global_id.x >= resolution.x || global_id.y >= resolution.y) {
        return;
    }
    
    // 设置随机数种子
    var rng_state = wang_hash(global_id.x + global_id.y * resolution.x + uniforms.frame_count * 719393u);
    
    // 计算光线方向
    let pixel_pos = vec2f(global_id.xy) + vec2f(rand(&rng_state), rand(&rng_state));
    let uv = (pixel_pos / uniforms.resolution) * 2.0 - 1.0;
    
    var ray: Ray;
    ray.origin = uniforms.camera.position;
    ray.direction = normalize(
        uniforms.camera.forward +
        uv.x * uniforms.camera.right * tan(uniforms.camera.fov * 0.5) +
        uv.y * uniforms.camera.up * tan(uniforms.camera.fov * 0.5)
    );
    
    // 寻找最近的相交点
    var closest_t = 9999999.0;
    var hit_index = -1;
    
    for (var i = 0u; i < arrayLength(&triangles); i++) {
        let t = ray_triangle_intersect(ray, triangles[i]);
        if (t > 0.0 && t < closest_t) {
            closest_t = t;
            hit_index = i32(i);
        }
    }
    
    // 输出结果
    var color = vec4f(0.0);
    if (hit_index >= 0) {
        // 这里简化处理，直接输出一个固定颜色
        color = vec4f(1.0, 0.5, 0.2, 1.0);
    }
    
    // 与之前的帧进行混合
    if (uniforms.frame_count > 0) {
        let prev_color = textureLoad(output_texture, global_id.xy);
        color = mix(vec4f(prev_color), color, 1.0 / f32(uniforms.frame_count + 1));
    }
    
    textureStore(output_texture, global_id.xy, color);
}

