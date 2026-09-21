uniform float uMorph;
uniform float uSpin;
uniform float uTime;
uniform float uSize;
uniform float uSizeScale;
uniform float uFocal;
uniform float uAperture;
uniform float uJitter;
uniform float uMaxPointSize;
uniform float uAlpha;
uniform vec3 uShapeOrigin;
uniform float uShapeScale;
uniform vec3 uAccent;
uniform float uAccentMix;

attribute vec3 aTarget;
attribute float aSeed;
attribute float aMorphWeight;
attribute vec3 aColor;

varying vec3 vColor;
varying float vAlpha;

mat2 rot(float a) {
  float c = cos(a);
  float s = sin(a);
  return mat2(c, -s, s, c);
}

void main() {
  // ── 1. 聚合强度 ─────────────────────────────────────────────
  // aMorphWeight 让约三成粒子始终留在环境里。否则形状一成形背景就全空了，
  // 飞行感随之消失 —— 这是"看得出在移动"和"像张静态照片"的分界线。
  float m = smoothstep(0.0, 1.0, uMorph) * aMorphWeight;
  float ambient = 1.0 - aMorphWeight;

  // ── 2. 形状目标：缩放、局部自转，再平移到世界位置 ───────────
  // aTarget 是离线管线归一化到「半径 1」的局部坐标，所以尺寸完全由 uShapeScale 决定，
  // 换模型时不需要重新导出数据，改配置里的 scale 就行。
  vec3 tgt = aTarget * uShapeScale;
  tgt.xz = rot(uSpin) * tgt.xz;
  tgt.yz = rot(uSpin * 0.35) * tgt.yz;
  tgt += uShapeOrigin;

  // ── 3. 过渡扰动 ─────────────────────────────────────────────
  // burst = m(1-m)·4，在 m = 0.5 处取到最大值，于是"重排"最剧烈的时刻
  // 正好落在聚合的中段，首尾两端反而是安稳的。
  // 这是让过渡读起来像「星尘重排」而不是「随机乱抖」的关键。
  float burst = m * (1.0 - m) * 4.0;
  vec3 swirl = vec3(
    sin(uTime * 0.90 + aSeed * 62.83),
    cos(uTime * 0.70 + aSeed * 41.31),
    sin(uTime * 1.10 + aSeed * 27.18)
  );
  vec3 p = mix(position, tgt, m) + swirl * (burst * uJitter + ambient * 0.55);

  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float depth = max(-mv.z, 0.001);

  // ── 4. 伪景深 ───────────────────────────────────────────────
  // 弥散圆正比于「到对焦面的距离」。这就是参考站点所说的
  // "faked but very performant animated depth-of-field"：
  // 一行距离计算换来整片粒子的前后关系，没有任何后期处理、没有额外的 render target。
  float coc = clamp(abs(depth - uFocal) / max(uFocal, 0.001), 0.0, 1.0);
  float blur = coc * uAperture;

  // ── 5. 点尺寸 ───────────────────────────────────────────────
  // uSizeScale = drawingBufferHeight / (2·tan(fov/2))，
  // 于是 uSize 就是点的**世界空间直径**，与画布尺寸、dpr、fov 全部解耦。
  float size = uSize * uSizeScale / depth;
  size *= 1.0 + blur * 2.6;
  // 上限必须来自运行时查询的 ALIASED_POINT_SIZE_RANGE：
  // ANGLE(Windows Chrome/Edge 默认后端)与大量移动 GPU 会把它钳在 63/64，
  // 超出部分被静默截断 —— 桌面看着正常、一上手机景深就废，且没有任何报错。
  gl_PointSize = clamp(size, 0.75, uMaxPointSize);

  // ── 6. 亮度 ─────────────────────────────────────────────────
  // 加色混合下大量重叠极易过曝，两个补偿：
  //   · 越虚化越透明 —— 模糊的点不该比合焦的点更亮
  //   · 越聚合越透明 —— 80k 点挤在一个形状上时必须压低单点贡献
  float a = mix(1.0, 0.22, blur);
  a *= mix(1.0, 0.34, m);
  vAlpha = a * uAlpha;

  vColor = mix(aColor, uAccent, uAccentMix);
  gl_Position = projectionMatrix * mv;
}
