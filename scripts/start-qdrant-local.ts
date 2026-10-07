import { resolve } from 'node:path';
import { existsSync } from 'node:fs';

const root = resolve(import.meta.dir, '..');
const binary = resolve(root, process.env.QDRANT_BINARY || '.data/qdrant/bin/qdrant');
if (!existsSync(binary)) {
  console.error('Qdrant binary missing. See docs/mem0.md (Configuration and startup).');
  process.exit(1);
}
const child = Bun.spawn([binary, '--config-path', resolve(root, 'config/qdrant.local.yaml')], {
  cwd: root,
  env: {
    ...process.env,
    QDRANT__SERVICE__HTTP_PORT: process.env.MEM0_QDRANT_PORT || '26333',
    ...(process.env.MEM0_QDRANT_API_KEY ? { QDRANT__SERVICE__API_KEY: process.env.MEM0_QDRANT_API_KEY } : {}),
  },
  stdout: 'inherit', stderr: 'inherit',
});
process.on('SIGINT', () => child.kill('SIGINT'));
process.on('SIGTERM', () => child.kill('SIGTERM'));
process.exit(await child.exited);
