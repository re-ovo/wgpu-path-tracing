// Blit shader

@group(0) @binding(0)
var<uniform> src: texture_2d<f32>;

@group(0) @binding(1)
var sampler: sampler;

@vertex
fn vs_main(@builtin(vertex_index) vertex_index: u32) -> @location(0) vec4<f32> {
    var pos = array<vec4<f32>, 4>(
        vec4<f32>(-1.0, -1.0, 0.0, 1.0),
        vec4<f32>(1.0, -1.0, 0.0, 1.0),
        vec4<f32>(-1.0, 1.0, 0.0, 1.0),
        vec4<f32>(1.0, 1.0, 0.0, 1.0)
    );
    return pos[vertex_index];
}

@fragment
fn fs_main(@location(0) pos: vec4<f32>) -> @location(0) vec4<f32> {
    return textureSample(src, sampler, pos.xy);
}
