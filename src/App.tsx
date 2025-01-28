import { useEffect, useRef } from "react"
import { setupRenderer } from "./renderer/renderer"

function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null)


  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas) {
      setupRenderer(canvas)
    }
  }, [])

  return (
    <>
      <canvas ref={canvasRef} className="w-screen h-screen"/>
    </>
  )
}

export default App
