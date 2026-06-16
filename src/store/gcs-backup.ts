// Durable persistence for the file Store on Cloud Run, backed by a private GCS
// bucket. The instance disk is ephemeral (recycled on deploy/restart), so we
// restore the data dir from the bucket on boot and mirror every write back. The
// Store stays synchronous: restore is awaited once before serving, and the
// write mirror is fire-and-forget (best effort, errors logged, never thrown).
//
// Single-instance only (Cloud Run min=max=1): there is no cross-instance write
// coordination, which is exactly the deployment topology we target.

import { Storage } from '@google-cloud/storage';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';

/** Map an absolute file path under dataDir to its bucket object name. */
function objectName(prefix: string, dataDir: string, absPath: string): string {
  const rel = relative(dataDir, absPath).split(sep).join('/');
  return prefix ? `${prefix}/${rel}` : rel;
}

/**
 * Download every object under `prefix` into `dataDir`, recreating the relative
 * layout. Called once on boot before the server serves traffic. Tolerant: a
 * missing bucket/prefix (first run) just yields an empty data dir.
 */
export async function restoreFromGcs(
  bucketName: string,
  dataDir: string,
  prefix: string,
): Promise<number> {
  const bucket = new Storage().bucket(bucketName);
  const [files] = await bucket.getFiles({ prefix: prefix ? `${prefix}/` : undefined });
  let restored = 0;
  for (const file of files) {
    if (file.name.endsWith('/')) continue; // skip directory placeholders
    const rel = prefix ? file.name.slice(prefix.length + 1) : file.name;
    if (!rel) continue;
    const dest = join(dataDir, ...rel.split('/'));
    await mkdir(dirname(dest), { recursive: true });
    const [contents] = await file.download();
    await writeFile(dest, contents);
    restored += 1;
  }
  return restored;
}

/**
 * Build the Store's onWrite hook: upload the just-written file to the bucket,
 * fire-and-forget. Never throws into the Store's synchronous write path.
 */
export function makeGcsMirror(
  bucketName: string,
  dataDir: string,
  prefix: string,
): (absPath: string) => void {
  const bucket = new Storage().bucket(bucketName);
  return (absPath: string): void => {
    if (!existsSync(absPath)) return;
    const name = objectName(prefix, dataDir, absPath);
    void readFile(absPath)
      .then((buf) => bucket.file(name).save(buf, { resumable: false }))
      .catch((err: unknown) => {
        console.error('[gcs-backup] mirror failed for', name, (err as Error)?.message ?? err);
      });
  };
}
