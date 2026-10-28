// 图集 / DPR 解析：清单条目 + 图集 JSON → 可直接绘制的帧几何与 CSS 背景样式。
// 纯函数，不持有加载状态，不触碰 document / Image / fetch（Node 下可直接 import）。
import { atlasFrame } from './sprite-manifest.js';

function firstFrameName(atlas) {
  const frames = atlas?.frames;
  if (!frames || typeof frames !== 'object') return null;
  const keys = Object.keys(frames);
  return keys.length ? keys[0] : null;
}

// 帧几何：图集条目按 frame 切图并乘以 DPR 变体；普通图片用整图 + pivot 落点。
// 图集未加载 / 帧名不存在 / 图片无尺寸一律返回 null（调用方走程序化绘制回退）。
export function frameGeometry({ image, scale, spec, atlasData, width, height }) {
  if (spec.atlas) {
    if (!atlasData) return null;
    const frame = atlasFrame(atlasData, spec.frame || firstFrameName(atlasData));
    if (!frame) return null;
    return {
      image,
      sx: frame.sx * scale,
      sy: frame.sy * scale,
      sw: frame.sw * scale,
      sh: frame.sh * scale,
      dw: frame.sourceW * scale,
      dh: frame.sourceH * scale,
      ax: frame.ax * scale,
      ay: frame.ay * scale,
      variantDpr: scale,
      trimmed: frame.trimmed,
      mode: 'atlas',
    };
  }
  if (!(width > 0) || !(height > 0)) return null;
  const pivot = spec.pivot;
  return {
    image,
    sx: 0,
    sy: 0,
    sw: width,
    sh: height,
    dw: width,
    dh: height,
    ax: pivot.x * width,
    ay: pivot.y * height,
    variantDpr: scale,
    trimmed: false,
    mode: 'image',
  };
}

// 帧几何 → 可直接落到 DOM 的 CSS 背景：逻辑像素尺寸 = 设备像素 / 变体档位。
export function spriteStyleFromFrame(id, url, frame) {
  const scale = frame.variantDpr;
  const image = frame.image;
  const imageWidth = image?.naturalWidth || image?.width || frame.sw;
  const imageHeight = image?.naturalHeight || image?.height || frame.sh;
  return {
    id,
    url,
    // 逻辑像素尺寸：帧几何按设备像素给出，除以变体档位回到 CSS 像素。
    width: frame.dw / scale,
    height: frame.dh / scale,
    backgroundImage: `url("${url}")`,
    backgroundPosition: `${-frame.sx / scale}px ${-frame.sy / scale}px`,
    backgroundSize: `${imageWidth / scale}px ${imageHeight / scale}px`,
  };
}
