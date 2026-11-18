import type { RollbackTarget } from '@hola/shared';

/**
 * Whether the rollback dialog's "Also restore the pre-upgrade data snapshot"
 * starts ticked (#584): exactly when the server says the rollback crosses a
 * one-way (data-migrating) upgrade AND a snapshot for the target exists. That
 * is the case where an image-only rollback cannot start and the data-aware one
 * can. Everywhere else the default stays off — restoring discards every change
 * made since the snapshot, which is not a choice to make for the operator when
 * nothing forces it.
 */
export function defaultRestoreData(target: RollbackTarget | undefined): boolean {
  return !!target && target.boundary === 'one-way' && target.snapshotAvailable;
}
