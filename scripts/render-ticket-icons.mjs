import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const pairs = [
  ['public/icon-ticket-filled-system.svg', 'public/icon-ticket-filled-system.png'],
  ['public/icon-ticket-outline-system.svg', 'public/icon-ticket-outline-system.png'],
];

for (const [relIn, relOut] of pairs) {
  const input = path.join(root, relIn);
  const output = path.join(root, relOut);
  const buf = fs.readFileSync(input);
  await sharp(buf).resize(512, 512).png().toFile(output);
  console.log('OK', relOut);
}
