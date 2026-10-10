import { where } from 'firebase/firestore';
import { userProfile } from './authService';
import { getSectorScope } from '../utils/sectorScope';

export function sectorConstraints() {
  const sectors = getSectorScope(userProfile.value);
  if (sectors === null) return [];
  return [where('sector', sectors.length === 1 ? '==' : 'in', sectors.length === 1 ? sectors[0] : sectors)];
}
