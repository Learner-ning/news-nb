// 昼夜系统：平滑过渡天空、雾、星辰、日月云、树色
import { lerpColor } from "./anim.js";

const SKY = {
  night: { top: "#02030c", mid: "#0a1230", horizon: "#1c2c55" },
  day: { top: "#3f9fe8", mid: "#8ecdf2", horizon: "#dff0fa" }
};

export class DayNightSystem {
  constructor(opts) {
    this.bg = opts.bg; // BackgroundManager
    this.scene = opts.scene;
    this.duration = opts.duration || 2.2;
    this.night = 1;   // 当前值（平滑动画）
    this.target = 1;  // 目标值
    this.listeners = []; // (night, prevNight) => void
    this.fog = this.scene.fog;
  }

  addListener(fn) { this.listeners.push(fn); }

  setNight(v) {
    this.target = v < 0 ? 0 : v > 1 ? 1 : v;
    try { localStorage.setItem("ntree.night", this.target > 0.5 ? "night" : "day"); } catch (e) {}
  }

  toggle() { this.setNight(1 - this.target); }

  update(dt) {
    const prev = this.night;
    this.night += (this.target - this.night) * Math.min(1, dt / this.duration);
    if (Math.abs(this.night - this.target) < 0.001) this.night = this.target;
    const n = this.night;

    // 天空渐变（DOM 层）
    const css = "linear-gradient(180deg, " +
      lerpColor(SKY.day.top, SKY.night.top, n) + " 0%, " +
      lerpColor(SKY.day.mid, SKY.night.mid, n) + " 55%, " +
      lerpColor(SKY.day.horizon, SKY.night.horizon, n) + " 100%)";
    this.bg.setSkyGradient(css);

    // 雾色（与地平线一致）
    const fog = this.fog;
    if (fog) {
      const c = lerpColor(SKY.day.horizon, SKY.night.horizon, n, 1);
      const m = c.match(/(\d+)/g);
      if (m && m.length >= 3) {
        fog.color.setRGB(parseInt(m[0], 10) / 255, parseInt(m[1], 10) / 255, parseInt(m[2], 10) / 255);
      }
    }

    for (let i = 0; i < this.listeners.length; i++) this.listeners[i](n, prev);
  }
}
