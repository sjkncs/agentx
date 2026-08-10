// Minimal 256x256 ICO/PNG for use as the desktop app icon.
// electron-builder requires the icon to be at least 256x256.
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const W = 256;
const H = 256;

// --- PNG ---
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function crc32(buf) {
  let c;
  const table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8;
ihdr[9] = 6;
ihdr[10] = 0;
ihdr[11] = 0;
ihdr[12] = 0;

const raw = Buffer.alloc(H * (1 + W * 4));
let p = 0;
for (let y = 0; y < H; y++) {
  raw[p++] = 0;
  for (let x = 0; x < W; x++) {
    raw[p++] = 0xC0;
    raw[p++] = 0x60;
    raw[p++] = 0x40;
    raw[p++] = 0xFF;
  }
}
const idat = zlib.deflateSync(raw);
const png = Buffer.concat([
  sig,
  chunk("IHDR", ihdr),
  chunk("IDAT", idat),
  chunk("IEND", Buffer.alloc(0)),
]);

fs.writeFileSync(path.join(__dirname, "icon.png"), png);
console.log("wrote icon.png", png.length, "bytes");

// --- ICO (256x256, RGBA) ---
const HEADER = 40;
const PIXELS = W * H * 4;
const MASK_BYTES = Math.ceil(W / 8) * H;
const ICON_SIZE = HEADER + PIXELS + MASK_BYTES;
const OFFSET = 6 + 16;
const buf = Buffer.alloc(6 + 16 + ICON_SIZE);
let o = 0;
buf.writeUInt16LE(0, o); o += 2;
buf.writeUInt16LE(1, o); o += 2;
buf.writeUInt16LE(1, o); o += 2;
buf.writeUInt8(0, o); o += 1; // width = 0 means 256
buf.writeUInt8(0, o); o += 1; // height = 0 means 256
buf.writeUInt8(0, o); o += 1;
buf.writeUInt8(0, o); o += 1;
buf.writeUInt16LE(1, o); o += 2;
buf.writeUInt16LE(32, o); o += 2;
buf.writeUInt32LE(ICON_SIZE, o); o += 4;
buf.writeUInt32LE(OFFSET, o); o += 4;
buf.writeUInt32LE(HEADER, o); o += 4;
buf.writeInt32LE(W, o); o += 4;
buf.writeInt32LE(H * 2, o); o += 4;
buf.writeUInt16LE(1, o); o += 2;
buf.writeUInt16LE(32, o); o += 2;
buf.writeUInt32LE(0, o); o += 4;
buf.writeUInt32LE(PIXELS, o); o += 4;
buf.writeInt32LE(0, o); o += 4;
buf.writeInt32LE(0, o); o += 4;
buf.writeUInt32LE(0, o); o += 4;
buf.writeUInt32LE(0, o); o += 4;
for (let i = 0; i < W * H; i++) {
  buf.writeUInt8(0x40, o++);
  buf.writeUInt8(0x60, o++);
  buf.writeUInt8(0xC0, o++);
  buf.writeUInt8(0xFF, o++);
}
for (let i = 0; i < MASK_BYTES; i++) buf.writeUInt8(0, o++);

fs.writeFileSync(path.join(__dirname, "icon.ico"), buf);
console.log("wrote icon.ico", buf.length, "bytes");