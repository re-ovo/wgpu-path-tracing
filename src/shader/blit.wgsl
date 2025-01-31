// Blit shader

struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) uv: vec2f,
};

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
    // Define vertices for a full-screen quad
    const positions = array<vec2f, 4>(
        vec2f(-1.0, -1.0), // 左下
        vec2f(-1.0, 1.0), // 左上
        vec2f(1.0, -1.0), // 右下
        vec2f(1.0, 1.0), // 右上
    );
    
    const uvs = array<vec2f, 4>(
        vec2f(0.0, 1.0), // 左下
        vec2f(0.0, 0.0), // 左上
        vec2f(1.0, 1.0), // 右下
        vec2f(1.0, 0.0), // 右上
    );

    var output: VertexOutput;
    output.position = vec4f(positions[vertexIndex], 0.0, 1.0);
    output.uv = uvs[vertexIndex];
    return output;
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

@group(0) @binding(0) var<storage> colorBuffer: array<vec3f>;
@group(0) @binding(1) var<uniform> camera: Camera;

// Utility functions for color processing
fn ACES(x: vec3f) -> vec3f {
    let a = 2.51;
    let b = 0.03;
    let c = 2.43;
    let d = 0.59;
    let e = 0.14;
    return clamp((x * (a * x + b)) / (x * (c * x + d) + e), vec3f(0.0), vec3f(1.0));
}

fn gammaCorrect(color: vec3f) -> vec3f {
    return pow(color, vec3f(1.0/2.2));
}

@fragment
fn fragmentMain(@location(0) uv: vec2f) -> @location(0) vec4f {
    let x = u32(uv.x * f32(camera.width - 1));
    let y = u32((1.0 - uv.y) * f32(camera.height - 1));
    let index = y * camera.width + x;
    var color = colorBuffer[index];
    return vec4f(color, 1.0);
}