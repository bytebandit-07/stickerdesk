import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import type { WidgetStatePayload } from '../../electron/widgetManager';
import { buildStickerExtrudeGeometry } from '../lib/three/extrude';
import { createHoloMaterial } from './shaders/holo';

interface Widget3DProps {
  widgetState: WidgetStatePayload;
  serverBaseUrl: string;
}

interface DragSession {
  mode: 'move' | 'resize';
  startCursorScreenX: number;
  startCursorScreenY: number;
  startWindowX: number;
  startWindowY: number;
  startWidth: number;
}

const SUBTLE_TILT_RAD = THREE.MathUtils.degToRad(5);
const DYNAMIC_TILT_RAD = THREE.MathUtils.degToRad(15);
const HALF_RPM_RAD_PER_SEC = (0.5 * Math.PI * 2) / 60;

/**
 * Generates a procedural studio softbox environment map using PMREMGenerator
 * so glossy, epoxy, and metallic enamel surfaces show realistic studio light reflections.
 */
function createStudioEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const pmremGenerator = new THREE.PMREMGenerator(renderer);
  pmremGenerator.compileEquirectangularShader();

  const envScene = new THREE.Scene();
  envScene.background = new THREE.Color(0x1e222a);

  // Overhead warm-white main softbox strip
  const topSoftboxGeo = new THREE.PlaneGeometry(16, 6);
  const topSoftboxMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(3.2, 3.1, 3.0),
    side: THREE.DoubleSide,
  });
  const topSoftbox = new THREE.Mesh(topSoftboxGeo, topSoftboxMat);
  topSoftbox.position.set(0, 7, 5);
  topSoftbox.lookAt(0, 0, 0);
  envScene.add(topSoftbox);

  // Diagonal key rim light strip (gives epoxy domes and enamel pins a crisp specular catchlight)
  const keyStripGeo = new THREE.PlaneGeometry(5, 14);
  const keyStripMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(2.6, 2.8, 3.4),
    side: THREE.DoubleSide,
  });
  const keyStrip = new THREE.Mesh(keyStripGeo, keyStripMat);
  keyStrip.position.set(-7, 4, 6);
  keyStrip.lookAt(0, 0, 0);
  envScene.add(keyStrip);

  // Warm fill reflector on opposite side
  const fillStripGeo = new THREE.PlaneGeometry(8, 10);
  const fillStripMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(1.8, 1.6, 1.4),
    side: THREE.DoubleSide,
  });
  const fillStrip = new THREE.Mesh(fillStripGeo, fillStripMat);
  fillStrip.position.set(8, -3, 5);
  fillStrip.lookAt(0, 0, 0);
  envScene.add(fillStrip);

  const renderTarget = pmremGenerator.fromScene(envScene, 0.04);
  topSoftboxGeo.dispose();
  topSoftboxMat.dispose();
  keyStripGeo.dispose();
  keyStripMat.dispose();
  fillStripGeo.dispose();
  fillStripMat.dispose();
  pmremGenerator.dispose();

  return renderTarget.texture;
}

