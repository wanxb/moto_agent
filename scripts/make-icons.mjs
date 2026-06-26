// 生成 PWA 图标（spec 016 T9.3）。几何 SVG → PNG，无字体依赖，maskable 安全区居中。
// 用法：node scripts/make-icons.mjs  （需 devDep sharp）
import sharp from 'sharp';

// 琥珀底 + 深色油滴（燃油主题），内容居中以兼容 maskable 安全区。
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#f59e0b"/>
  <path d="M256 130 C256 130 344 248 344 320 a88 88 0 1 1 -176 0 C168 248 256 130 256 130 Z" fill="#111827"/>
  <circle cx="226" cy="334" r="22" fill="#f59e0b" opacity="0.45"/>
</svg>`;

const buf = Buffer.from(svg);
for (const size of [192, 512]) {
  await sharp(buf).resize(size, size).png().toFile(`web/public/icon-${size}.png`);
  console.log(`✓ web/public/icon-${size}.png`);
}
