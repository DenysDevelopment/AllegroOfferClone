import type { CrmPhoto } from '../api';

/** Toggle a photo in an order-preserving selection list, keyed by photo id. */
export function togglePhoto(selected: CrmPhoto[], photo: CrmPhoto): CrmPhoto[] {
  return selected.some(p => p.id === photo.id)
    ? selected.filter(p => p.id !== photo.id)
    : [...selected, photo];
}
