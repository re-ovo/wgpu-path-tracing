import { clamp } from '../utils/math';
import { Renderer } from './renderer';

export class Controller {
  private renderer: Renderer;
  private canvas: HTMLCanvasElement;

  private isKeyPressed: Record<string, boolean> = {};
  private mouseMovement: { x: number; y: number } = { x: 0, y: 0 };

  // 添加触摸相关状态
  private touchStartPosition: { x: number; y: number } | null = null;
  private lastTouchPosition: { x: number; y: number } | null = null;
  private isTwoFingerTouch = false;
  private touchDistance = 0;

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

  private onTouchStart = (event: TouchEvent) => {
    event.preventDefault();

    if (event.touches.length === 1) {
      const touch = event.touches[0];
      this.touchStartPosition = { x: touch.clientX, y: touch.clientY };
      this.lastTouchPosition = { x: touch.clientX, y: touch.clientY };
      this.isTwoFingerTouch = false;
    } else if (event.touches.length === 2) {
      this.isTwoFingerTouch = true;
      const touch1 = event.touches[0];
      const touch2 = event.touches[1];
      this.touchDistance = Math.hypot(
        touch1.clientX - touch2.clientX,
        touch1.clientY - touch2.clientY,
      );
    }
  };

  private onTouchMove = (event: TouchEvent) => {
    event.preventDefault();

    if (
      event.touches.length === 1 &&
      this.lastTouchPosition &&
      !this.isTwoFingerTouch
    ) {
      const touch = event.touches[0];
      const movementX = touch.clientX - this.lastTouchPosition.x;
      const movementY = touch.clientY - this.lastTouchPosition.y;

      this.mouseMovement.x += movementX;
      this.mouseMovement.y += movementY;

      this.lastTouchPosition = { x: touch.clientX, y: touch.clientY };
    } else if (event.touches.length === 2) {
      // 处理双指缩放
      const touch1 = event.touches[0];
      const touch2 = event.touches[1];
      const newDistance = Math.hypot(
        touch1.clientX - touch2.clientX,
        touch1.clientY - touch2.clientY,
      );

      // 根据距离变化移动摄像机前后
      const deltaDistance = newDistance - this.touchDistance;
      this.renderer.moveCamera(deltaDistance * 0.001, 0, 0);

      this.touchDistance = newDistance;
    }
  };

  private onTouchEnd = (event: TouchEvent) => {
    event.preventDefault();
    if (event.touches.length === 0) {
      this.touchStartPosition = null;
      this.lastTouchPosition = null;
      this.isTwoFingerTouch = false;
    }
  };

  constructor(renderer: Renderer, canvas: HTMLCanvasElement) {
    this.renderer = renderer;

    this.canvas = canvas;

    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    this.canvas.addEventListener('click', this.onCanvasClick);
    document.addEventListener('pointerlockchange', this.onPointerLockChange);

    // 添加触摸事件监听
    this.canvas.addEventListener('touchstart', this.onTouchStart, {
      passive: false,
    });
    this.canvas.addEventListener('touchmove', this.onTouchMove, {
      passive: false,
    });
    this.canvas.addEventListener('touchend', this.onTouchEnd, {
      passive: false,
    });
    this.canvas.addEventListener('touchcancel', this.onTouchEnd, {
      passive: false,
    });
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
    this.canvas.removeEventListener('touchstart', this.onTouchStart);
    this.canvas.removeEventListener('touchmove', this.onTouchMove);
    this.canvas.removeEventListener('touchend', this.onTouchEnd);
    this.canvas.removeEventListener('touchcancel', this.onTouchEnd);
  }
}
