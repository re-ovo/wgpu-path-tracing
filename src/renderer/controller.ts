import { clamp } from '../utils/math';
import { Renderer } from './renderer';

export class Controller {
  private renderer: Renderer;
  private canvas: HTMLCanvasElement;

  private isKeyPressed: Record<string, boolean> = {};
  private mouseMovement: { x: number; y: number } = { x: 0, y: 0 };

  private onKeyDown = (event: KeyboardEvent) => {
    this.isKeyPressed[event.key] = true;
  };

  private onKeyUp = (event: KeyboardEvent) => {
    this.isKeyPressed[event.key] = false;
  };

  private onCanvasClick = () => {
    // Request pointer lock when clicking on canvas
    this.canvas.requestPointerLock();
  };

  private onPointerLockChange = () => {
    // Handle pointer lock state changes
    if (document.pointerLockElement === this.canvas) {
      document.addEventListener('mousemove', this.onMouseMove);
    } else {
      document.removeEventListener('mousemove', this.onMouseMove);
    }
  };

  private onMouseMove = (event: MouseEvent) => {
    // Handle mouse movement when pointer is locked
    const movementX = event.movementX;
    const movementY = event.movementY;

    this.mouseMovement.x += movementX;
    this.mouseMovement.y += movementY;
  };

  constructor(renderer: Renderer, canvas: HTMLCanvasElement) {
    this.renderer = renderer;

    this.canvas = canvas;

    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    this.canvas.addEventListener('click', this.onCanvasClick);
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
  }

  public update(deltaTime: number) {
    const ratio = clamp(1 / deltaTime, 0, 250) * 0.2;

    if (this.isKeyPressed['w']) {
      this.renderer.moveCamera(0.01 * ratio, 0, 0);
    }

    if (this.isKeyPressed['s']) {
      this.renderer.moveCamera(-0.01 * ratio, 0, 0);
    }

    if (this.isKeyPressed['a']) {
      this.renderer.moveCamera(0, -0.01 * ratio, 0);
    }

    if (this.isKeyPressed['d']) {
      this.renderer.moveCamera(0, 0.01 * ratio, 0);
    }

    if (this.isKeyPressed[' ']) {
      this.renderer.moveCamera(0, 0, 0.01 * ratio);
    }

    if (this.isKeyPressed['Shift'] || this.isKeyPressed['q']) {
      this.renderer.moveCamera(0, 0, -0.005 * ratio);
    }

    if (this.mouseMovement.x !== 0 || this.mouseMovement.y !== 0) {
      this.renderer.rotateCamera(
        this.mouseMovement.x * -0.0001 * ratio,
        this.mouseMovement.y * -0.0001 * ratio,
      );
      this.mouseMovement.x = 0;
      this.mouseMovement.y = 0;
    }
  }

  public destroy() {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    this.canvas.removeEventListener('click', this.onCanvasClick);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    document.removeEventListener('mousemove', this.onMouseMove);
  }
}
