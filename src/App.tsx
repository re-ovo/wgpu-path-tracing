import { useEffect, useRef, MutableRefObject } from 'react';
import { setupRenderer } from './renderer/renderer';
import { useDrop } from 'react-dnd';
import { NativeTypes } from 'react-dnd-html5-backend';

function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<
    Awaited<ReturnType<typeof setupRenderer>> | undefined
  >(undefined);

  const [{ isOver }, drop] = useDrop(() => ({
    accept: [NativeTypes.FILE],
    drop(item: { files: File[] }) {
      handleFileDrop(item.files);
    },
    collect: (monitor) => ({
      isOver: monitor.isOver(),
    }),
  }));

  const handleFileDrop = async (files: File[]) => {
    const glbFile = files.find((file) =>
      file.name.toLowerCase().endsWith('.glb'),
    );
    if (glbFile && rendererRef.current) {
      const url = URL.createObjectURL(glbFile);
      try {
        await rendererRef.current.loadModel(url);
      } finally {
        URL.revokeObjectURL(url);
      }
    }
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.width = canvas.clientWidth;
      canvas.height = canvas.clientHeight;
      setupRenderer(canvas).then((renderer) => {
        rendererRef.current = renderer;
      });
    }
  }, []);

  return (
    <div ref={drop} className="w-screen h-screen">
      <canvas
        ref={canvasRef}
        className={`w-full h-full ${isOver ? 'opacity-50' : ''}`}
      />
      {isOver && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="bg-white bg-opacity-90 p-4 rounded-lg shadow-lg">
            <p className="text-lg">Drag and drop GLB model file here</p>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
