// 动画与颜色工具
export function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
export function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
export function lerp(a, b, t) { return a + (b - a) * t; }

export function hexToRgb(hex) {
  let h = String(hex).replace("#", "");
  if (h.length === 3) {
    h = h.split("").map(function (c) { return c + c; }).join("");
  }
  const v = parseInt(h, 16);
  return { r: (v >> 16) & 255, g: (v >> 8) & 255, b: v & 255 };
}

export function rgbCss(c, a) {
  return "rgba(" + Math.round(c.r) + "," + Math.round(c.g) + "," + Math.round(c.b) + "," + (a == null ? 1 : a) + ")";
}

// 两个 hex 颜色插值，返回 rgba() 字符串
export function lerpColor(hexA, hexB, t, a) {
  const ca = hexToRgb(hexA);
  const cb = hexToRgb(hexB);
  return rgbCss({ r: lerp(ca.r, cb.r, t), g: lerp(ca.g, cb.g, t), b: lerp(ca.b, cb.b, t) }, a == null ? 1 : a);
}

// 两个 hex 颜色插值，返回 rgb() 字符串
export function mixHex(hexA, hexB, t) {
  const ca = hexToRgb(hexA);
  const cb = hexToRgb(hexB);
  return "rgb(" + Math.round(lerp(ca.r, cb.r, t)) + "," + Math.round(lerp(ca.g, cb.g, t)) + "," + Math.round(lerp(ca.b, cb.b, t)) + ")";
}