export const Widget3D: React.FC<Widget3DProps> = ({ widgetState, serverBaseUrl }) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isHovered, setIsHovered] = useState<boolean>(false);

  const dragSessionRef = useRef<DragSession | null>(null);
  const stateRef = useRef<WidgetStatePayload>(widgetState);
  stateRef.current = widgetState;

  const targetTiltRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const currentTiltRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const requestRenderRef = useRef<(() => void) | null>(null);

  // Non-passive wheel handler to block Chromium pinch/page zoom and only resize on Ctrl+Wheel
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      const current = stateRef.current;
      if (
        !e.ctrlKey ||
        current.locked ||
        current.clickThrough ||
        dragSessionRef.current !== null ||
        e.buttons !== 0
      ) {
        return;
      }
      const scaleFactor = e.deltaY < 0 ? 1.06 : 0.94;
      const nextWidth = Math.max(
        64,
        Math.min(1200, Math.round(window.innerWidth * scaleFactor))
      );
      window.stickerdesk.setWidgetBounds(current.id, { width: nextWidth });
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
    };
  }, []);

  // Standard DOM pointer dragging & resizing (zero -webkit-app-region: drag)
  useEffect(() => {
    const handleWindowMouseMove = (e: MouseEvent): void => {
      const session = dragSessionRef.current;
      const current = stateRef.current;
      if (!session || current.locked || current.clickThrough) {
        return;
      }

      if ((e.buttons & 1) === 0) {
        dragSessionRef.current = null;
        return;
      }

      const deltaX = e.screenX - session.startCursorScreenX;
      const deltaY = e.screenY - session.startCursorScreenY;

      if (session.mode === 'move') {
        window.stickerdesk.setWidgetBounds(current.id, {
          x: Math.round(session.startWindowX + deltaX),
          y: Math.round(session.startWindowY + deltaY),
        });
      } else if (session.mode === 'resize') {
        const nextWidth = Math.max(
          64,
          Math.min(1200, Math.round(session.startWidth + deltaX))
        );
        window.stickerdesk.setWidgetBounds(current.id, {
          width: nextWidth,
        });
      }
    };

    const handleWindowMouseUp = (): void => {
      dragSessionRef.current = null;
    };

    window.addEventListener('mousemove', handleWindowMouseMove);
    window.addEventListener('mouseup', handleWindowMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleWindowMouseMove);
      window.removeEventListener('mouseup', handleWindowMouseUp);
    };
  }, []);

  // Poll desktop cursor position ONLY when tiltMode !== 'none' (saves CPU when Still)
  useEffect(() => {
    if (widgetState.settings.tiltMode === 'none') {
      targetTiltRef.current = { x: 0, y: 0 };
      if (requestRenderRef.current) {
        requestRenderRef.current();
      }
      return;
    }

    let active = true;

    const pollCursor = async (): Promise<void> => {
      try {
        const pt = await window.stickerdesk.getCursorScreenPoint();
        if (!active) return;
        const centerX = window.screenX + window.innerWidth * 0.5;
        const centerY = window.screenY + window.innerHeight * 0.5;
        const normX = Math.max(-1, Math.min(1, (pt.x - centerX) / 420));
        const normY = Math.max(-1, Math.min(1, (pt.y - centerY) / 420));
        targetTiltRef.current = {
          x: normX,
          y: -normY,
        };
        if (requestRenderRef.current) {
          requestRenderRef.current();
        }
      } catch {
        // Ignore cursor polling errors
      }
    };

    void pollCursor();
    const interval = window.setInterval(() => {
      if (!document.hidden) {
        void pollCursor();
      }
    }, 45);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [widgetState.settings.tiltMode]);

  // Trigger a frame render whenever opacity, shadow, motion, or hover state updates
  useEffect(() => {
    if (requestRenderRef.current) {
      requestRenderRef.current();
    }
  }, [
    widgetState.opacity,
    widgetState.settings.shadowEnabled,
    widgetState.settings.tiltMode,
    widgetState.settings.animation,
    isHovered,
  ]);

  // Three.js Scene, Studio Environment, Physical Sticker Themes & On-Demand/Continuous Loop
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    let disposed = false;
    let animationFrameId = 0;
    let isLoopRunning = false;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(
      32,
      window.innerWidth / Math.max(1, window.innerHeight),
      1,
      1000
    );
    camera.position.set(0, 0, 215);

    const renderer = new THREE.WebGLRenderer({
      alpha: true,
      premultipliedAlpha: false,
      antialias: true,
      powerPreference: 'low-power',
    });
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;

    const envTexture = createStudioEnvironment(renderer);
    scene.environment = envTexture;

    mount.innerHTML = '';
    mount.appendChild(renderer.domElement);

    // Studio Lighting Rig
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.95);
    scene.add(ambientLight);

    const keyLight = new THREE.DirectionalLight(0xfffcf5, 1.85);
    keyLight.position.set(75, 125, 175);
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0xc7d2fe, 0.8);
    rimLight.position.set(-100, -75, 110);
    scene.add(rimLight);

    const rootGroup = new THREE.Group();
    scene.add(rootGroup);

    const pivotGroup = new THREE.Group();
    rootGroup.add(pivotGroup);

    let stickerMesh: THREE.Mesh | null = null;
    let shadowMesh: THREE.Mesh | null = null;
    let shadowGeo: THREE.PlaneGeometry | null = null;
    let shadowMat: THREE.MeshBasicMaterial | null = null;
    let stickerGeometry: THREE.ExtrudeGeometry | null = null;
    let stickerTexture: THREE.CanvasTexture | null = null;
    let contactShadowTexture: THREE.CanvasTexture | null = null;
    let frontMaterial: THREE.Material | null = null;
    let sideMaterial: THREE.MeshPhysicalMaterial | null = null;

    const buildThemeMaterials = (
      tex: THREE.CanvasTexture,
      sideCol: THREE.Color,
      theme: 'vinyl' | 'holographic' | 'epoxy' | 'enamel',
      opacity: number
    ): [THREE.Material, THREE.MeshPhysicalMaterial] => {
      if (theme === 'holographic') {
        const holoFront = createHoloMaterial(tex, opacity);
        const holoSide = new THREE.MeshPhysicalMaterial({
          color: sideCol,
          roughness: 0.25,
          metalness: 0.35,
          clearcoat: 0.8,
          transparent: true,
          opacity,
        });
        return [holoFront, holoSide];
      }

      if (theme === 'epoxy') {
        // Thick crystal-clear resin dome over vivid sticker print
        const epoxyFront = new THREE.MeshPhysicalMaterial({
          map: tex,
          roughness: 0.04,
          metalness: 0.02,
          clearcoat: 1.0,
          clearcoatRoughness: 0.03,
          reflectivity: 1.0,
          ior: 1.52,
          envMapIntensity: 1.45,
          transparent: true,
          alphaTest: 0.04,
          opacity,
          side: THREE.DoubleSide,
        });
        const epoxySide = new THREE.MeshPhysicalMaterial({
          color: sideCol.clone().lerp(new THREE.Color('#e0f2fe'), 0.18),
          roughness: 0.06,
          metalness: 0.05,
          clearcoat: 1.0,
          clearcoatRoughness: 0.04,
          ior: 1.52,
          envMapIntensity: 1.6,
          transparent: true,
          opacity: opacity * 0.92,
        });
        return [epoxyFront, epoxySide];
      }

      if (theme === 'enamel') {
        // Glossy enamel fill with raised polished metallic Gold lapel-pin rim
        const enamelFront = new THREE.MeshPhysicalMaterial({
          map: tex,
          roughness: 0.16,
          metalness: 0.12,
          clearcoat: 0.85,
          clearcoatRoughness: 0.12,
          envMapIntensity: 1.25,
          transparent: true,
          alphaTest: 0.04,
          opacity,
          side: THREE.DoubleSide,
        });
        const goldRimColor = new THREE.Color('#fbbf24');
        const enamelSide = new THREE.MeshPhysicalMaterial({
          color: goldRimColor,
          roughness: 0.18,
          metalness: 0.95,
          clearcoat: 0.6,
          envMapIntensity: 1.8,
          transparent: true,
          opacity,
        });
        return [enamelFront, enamelSide];
      }

      // Default: 'vinyl' (Classic Die-Cut Satin Vinyl Sticker)
      const vinylFront = new THREE.MeshPhysicalMaterial({
        map: tex,
        roughness: 0.45,
        metalness: 0.02,
        clearcoat: 0.25,
        clearcoatRoughness: 0.35,
        envMapIntensity: 0.75,
        transparent: true,
        alphaTest: 0.04,
        opacity,
        side: THREE.DoubleSide,
      });
      const vinylSide = new THREE.MeshPhysicalMaterial({
        color: sideCol,
        roughness: 0.55,
        metalness: 0.0,
        clearcoat: 0.15,
        transparent: true,
        opacity,
      });
      return [vinylFront, vinylSide];
    };

    const startTime = performance.now();
    let lastFrameTime = performance.now();
    const frameInterval = 1000 / 60;

    const renderSingleFrame = (now: number): boolean => {
      if (disposed || document.hidden) return false;

      const dt = Math.min(0.1, Math.max(0.008, (now - lastFrameTime) / 1000));
      const elapsedSec = (now - startTime) / 1000;
      const current = stateRef.current;

      const tiltMode = current.settings.tiltMode ?? 'subtle';
      const animMode = current.settings.animation ?? 'none';
      const shadowEnabled = current.settings.shadowEnabled ?? true;

      const maxTiltRad =
        tiltMode === 'dynamic'
          ? DYNAMIC_TILT_RAD
          : tiltMode === 'subtle'
          ? SUBTLE_TILT_RAD
          : 0;

      const desiredTiltX = tiltMode === 'none' ? 0 : targetTiltRef.current.x;
      const desiredTiltY = tiltMode === 'none' ? 0 : targetTiltRef.current.y;

      currentTiltRef.current.x +=
        (desiredTiltX - currentTiltRef.current.x) * Math.min(1, dt * 9);
      currentTiltRef.current.y +=
        (desiredTiltY - currentTiltRef.current.y) * Math.min(1, dt * 9);

      const tiltX = currentTiltRef.current.x;
      const tiltY = currentTiltRef.current.y;

      let rotX = -tiltY * maxTiltRad;
      let rotY = tiltX * maxTiltRad;
      let rotZ = 0;
      let posY = 0;

      if (animMode === 'float') {
        posY = Math.sin(elapsedSec * 2.1) * 4.2;
      } else if (animMode === 'spin') {
        rotY += elapsedSec * HALF_RPM_RAD_PER_SEC;
      } else if (animMode === 'sway') {
        rotZ = Math.sin(elapsedSec * 2.3) * THREE.MathUtils.degToRad(4.0);
        rotX += Math.cos(elapsedSec * 1.7) * THREE.MathUtils.degToRad(3.0);
      }

      pivotGroup.position.y = posY;
      pivotGroup.rotation.set(rotX, rotY, rotZ);

      // Subtle dynamic lighting shift with tilt so specular highlights glide across the surface
      keyLight.position.set(
        75 + tiltX * 65,
        125 + tiltY * 65,
        175
      );

      if (shadowMesh && shadowMat) {
        shadowMesh.visible = shadowEnabled;
        shadowMesh.position.x = -tiltX * 3.2;
        shadowMesh.position.y = posY - 2.6 - Math.abs(tiltY) * 1.5;
        shadowMat.opacity = current.opacity * 0.65;
      }

      if (frontMaterial instanceof THREE.ShaderMaterial) {
        frontMaterial.uniforms.uTime.value = elapsedSec;
        frontMaterial.uniforms.uTilt.value.set(tiltX, tiltY);
        frontMaterial.uniforms.uOpacity.value = current.opacity;
      } else if (frontMaterial) {
        frontMaterial.opacity = current.opacity;
      }

      if (sideMaterial) {
        sideMaterial.opacity =
          current.settings.theme === 'epoxy'
            ? current.opacity * 0.92
            : current.opacity;
      }

      renderer.render(scene, camera);

      const tiltSettled =
        Math.abs(desiredTiltX - currentTiltRef.current.x) < 0.002 &&
        Math.abs(desiredTiltY - currentTiltRef.current.y) < 0.002;

      // Keep looping if an idle animation is active, holographic shimmer is active with tilt, or tilt is still settling
      const needsContinuousFrames =
        animMode !== 'none' ||
        !tiltSettled ||
        (current.settings.theme === 'holographic' && tiltMode !== 'none');

      return needsContinuousFrames;
    };

    const tickLoop = (now: number): void => {
      if (disposed) {
        isLoopRunning = false;
        return;
      }

      const elapsedFrame = now - lastFrameTime;
      let keepGoing = true;

      if (elapsedFrame >= frameInterval) {
        keepGoing = renderSingleFrame(now);
        lastFrameTime = now - (elapsedFrame % frameInterval);
      }

      if (keepGoing) {
        animationFrameId = window.requestAnimationFrame(tickLoop);
      } else {
        // Freeze render loop completely (0% CPU/GPU) when Still & settled!
        isLoopRunning = false;
      }
    };

    const requestWakeRender = (): void => {
      if (disposed) return;
      if (!isLoopRunning) {
        isLoopRunning = true;
        lastFrameTime = performance.now() - frameInterval;
        animationFrameId = window.requestAnimationFrame(tickLoop);
      }
    };

    requestRenderRef.current = requestWakeRender;

    const imageUrl = `${serverBaseUrl}/files/stickers/${widgetState.stickerFilePath}`;
    const activeTheme = widgetState.settings.theme ?? 'vinyl';

    void buildStickerExtrudeGeometry(imageUrl, activeTheme)
      .then((res) => {
        if (disposed) {
          res.geometry.dispose();
          res.texture.dispose();
          res.shadowTexture.dispose();
          return;
        }
        stickerGeometry = res.geometry;
        stickerTexture = res.texture;
        contactShadowTexture = res.shadowTexture;

        const [fMat, sMat] = buildThemeMaterials(
          stickerTexture,
          res.sideColor,
          activeTheme,
          stateRef.current.opacity
        );
        frontMaterial = fMat;
        sideMaterial = sMat;

        stickerMesh = new THREE.Mesh(stickerGeometry, [frontMaterial, sideMaterial]);
        pivotGroup.add(stickerMesh);

        // Soft desktop contact shadow plane underneath the sticker
        const shadowScale = 1.14;
        shadowGeo = new THREE.PlaneGeometry(
          res.worldWidth * shadowScale,
          res.worldHeight * shadowScale
        );
        shadowMat = new THREE.MeshBasicMaterial({
          map: contactShadowTexture,
          transparent: true,
          opacity: stateRef.current.opacity * 0.65,
          depthWrite: false,
        });
        shadowMesh = new THREE.Mesh(shadowGeo, shadowMat);
        shadowMesh.position.set(0, -2.6, -res.extrudeDepth * 0.65 - 2.2);
        shadowMesh.visible = stateRef.current.settings.shadowEnabled ?? true;
        rootGroup.add(shadowMesh);

        requestWakeRender();
      })
      .catch((err: unknown) => {
        console.error('[StickerDesk 3D] Failed to build 3D sticker:', err);
      });

    const handleResize = (): void => {
      if (disposed) return;
      const w = window.innerWidth;
      const h = window.innerHeight;
      camera.aspect = w / Math.max(1, h);
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      requestWakeRender();
    };

    window.addEventListener('resize', handleResize);

    return () => {
      disposed = true;
      requestRenderRef.current = null;
      window.cancelAnimationFrame(animationFrameId);
      window.removeEventListener('resize', handleResize);
      envTexture.dispose();
      if (stickerGeometry) stickerGeometry.dispose();
      if (stickerTexture) stickerTexture.dispose();
      if (contactShadowTexture) contactShadowTexture.dispose();
      if (shadowGeo) shadowGeo.dispose();
      if (shadowMat) shadowMat.dispose();
      if (frontMaterial) frontMaterial.dispose();
      if (sideMaterial) sideMaterial.dispose();
      renderer.dispose();
    };
  }, [
    serverBaseUrl,
    widgetState.stickerFilePath,
    widgetState.settings.theme,
  ]);

  const handleMouseDownMove = (e: React.MouseEvent<HTMLDivElement>): void => {
    if (e.button !== 0 || widgetState.locked || widgetState.clickThrough) return;
    dragSessionRef.current = {
      mode: 'move',
      startCursorScreenX: e.screenX,
      startCursorScreenY: e.screenY,
      startWindowX: window.screenX,
      startWindowY: window.screenY,
      startWidth: window.innerWidth,
    };
  };

  const handleMouseDownResize = (e: React.MouseEvent<HTMLDivElement>): void => {
    e.stopPropagation();
    if (e.button !== 0 || widgetState.locked || widgetState.clickThrough) return;
    dragSessionRef.current = {
      mode: 'resize',
      startCursorScreenX: e.screenX,
      startCursorScreenY: e.screenY,
      startWindowX: window.screenX,
      startWindowY: window.screenY,
      startWidth: window.innerWidth,
    };
  };

  const handleContextMenu = (e: React.MouseEvent<HTMLDivElement>): void => {
    e.preventDefault();
    e.stopPropagation();
    dragSessionRef.current = null;
    window.stickerdesk.showWidgetContextMenu(widgetState.id);
  };

  const showResizeHandle = isHovered && !widgetState.locked && !widgetState.clickThrough;

  return (
    <div
      ref={containerRef}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onMouseDown={handleMouseDownMove}
      onContextMenu={handleContextMenu}
      style={{
        width: '100vw',
        height: '100vh',
        position: 'relative',
        overflow: 'hidden',
        backgroundColor: 'transparent',
        cursor: widgetState.locked ? 'default' : 'grab',
        userSelect: 'none',
      }}
    >
      <div
        ref={mountRef}
        style={{
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
        }}
      />

      {showResizeHandle && (
        <div
          onMouseDown={handleMouseDownResize}
          title="Drag to resize (or Ctrl + Scroll)"
          style={{
            position: 'absolute',
            right: '4px',
            bottom: '4px',
            width: '14px',
            height: '14px',
            borderRadius: '3px',
            backgroundColor: 'rgba(79, 70, 229, 0.9)',
            border: '1.5px solid #ffffff',
            cursor: 'nwse-resize',
            boxShadow: '0 1px 4px rgba(0,0,0,0.45)',
          }}
        />
      )}
    </div>
  );
};
