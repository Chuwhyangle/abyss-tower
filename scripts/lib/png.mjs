// 零依赖 PNG 编解码：视觉基线只依赖 Node 内置 zlib。
// 解码覆盖 Chrome 截图会产出的 8 位灰度/RGB/RGBA 非隔行图；编码统一输出 RGBA（filter 0）。
import zlib from 'node:zlib';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const COLOR_CHANNELS = { 0: 1, 2: 3, 4: 2, 6: 4 };

// ── CRC32：PNG 每个 chunk 的校验和 ───────────────────────────────────────────
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(buffer) {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// ── 图像容器：RGBA，行优先，无 stride 填充 ───────────────────────────────────
export class RgbaImage {
  constructor(width, height, data = null) {
    if (!Number.isInteger(width) || width <= 0) throw new Error(`PNG 宽度非法：${width}`);
    if (!Number.isInteger(height) || height <= 0) throw new Error(`PNG 高度非法：${height}`);
    this.width = width;
    this.height = height;
    this.data = data || Buffer.alloc(width * height * 4);
    if (this.data.length !== width * height * 4) {
      throw new Error(`RGBA 数据长度不符：${this.data.length} != ${width * height * 4}`);
    }
  }

  pixel(x, y) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return [0, 0, 0, 0];
    const i = (y * this.width + x) * 4;
    return [this.data[i], this.data[i + 1], this.data[i + 2], this.data[i + 3]];
  }

  // 只读子矩形视图：越界部分按透明处理，调用方不需要再做边界裁剪。
  crop(x, y, width, height) {
    const out = new RgbaImage(width, height);
    for (let row = 0; row < height; row++) {
      const sy = y + row;
      for (let col = 0; col < width; col++) {
        const sx = x + col;
        if (sx < 0 || sy < 0 || sx >= this.width || sy >= this.height) continue;
        const from = (sy * this.width + sx) * 4;
        const to = (row * width + col) * 4;
        out.data[to] = this.data[from];
        out.data[to + 1] = this.data[from + 1];
        out.data[to + 2] = this.data[from + 2];
        out.data[to + 3] = this.data[from + 3];
      }
    }
    return out;
  }

  clippedRect(x, y, width, height) {
    const x0 = Math.max(0, Math.min(this.width, Math.round(x)));
    const y0 = Math.max(0, Math.min(this.height, Math.round(y)));
    const x1 = Math.max(x0, Math.min(this.width, Math.round(x + width)));
    const y1 = Math.max(y0, Math.min(this.height, Math.round(y + height)));
    return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
  }
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

export function decodePng(buffer) {
  const source = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  if (source.length < 8 || !source.subarray(0, 8).equals(SIGNATURE)) {
    throw new Error('不是合法的 PNG 数据（签名不符）');
  }
  let offset = 8;
  let header = null;
  const idat = [];
  while (offset + 8 <= source.length) {
    const length = source.readUInt32BE(offset);
    const type = source.toString('ascii', offset + 4, offset + 8);
    const body = source.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;
    if (type === 'IHDR') {
      header = {
        width: body.readUInt32BE(0),
        height: body.readUInt32BE(4),
        bitDepth: body[8],
        colorType: body[9],
        interlace: body[12],
      };
    } else if (type === 'IDAT') {
      idat.push(body);
    } else if (type === 'IEND') {
      break;
    }
  }
  if (!header) throw new Error('PNG 缺少 IHDR');
  if (header.bitDepth !== 8) throw new Error(`只支持 8 位 PNG，实际 ${header.bitDepth}`);
  if (header.interlace !== 0) throw new Error('不支持隔行 PNG');
  const channels = COLOR_CHANNELS[header.colorType];
  if (!channels) throw new Error(`不支持的 PNG 颜色类型：${header.colorType}`);

  const { width, height } = header;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  if (raw.length < (stride + 1) * height) {
    throw new Error(`PNG 数据不足：${raw.length} < ${(stride + 1) * height}`);
  }

  const image = new RgbaImage(width, height);
  let previous = Buffer.alloc(stride);
  let current = Buffer.alloc(stride);
  let pointer = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[pointer++];
    raw.copy(current, 0, pointer, pointer + stride);
    pointer += stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? current[i - channels] : 0;
      const b = previous[i];
      const c = i >= channels ? previous[i - channels] : 0;
      switch (filter) {
        case 0:
          break;
        case 1:
          current[i] = (current[i] + a) & 0xff;
          break;
        case 2:
          current[i] = (current[i] + b) & 0xff;
          break;
        case 3:
          current[i] = (current[i] + ((a + b) >> 1)) & 0xff;
          break;
        case 4:
          current[i] = (current[i] + paeth(a, b, c)) & 0xff;
          break;
        default:
          throw new Error(`未知 PNG 行过滤器：${filter}`);
      }
    }
    for (let x = 0; x < width; x++) {
      const from = x * channels;
      const to = (y * width + x) * 4;
      if (channels === 4) {
        image.data[to] = current[from];
        image.data[to + 1] = current[from + 1];
        image.data[to + 2] = current[from + 2];
        image.data[to + 3] = current[from + 3];
      } else if (channels === 3) {
        image.data[to] = current[from];
        image.data[to + 1] = current[from + 1];
        image.data[to + 2] = current[from + 2];
        image.data[to + 3] = 255;
      } else if (channels === 2) {
        image.data[to] = current[from];
        image.data[to + 1] = current[from];
        image.data[to + 2] = current[from];
        image.data[to + 3] = current[from + 1];
      } else {
        image.data[to] = current[from];
        image.data[to + 1] = current[from];
        image.data[to + 2] = current[from];
        image.data[to + 3] = 255;
      }
    }
    [previous, current] = [current, previous];
  }
  return image;
}

