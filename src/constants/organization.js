export const DEFAULT_SECTOR = 'HILANDERIA';

export const SECTOR_OPTIONS = [
  'HILANDERIA',
  'TEJEDURIA'
];

export const ROLE_OPTIONS = [
  'mecanico',
  'jefe_sector',
  'admin'
];

export const normalizeSectorValue = (value) => {
  if (!value || typeof value !== 'string') return DEFAULT_SECTOR;
  return value.trim().toUpperCase();
};

export const sanitizeSectorList = (values, fallback = DEFAULT_SECTOR) => {
  const rawValues = Array.isArray(values) ? values : [fallback];
  const normalized = rawValues
    .map((value) => normalizeSectorValue(value))
    .filter(Boolean);

  return [...new Set(normalized.length ? normalized : [normalizeSectorValue(fallback)])];
};

export const canAccessJefePanel = (role) => ['admin', 'jefe_sector'].includes(role);
