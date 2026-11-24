// Cloudflare looks for 404.html; Expo names its not-found page "+not-found.html".
// Run after `expo export --platform web`.
import { copyFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const from = join(dist, '+not-found.html');
if (!existsSync(from)) {
  console.error('dist/+not-found.html is missing. Run "npm run build" first.');
  process.exit(1);
}
copyFileSync(from, join(dist, '404.html'));
console.log('dist/404.html ready for Cloudflare');
