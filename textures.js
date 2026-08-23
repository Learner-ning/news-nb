// 程序化纹理（光晕、云朵）
import * as THREE from "/vendor/three/three.module.js";

export function makeRadialTexture(stops, size) {
  size = size || 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (let i = 0; i < stops.length; i++) {
    g.addColorStop(stops[i][0], stops[i][1]);
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

export function makeGlowTexture() {
  return makeRadialTexture([[0, "rgba(255,255,255,1)"], [0.3, "rgba(255,255,255,0.55)"], [1, "rgba(255,255,255,0)"]], 128);
}

export function makeCloudTexture() {
  return makeRadialTexture([[0, "rgba(255,255,255,0.95)"], [0.45, "rgba(255,255,255,0.5)"], [1, "rgba(255,255,255,0)"]], 128);
}
