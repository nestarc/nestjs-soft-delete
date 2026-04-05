export type SoftDeleteFilterMode = 'default' | 'withDeleted' | 'onlyDeleted';

export interface SoftDeleteStore {
  filterMode: SoftDeleteFilterMode;
  skipSoftDelete: boolean;
  actorId?: string | null;
}
