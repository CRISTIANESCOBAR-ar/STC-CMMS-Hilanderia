import test from 'node:test';
import assert from 'node:assert/strict';
import { operationalImagePath } from '../src/utils/operationalImagePath.js';
import { validUploadPath, revokeDownloadToken } from '../functions/operationalImages.js';
test('legacy URL is parsed as a storage path while discarding token', () => {
  assert.equal(operationalImagePath('https://firebasestorage.googleapis.com/v0/b/test-bucket/o/novedades%2Flegacy.jpg?alt=media&token=secret', 'test-bucket'), 'novedades/legacy.jpg');
  assert.equal(operationalImagePath('novedades/HILANDERIA/uid/file.jpg', 'test-bucket'), 'novedades/HILANDERIA/uid/file.jpg');
  assert.throws(() => operationalImagePath('https://other.com/image.jpg', 'test-bucket'));
  assert.throws(() => operationalImagePath('gs://other-bucket/novedades/file.jpg', 'test-bucket'));
  assert.throws(() => operationalImagePath('novedades/../secret', 'test-bucket'));
});
test('finalization is restricted to approved caller, own file and assigned sector', () => {
  const profile = { role: 'mecanico', sectoresAsignados: ['HILANDERIA'] };
  assert.equal(validUploadPath(profile, 'uid', 'novedades/HILANDERIA/uid/file.jpg'), true);
  for (const path of ['novedades/TEJEDURIA/uid/file.jpg', 'novedades/HILANDERIA/other/file.jpg', 'novedades/legacy.jpg', 'catalogo/HILANDERIA/uid/file.jpg']) {
    assert.equal(validUploadPath(profile, 'uid', path), false);
  }
  assert.equal(validUploadPath({ role: 'pendiente' }, 'uid', 'novedades/HILANDERIA/uid/file.jpg'), false);
});
test('revocation removes only download token and guards against metadata races', async () => {
  let writes = 0;
  await revokeDownloadToken({
    getMetadata: async () => [{ metageneration: '2', metadata: writes >= 2
      ? { sector: 'HILANDERIA' } : { sector: 'HILANDERIA', firebaseStorageDownloadTokens: 'secret' } }],
    setMetadata: async (patch, options) => {
      assert.deepEqual(patch, { metadata: { firebaseStorageDownloadTokens: null } });
      assert.deepEqual(options, { ifMetagenerationMatch: '2' });
      if (writes++ === 0) throw Object.assign(new Error('Conflict'), { code: 412 });
    },
  });
  assert.equal(writes, 2);
});
test('already private files need no metadata write', async () => {
  await revokeDownloadToken({ getMetadata: async () => [{ metadata: { sector: 'HILANDERIA' } }],
    setMetadata: async () => assert.fail('No token to revoke') });
});
