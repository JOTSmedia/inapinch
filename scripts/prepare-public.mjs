import { cp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Root files are the source of truth for both GitHub Pages and the full app.
// Never use the whole repository as a public asset directory.
const root = fileURLToPath(new URL('../', import.meta.url));
const output = join(root, 'public');
const entries = [
  'index.html',
  'app.js',
  'island-map.js',
  'locations.json',
  'logic.js',
  'map-theme.css',
  'ocean.css',
  'ocean.js',
  'ratings.js',
  'styles.css',
  'tropic-theme.css',
  'assets',
];

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await Promise.all(entries.map(entry => cp(join(root, entry), join(output, entry), { recursive: true })));
console.log('Prepared frontend files in public/. Edit the repository root files.');
