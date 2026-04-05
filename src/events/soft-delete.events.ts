export class SoftDeletedEvent {
  static readonly EVENT_NAME = 'soft-delete.deleted' as const;

  constructor(
    public readonly model: string,
    public readonly where: Record<string, unknown>,
    public readonly deletedAt: Date,
    public readonly actorId: string | null = null,
  ) {}
}

export class RestoredEvent {
  static readonly EVENT_NAME = 'soft-delete.restored' as const;

  constructor(
    public readonly model: string,
    public readonly where: Record<string, unknown>,
    public readonly actorId: string | null = null,
  ) {}
}

export class PurgedEvent {
  static readonly EVENT_NAME = 'soft-delete.purged' as const;

  constructor(
    public readonly model: string,
    public readonly count: number,
    public readonly olderThan: Date,
  ) {}
}
