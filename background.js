// 背景管理模块：默认黑夜草原 / 白天草原 / 自定义图片 / 纯色 / 视频（预留）
export class BackgroundManager {
  constructor(opts) {
    this.bgEl = opts.bgEl;      // 背景层 DOM
    this.maskEl = opts.maskEl;  // 渐变遮罩 DOM
    this.onSceneChange = opts.onSceneChange || null; // (mode) => 切换 3D 场景元素显隐
    this.mode = "scene";
    this.videoEl = null;
    this.maskBase = 0.32;
    this.maskCurrent = 0.32;
    this.night = 1;
    this.time = 0;
  }

  // mode: scene | image | color | video
  setMode(mode, opts) {
    opts = opts || {};
    this.mode = mode;
    if (mode === "scene") {
      this.bgEl.style.backgroundImage = "";
      this.bgEl.style.backgroundColor = "";
      this.stopVideo();
    } else if (mode === "image") {
      const url = this.safeUrl(opts.url);
      if (!url) return;
      this.bgEl.style.backgroundImage =
        "linear-gradient(rgba(4,10,24,0.30),rgba(4,10,24,0.42)), url('" + url + "')";
      this.bgEl.style.backgroundSize = "cover";
      this.bgEl.style.backgroundPosition = "center";
      this.stopVideo();
    } else if (mode === "color") {
      this.bgEl.style.backgroundImage = "";
      this.bgEl.style.backgroundColor = opts.color || "#0b1220";
      this.stopVideo();
    } else if (mode === "video") {
      // 预留视频背景接口（未来扩展）
      const url = this.safeUrl(opts.url);
      if (!url) return;
      if (!this.videoEl) {
        this.videoEl = document.createElement("video");
        this.videoEl.autoplay = true;
        this.videoEl.muted = true;
        this.videoEl.loop = true;
        this.videoEl.playsInline = true;
        this.videoEl.style.cssText = "position:absolute;inset:0;width:100%;height:100%;object-fit:cover;";
        this.bgEl.appendChild(this.videoEl);
      }
      this.videoEl.src = url;
      this.videoEl.play().catch(function () {});
    }
    try { localStorage.setItem("ntree.bg", JSON.stringify({ mode: mode, opts: opts })); } catch (e) {}
    if (this.onSceneChange) this.onSceneChange(mode);
  }

  stopVideo() {
    if (this.videoEl) {
      this.videoEl.pause();
      this.videoEl.removeAttribute("src");
    }
  }

  // 场景模式下的天空渐变由昼夜系统写入
  setSkyGradient(css) {
    if (this.mode === "scene") {
      this.bgEl.style.backgroundImage = css;
      this.bgEl.style.backgroundColor = "";
    }
  }

  safeUrl(u) {
    if (!u) return "";
    const s = String(u).trim();
    if (s.indexOf("http://") === 0 || s.indexOf("https://") === 0 || s.indexOf("data:image/") === 0) return s;
    return "";
  }

  update(dt, night) {
    this.time += dt;
    this.night = night;
    let target = this.maskBase;
    if (this.mode === "scene") target = 0.18 + night * 0.22;
    else if (this.mode === "image" || this.mode === "video") target = 0.4;
    else target = 0.22;
    this.maskCurrent += (target - this.maskCurrent) * Math.min(1, dt * 2.2);
    this.maskEl.style.opacity = this.maskCurrent.toFixed(3);
  }
}
