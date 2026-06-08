const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const source = path.join(root, 'assets', 'app-icon.png');
const buildDir = path.join(root, 'build');
const iconsetDir = path.join(buildDir, 'icon.iconset');
const pngDir = path.join(buildDir, 'icon-pngs');

if (!fs.existsSync(source)) {
  throw new Error(`Missing icon source: ${source}`);
}

fs.rmSync(iconsetDir, { recursive: true, force: true });
fs.rmSync(pngDir, { recursive: true, force: true });
fs.mkdirSync(iconsetDir, { recursive: true });
fs.mkdirSync(pngDir, { recursive: true });
fs.copyFileSync(source, path.join(buildDir, 'icon.png'));

const macIcons = [
  [16, 'icon_16x16.png'],
  [32, 'icon_16x16@2x.png'],
  [32, 'icon_32x32.png'],
  [64, 'icon_32x32@2x.png'],
  [128, 'icon_128x128.png'],
  [256, 'icon_128x128@2x.png'],
  [256, 'icon_256x256.png'],
  [512, 'icon_256x256@2x.png'],
  [512, 'icon_512x512.png'],
  [1024, 'icon_512x512@2x.png']
];
for (const [size, name] of macIcons) {
  execFileSync('/usr/bin/sips', ['-z', String(size), String(size), source, '--out', path.join(iconsetDir, name)], { stdio: 'ignore' });
}
execFileSync('/usr/bin/iconutil', ['-c', 'icns', iconsetDir, '-o', path.join(buildDir, 'icon.icns')], { stdio: 'inherit' });

const windowsSizes = [16, 24, 32, 48, 64, 128, 256];
for (const size of windowsSizes) {
  execFileSync('/usr/bin/sips', ['-z', String(size), String(size), source, '--out', path.join(pngDir, `icon-${size}.png`)], { stdio: 'ignore' });
}
writeIco(
  windowsSizes.map((size) => ({
    size,
    data: fs.readFileSync(path.join(pngDir, `icon-${size}.png`))
  })),
  path.join(buildDir, 'icon.ico')
);

function writeIco(images, target) {
  const headerSize = 6 + images.length * 16;
  let offset = headerSize;
  const header = Buffer.alloc(headerSize);
  const parts = [];
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  images.forEach((image, index) => {
    const entry = 6 + index * 16;
    header.writeUInt8(image.size === 256 ? 0 : image.size, entry);
    header.writeUInt8(image.size === 256 ? 0 : image.size, entry + 1);
    header.writeUInt8(0, entry + 2);
    header.writeUInt8(0, entry + 3);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(image.data.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += image.data.length;
    parts.push(image.data);
  });
  fs.writeFileSync(target, Buffer.concat([header, ...parts]));
}
