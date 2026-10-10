import fs from 'node:fs/promises';
import path from 'node:path';
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore, FieldPath } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { operationalImagePath } from '../src/utils/operationalImagePath.js';

const value = name => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const projectId = value('project');
const bucketName = value('bucket');
const apply = process.argv.includes('--apply');
const restore = value('restore');
if (!projectId || !bucketName || (apply && restore)) {
  console.error('Uso: --project=ID --bucket=BUCKET [--apply --backup=.secrets/archivo.json | --restore=.secrets/archivo.json]');
  process.exit(1);
}
initializeApp({ projectId, storageBucket: bucketName, credential: applicationDefault() });
const bucket = getStorage().bucket();
const backupPath = value('backup') || restore;
if ((apply || restore) && (!backupPath || !path.resolve(backupPath).startsWith(path.resolve('.secrets') + path.sep))) {
  console.error('El respaldo privado debe estar dentro de .secrets/ (excluido de Git).');
  process.exit(1);
}
const saveJournal = journal => fs.writeFile(backupPath, JSON.stringify(journal, null, 2), { mode: 0o600 });

try {
  if (restore) {
    const journal = JSON.parse(await fs.readFile(restore, 'utf8'));
    if (journal.projectId !== projectId || journal.bucket !== bucketName) throw new Error('Backup target mismatch');
    let restored = 0;
    for (const entry of journal.entries) {
      if (entry.restored) continue;
      if (!entry.appliedGeneration && entry.pending) {
        // Recover a successful remote patch followed by a local journal-write failure.
        const [current] = await bucket.file(entry.path).getMetadata();
        if (current.generation !== entry.objectGeneration) throw new Error('Object changed since backup');
        if (current.metageneration === entry.metageneration) continue; // No remote change was applied.
        const expected = { ...entry.originalMetadata, sector: entry.sector };
        delete expected.firebaseStorageDownloadTokens;
        const canonical = metadata => JSON.stringify(Object.entries(metadata || {}).sort(([a], [b]) => a.localeCompare(b)));
        if (BigInt(current.metageneration) !== BigInt(entry.metageneration) + 1n
            || canonical(current.metadata) !== canonical(expected)) throw new Error('Metadata changed outside migration');
        entry.appliedGeneration = current.metageneration;
      }
      if (!entry.appliedGeneration) continue;
      const inverse = { firebaseStorageDownloadTokens: null, sector: null, ...entry.originalMetadata };
      await bucket.file(entry.path).setMetadata({ metadata: inverse }, {
        ifGenerationMatch: entry.objectGeneration, ifMetagenerationMatch: entry.appliedGeneration,
      });
      entry.restored = true;
      await saveJournal(journal);
      restored++;
    }
    console.log(JSON.stringify({ projectId, bucket: bucketName, restored }));
  } else {
    const db = getFirestore();
    const references = new Map();
    let incompatibleReferences = 0;
    for (const collection of ['novedades', 'intervenciones']) {
      let cursor;
      while (true) {
        let page = db.collection(collection).orderBy(FieldPath.documentId()).limit(300);
        if (cursor) page = page.startAfter(cursor);
        const snapshot = await page.get();
        if (snapshot.empty) break;
        for (const document of snapshot.docs) {
          const data = document.data();
          if (!data.fotoUrl) continue;
          try {
            const filePath = operationalImagePath(data.fotoUrl, bucketName);
            if (!['HILANDERIA', 'TEJEDURIA'].includes(data.sector)) throw new Error('Missing sector');
            const pieces = filePath.split('/');
            if (![2, 4].includes(pieces.length) || (pieces.length === 4 && pieces[1] !== data.sector)) throw new Error('Conflicting sector');
            if (!references.has(filePath)) references.set(filePath, new Set());
            references.get(filePath).add(data.sector);
          } catch { incompatibleReferences++; }
        }
        cursor = snapshot.docs.at(-1);
      }
    }
    const entries = [];
    let missingFiles = 0;
    for (const [filePath, sectors] of references) {
      if (sectors.size !== 1) { incompatibleReferences++; continue; }
      try {
        const [metadata] = await bucket.file(filePath).getMetadata();
        entries.push({ path: filePath, sector: [...sectors][0], metageneration: metadata.metageneration,
          objectGeneration: metadata.generation,
          originalMetadata: metadata.metadata || {} });
      } catch (error) { if (error.code === 404) missingFiles++; else throw error; }
    }
    const report = { projectId, bucket: bucketName, readOnly: !apply,
      referencedFiles: references.size, compatibleFiles: entries.length, incompatibleReferences, missingFiles };
    if (!apply) {
      console.log(JSON.stringify(report, null, 2));
      if (incompatibleReferences || missingFiles) process.exitCode = 2;
    } else {
      if (incompatibleReferences || missingFiles) throw new Error('Resolve incompatible references first');
      await fs.mkdir(path.dirname(backupPath), { recursive: true });
      const journal = { projectId, bucket: bucketName, createdAt: new Date().toISOString(), entries };
      // Never overwrite an existing rollback journal.
      await fs.writeFile(backupPath, JSON.stringify(journal, null, 2), { flag: 'wx', mode: 0o600 });
      for (const entry of entries) {
        entry.pending = true;
        await saveJournal(journal);
        const [updated] = await bucket.file(entry.path).setMetadata({ metadata: {
          sector: entry.sector, firebaseStorageDownloadTokens: null,
        } }, { ifGenerationMatch: entry.objectGeneration, ifMetagenerationMatch: entry.metageneration });
        entry.appliedGeneration = updated.metageneration;
        await saveJournal(journal);
        if (updated.metadata?.firebaseStorageDownloadTokens) throw new Error('Revocation not confirmed');
      }
      console.log(JSON.stringify({ ...report, applied: entries.length }));
    }
  }
} catch (error) {
  console.error('Operación detenida. Revisar compatibilidad, permisos y el journal privado antes de continuar.', { code: error.code || 'validation-or-connection' });
  process.exitCode = 1;
}