function chunk(type, body) {
  const out = Buffer.alloc(body.length + 12);
  out.writeUInt32BE(body.length, 0);
  out.write(type, 4, 'ascii');
  body.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), body])), body.length + 8);
  return out;
}

export function encodePng(image) {
  const { width, height, data } = image;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none —— 截图与小图用无过滤即可，压缩率足够。
    data.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// 最近邻缩放：contact sheet 只求可辨识，不引入插值带来的像素漂移。
export function resizeNearest(image, width, height) {
  const out = new RgbaImage(width, height);
  for (let y = 0; y < height; y++) {
    const sy = Math.min(image.height - 1, Math.floor(((y + 0.5) * image.height) / height));
    for (let x = 0; x < width; x++) {
      const sx = Math.min(image.width - 1, Math.floor(((x + 0.5) * image.width) / width));
      const from = (sy * image.width + sx) * 4;
      const to = (y * width + x) * 4;
      out.data[to] = image.data[from];
      out.data[to + 1] = image.data[from + 1];
      out.data[to + 2] = image.data[from + 2];
      out.data[to + 3] = image.data[from + 3];
    }
  }
  return out;
}

export function fillRect(image, x, y, width, height, [r, g, b, a = 255]) {
  const rect = image.clippedRect(x, y, width, height);
  for (let row = rect.y; row < rect.y + rect.height; row++) {
    for (let col = rect.x; col < rect.x + rect.width; col++) {
      const i = (row * image.width + col) * 4;
      image.data[i] = r;
      image.data[i + 1] = g;
      image.data[i + 2] = b;
      image.data[i + 3] = a;
    }
  }
}

// 把源图按目标尺寸完整贴进目标画布（保持最近邻；调用方负责算好位置）。
export function blit(target, source, x, y, width = source.width, height = source.height) {
  const scaled = width === source.width && height === source.height
    ? source
    : resizeNearest(source, width, height);
  const rect = target.clippedRect(x, y, width, height);
  for (let row = 0; row < rect.height; row++) {
    const sy = row + (rect.y - y);
    for (let col = 0; col < rect.width; col++) {
      const sx = col + (rect.x - x);
      const from = (sy * scaled.width + sx) * 4;
      const to = ((rect.y + row) * target.width + (rect.x + col)) * 4;
      target.data[to] = scaled.data[from];
      target.data[to + 1] = scaled.data[from + 1];
      target.data[to + 2] = scaled.data[from + 2];
      target.data[to + 3] = scaled.data[from + 3];
    }
  }
  return target;
}
