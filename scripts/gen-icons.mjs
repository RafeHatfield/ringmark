import sharp from 'sharp'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const svg = readFileSync(join(root, 'public', 'icon.svg'))

const publicSizes = [
  { name: 'icon-192.png', size: 192 },
  { name: 'icon-512.png', size: 512 },
  { name: 'apple-touch-icon.png', size: 180 },
]

for (const { name, size } of publicSizes) {
  await sharp(svg, { density: Math.ceil((size / 40) * 96) })
    .resize(size, size)
    .png()
    .toFile(join(root, 'public', name))
  console.log(`Generated public/${name}`)
}

// 32x32 PNG for explicit favicon metadata
await sharp(svg, { density: Math.ceil((32 / 40) * 96) })
  .resize(32, 32)
  .png()
  .toFile(join(root, 'public', 'icon-32.png'))
console.log('Generated public/icon-32.png')
