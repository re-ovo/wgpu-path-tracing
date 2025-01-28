import tgpu, { TgpuRoot } from "typegpu";

export async function setupRenderer(canvas: HTMLCanvasElement) {
    const root = await tgpu.init();
    const context = canvas.getContext('webgpu');
    if (!context) {
        throw new Error("Failed to create WebGPU context");
    }
    context.configure({
        device: root.device,
        format: navigator.gpu.getPreferredCanvasFormat(),
    });
    return context;
}