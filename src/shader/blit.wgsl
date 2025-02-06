// Define vertices for a full-screen quad
const positions = array<vec2f, 4>(
    vec2f(-1.0, -1.0), // 左下
    vec2f(-1.0, 1.0),  // 左上
    vec2f(1.0, -1.0),  // 右下
    vec2f(1.0, 1.0)    // 右上
);
const uvs = array<vec2f, 4>(
    vec2f(0.0, 1.0), // 左下
    vec2f(0.0, 0.0), // 左上
    vec2f(1.0, 1.0), // 右下
    vec2f(1.0, 0.0), // 右上
);

struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) uv: vec2f,
};

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
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

const EXPOSURE = 1.0;

fn gammaCorrect(color: vec3f) -> vec3f {
    return pow(color, vec3f(1.0 / 2.2));
}

fn exposureAdjust(color: vec3f, exposure: f32) -> vec3f {
    return color * exp2(exposure);
}

// AGX Tonemapping functions
fn agxDefaultContrastApprox(x: vec3f) -> vec3f {
    let x2 = x * x;
    let x4 = x2 * x2;
    
    return 15.5 * x4 * x2
           - 40.14 * x4 * x
           + 31.96 * x4
           - 6.868 * x2 * x
           + 0.4298 * x2
           + 0.1191 * x
           - 0.00232;
}

fn agx(val: vec3f) -> vec3f {
    let agx_mat = mat3x3f(
        0.842479062253094, 0.0423282422610123, 0.0423756549057051,
        0.0784335999999992, 0.878468636469772, 0.0784336,
        0.0792237451477643, 0.0791661274605434, 0.879142973793104
    );
    
    let min_ev = -12.47393;
    let max_ev = 4.026069;

    // Input transform (inset)
    var result = agx_mat * val;
    
    // Log2 space encoding
    result = clamp(log2(result), vec3f(min_ev), vec3f(max_ev));
    result = (result - min_ev) / (max_ev - min_ev);
    
    // Apply sigmoid function approximation
    return agxDefaultContrastApprox(result);
}

fn agxEotf(val: vec3f) -> vec3f {
    let agx_mat_inv = mat3x3f(
        1.19687900512017, -0.0528968517574562, -0.0529716355144438,
        -0.0980208811401368, 1.15190312990417, -0.0980434501171241,
        -0.0990297440797205, -0.0989611768448433, 1.15107367264116
    );
    
    // Inverse input transform (outset)
    let result = agx_mat_inv * val;
    
    // sRGB IEC 61966-2-1 2.2 Exponent Reference EOTF Display
    return pow(result, vec3f(2.2));
}

fn agxLook(val: vec3f) -> vec3f {
    let lw = vec3f(0.2126, 0.7152, 0.0722);
    let luma = dot(val, lw);
    
    // Default look
    let slope = vec3f(1.0);
    let power = vec3f(1.0);
    let sat = 1.0;
    
    // ASC CDL
    let result = pow(val * slope, power);
    return luma + sat * (result - luma);
}

fn toneMapping(color: vec3f) -> vec3f {
    var mapped = exposureAdjust(color, EXPOSURE);
    
    // AGX tone mapping
    mapped = agx(mapped);
    mapped = agxLook(mapped);
    mapped = agxEotf(mapped);
    
    return mapped;
}

@fragment
fn fragmentMain(@location(0) uv: vec2f) -> @location(0) vec4f {
    let x = u32(uv.x * f32(camera.width - 1));
    let y = u32((1.0 - uv.y) * f32(camera.height - 1));
    let index = y * camera.width + x;
    var color = colorBuffer[index];
    color = gammaCorrect(toneMapping(color));
    return vec4f(color, 1.0);
}