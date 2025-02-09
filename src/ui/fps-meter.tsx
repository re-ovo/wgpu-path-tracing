import { ComponentPropsWithoutRef, useEffect, useRef, useState } from 'react';

// Constants
const FPS_UPDATE_INTERVAL = 500; // Update FPS display every 500ms
const BUFFER_SIZE = 100; // History buffer size
const MAX_FPS = 160; // Maximum FPS value for chart scaling
const CHART_WIDTH = 200;
const CHART_HEIGHT = 60;

interface ChartProps {
  data: number[];
  maxValue: number;
  width: number;
  height: number;
  color?: string;
}

const Chart = ({
  data,
  maxValue,
  width,
  height,
  color = '#00ff00',
}: ChartProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    // Set drawing style
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;

    // Draw path
    ctx.beginPath();
    const step = width / (data.length - 1);

    data.forEach((value, index) => {
      const y = height - (value / maxValue) * height;
      const x = index * step;

      if (index === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });

    ctx.stroke();
  }, [data, maxValue, width, height, color]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      style={{
        backgroundColor: '#000',
        border: '1px solid #333',
      }}
    />
  );
};

interface FPSData {
  fps: number;
  frameTime: number; // in milliseconds
}

const FPSMeter = (props: ComponentPropsWithoutRef<'div'>) => {
  const frame = useRef<number>(null);
  const last = useRef(performance.now());
  const [elapsedTime, setElapsedTime] = useState(0);
  const [performanceData, setPerformanceData] = useState<FPSData>({
    fps: 0,
    frameTime: 0,
  });
  const [fpsHistory, setFpsHistory] = useState<number[]>([]);
  const [frameTimeHistory, setFrameTimeHistory] = useState<number[]>([]);

  // FPS calculation
  const lastUpdate = useRef(performance.now());
  const tempFpsBuffer = useRef<number[]>([]);
  const tempFrameTimeBuffer = useRef<number[]>([]);

  useEffect(() => {
    const animate = () => {
      const now = performance.now();
      const delta = now - last.current;
      const deltaSeconds = delta / 1000;

      // Update elapsed time
      setElapsedTime((prev) => prev + deltaSeconds);

      // Calculate current FPS and frame time
      const currentFps = 1000 / delta;
      const currentFrameTime = delta;

      // Update temporary buffers
      tempFpsBuffer.current.push(currentFps);
      tempFrameTimeBuffer.current.push(currentFrameTime);
      if (tempFpsBuffer.current.length > BUFFER_SIZE) {
        tempFpsBuffer.current.shift();
        tempFrameTimeBuffer.current.shift();
      }

      // Update display periodically
      if (now - lastUpdate.current >= FPS_UPDATE_INTERVAL) {
        const averageFps =
          tempFpsBuffer.current.reduce((a, b) => a + b, 0) /
          tempFpsBuffer.current.length;
        const averageFrameTime =
          tempFrameTimeBuffer.current.reduce((a, b) => a + b, 0) /
          tempFrameTimeBuffer.current.length;

        setPerformanceData({
          fps: averageFps,
          frameTime: averageFrameTime,
        });

        // Update chart data
        setFpsHistory([...tempFpsBuffer.current]);
        setFrameTimeHistory([...tempFrameTimeBuffer.current]);

        lastUpdate.current = now;
      }

      last.current = now;
      frame.current = requestAnimationFrame(animate);
    };

    frame.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame.current as number);
  }, []);

  return (
    <div {...props}>
      <div style={{ display: 'flex', gap: '16px', marginBottom: '4px' }}>
        <div>{elapsedTime.toFixed(1)} s</div>
        <div>{performanceData.fps.toFixed(0)} FPS</div>
        <div>{performanceData.frameTime.toFixed(1)} ms</div>
      </div>
      <div style={{ display: 'flex', gap: '8px' }}>
        <Chart
          data={fpsHistory}
          maxValue={MAX_FPS}
          width={CHART_WIDTH}
          height={CHART_HEIGHT}
          color="#00ff00"
        />
        <Chart
          data={frameTimeHistory}
          maxValue={1000 / 30} // 33.33ms (assuming 30 FPS as baseline)
          width={CHART_WIDTH}
          height={CHART_HEIGHT}
          color="#ff9900"
        />
      </div>
    </div>
  );
};

export default FPSMeter;
