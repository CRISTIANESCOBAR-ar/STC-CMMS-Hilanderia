import { ALLOWED_ROLES } from './geminiPolicy.js';

export function validUploadPath(profile, uid, path) {
  if (!ALLOWED_ROLES.has(profile?.role) || typeof path !== 'string' || path.length > 1024) return false;
  const parts = path.split('/');
  if (parts.length !== 4 || !['novedades', 'intervenciones'].includes(parts[0])
      || !['HILANDERIA', 'TEJEDURIA'].includes(parts[1]) || parts[2] !== uid
      || !parts[3] || ['.', '..'].includes(parts[3]) || path.includes('\\')) return false;
  const leader = ['jefe_sector', 'jefe_electricos', 'jefe_produccion', 'gerente_produccion'].includes(profile.role);
  return profile.role === 'admin' || (profile.sectoresAsignados || [profile.sectorDefault || 'HILANDERIA']).includes(parts[1])
    || (leader && (profile.jefeDeSectores || []).includes(parts[1]));
}

export async function revokeDownloadToken(file) {
  for (let retry = 0; retry < 3; retry++) {
    const [metadata] = await file.getMetadata();
    if (!metadata.metadata?.firebaseStorageDownloadTokens) return;
    try {
      await file.setMetadata({ metadata: { firebaseStorageDownloadTokens: null } },
        { ifMetagenerationMatch: metadata.metageneration });
      const [confirmed] = await file.getMetadata();
      if (confirmed.metadata?.firebaseStorageDownloadTokens) {
        throw new Error('No se pudo revocar el acceso por enlace.');
      }
      return;
    } catch (error) { if (error.code !== 412 || retry === 2) throw error; }
  }
}
