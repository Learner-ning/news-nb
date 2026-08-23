// 沉浸式新闻树 · 全局配置
export const CONFIG = {
  maxDPR: 2, // 高 DPI 上限
  camera: {
    fov: 55,
    basePos: [0, 4.6, 9.6],
    lookAt: [0, 3.1, 0],
    parallax: 0.55 // 鼠标视差幅度
  },
  dayNight: { duration: 2.2 }, // 昼夜过渡秒数
  tree: {
    trunk: { height: 4.05, baseRadius: 0.52, topRadius: 0.09, density: 16 },
    branch: { density: 13, lengthBase: 1.55, lengthPerTwig: 0.14 },
    twig: { lengthBase: 0.8, density: 10 },
    leaf: {
      baseCount: 16, impCount: 30,
      baseRadius: 0.06, impRadius: 0.15,
      baseSize: 1.9, impSize: 2.6,
      baseAmp: 0.03, impAmp: 0.07,
      baseAlpha: 0.7, impAlpha: 0.3
    },
    woodSize: [1.3, 2.2],
    hoverSpread: 0.045,      // 悬停时粒子扩散幅度
    mousePushRadius: 1.15,   // 鼠标排斥半径
    mousePushStrength: 0.55
  },
  stars: { count: 1500, radiusMin: 55, radiusMax: 95, sizeMin: 0.9, sizeMax: 2.4 },
  interaction: { pickBase: 0.16, pickImp: 0.14 },
  ground: { size: 70, segments: 80 },
  card: { width: 320, offset: 28 } // 新闻卡片
};
