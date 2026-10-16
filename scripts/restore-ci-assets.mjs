// Restore existing production artwork without committing or republishing it.
import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const manifest = JSON.parse(readFileSync(new URL('./ci-assets.json', import.meta.url), 'utf8'));
const entries = Object.entries(manifest.files);
const temporary = mkdtempSync(join(tmpdir(), 'wingrid-assets-'));
try {
  let next = 0;
  const results = await Promise.allSettled(Array.from({ length: 8 }, async () => {
    while (next < entries.length) {
      const [file, checksum] = entries[next++];
      const response = await fetch(new URL(file, manifest.baseUrl), { signal: AbortSignal.timeout(60_000) });
      if (!response.ok) throw new Error(`${file}: HTTP ${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (createHash('sha256').update(bytes).digest('hex') !== checksum) {
        throw new Error(`${file}: checksum mismatch; update ci-assets.json only after reviewing changed artwork.`);
      }
      const destination = join(temporary, file);
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, bytes);
    }
  }));
  const failures = results.filter(result => result.status === 'rejected');
  if (failures.length) throw new AggregateError(failures.map(result => result.reason), 'Artwork restoration failed');
  // Layout changes belong to the source checkout, rather than production artwork.
  cpSync('layout', join(temporary, 'layout'), { recursive: true });
  rmSync('public/starlight', { recursive: true, force: true });
  cpSync(temporary, 'public/starlight', { recursive: true });
  console.log(`Restored ${entries.length} checksum-verified assets and current layouts.`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
