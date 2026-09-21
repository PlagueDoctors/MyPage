varying vec3 vColor;
varying float vAlpha;

void main() {
  // 解析式软圆盘：不采样纹理，省掉一次 fetch 和一张 texture。
  // 用平方距离避免 sqrt —— 每个碎片都跑，省下来的就是填充率。
  vec2 uv = gl_PointCoord - 0.5;
  float d2 = dot(uv, uv);
  if (d2 > 0.25) discard;

  // 外缘柔和、核心略实，接近高斯核的观感
  float a = smoothstep(0.25, 0.015, d2);

  // 加色混合的 blend 是 (srcAlpha, one)，所以 color 乘以 alpha 后累加，
  // 密度自然表现为亮度 —— 稀疏处是星点，密集处聚成发光体。
  gl_FragColor = vec4(vColor, a * vAlpha);
}
