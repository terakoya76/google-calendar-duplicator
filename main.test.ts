import {describe, expect, it, vi} from 'vitest';

import {
  buildAliasToCalendarIdMap,
  classifySourceEvent,
  computeSyncDiff,
  createSyncDescription,
  createSyncEventKey,
  extractSourceCalendarAlias,
  isDeclinedByOwner,
  isSyncedEvent,
  SYNC_MARKER,
} from './main';

// Mock GAS Calendar types
interface MockCalendarEvent {
  getTitle: () => string;
  getDescription: () => string | null;
  getStartTime: () => Date;
  getEndTime: () => Date;
  isAllDayEvent: () => boolean;
  getMyStatus: () => string | null;
  getId: () => string;
  deleteEvent: () => void;
  setDescription: (description: string) => MockCalendarEvent;
}

interface CalendarEntry {
  id: string;
  alias: string;
}

// Helper to create mock events
function createMockEvent(
  overrides: Partial<{
    title: string;
    description: string;
    startTime: Date;
    endTime: Date;
    isAllDay: boolean;
    myStatus: string | null;
    id: string;
  }> = {},
): MockCalendarEvent {
  const description = overrides.description ?? '';
  return {
    getTitle: () => overrides.title ?? 'Test Event',
    getDescription: () => description,
    getStartTime: () => overrides.startTime ?? new Date('2024-01-01T10:00:00'),
    getEndTime: () => overrides.endTime ?? new Date('2024-01-01T11:00:00'),
    isAllDayEvent: () => overrides.isAllDay ?? false,
    getMyStatus: () => overrides.myStatus ?? 'OWNER',
    getId: () => overrides.id ?? 'event-123',
    deleteEvent: vi.fn(),
    setDescription: vi.fn().mockReturnThis(),
  };
}

describe('isSyncedEvent', () => {
  it('should return true when event has sync marker in description', () => {
    const event = createMockEvent({
      description: '%%CALENDAR_SYNC%%|source:team-alpha',
    });
    expect(isSyncedEvent(event)).toBe(true);
  });

  it('should return false when event has no description', () => {
    const event = createMockEvent({description: ''});
    expect(isSyncedEvent(event)).toBe(false);
  });

  it('should return false when event has description without marker', () => {
    const event = createMockEvent({
      description: 'Regular meeting notes',
    });
    expect(isSyncedEvent(event)).toBe(false);
  });

  it('should return true when marker is part of longer description', () => {
    const event = createMockEvent({
      description: 'Some notes\n%%CALENDAR_SYNC%%|source:team-beta\nMore notes',
    });
    expect(isSyncedEvent(event)).toBe(true);
  });
});

describe('createSyncDescription', () => {
  it('should create description with sync marker and source alias', () => {
    const description = createSyncDescription('team-alpha');
    expect(description).toContain(SYNC_MARKER);
    expect(description).toContain('source:team-alpha');
  });

  it('should create valid parseable format', () => {
    const alias = 'my-team-calendar';
    const description = createSyncDescription(alias);
    const extracted = extractSourceCalendarAlias(description);
    expect(extracted).toBe(alias);
  });

  it('should work with hyphenated aliases', () => {
    const alias = 'team-alpha-dev';
    const description = createSyncDescription(alias);
    expect(description).toBe('%%CALENDAR_SYNC%%|source:team-alpha-dev');
  });
});

describe('extractSourceCalendarAlias', () => {
  it('should extract source alias from valid marker', () => {
    const description = '%%CALENDAR_SYNC%%|source:team-alpha';
    expect(extractSourceCalendarAlias(description)).toBe('team-alpha');
  });

  it('should return null when no marker present', () => {
    const description = 'Regular description without marker';
    expect(extractSourceCalendarAlias(description)).toBeNull();
  });

  it('should return null for empty description', () => {
    expect(extractSourceCalendarAlias('')).toBeNull();
  });

  it('should handle alias with underscores and numbers', () => {
    const description = '%%CALENDAR_SYNC%%|source:team_alpha_123';
    expect(extractSourceCalendarAlias(description)).toBe('team_alpha_123');
  });

  it('should extract source when marker is in middle of description', () => {
    const description =
      'Notes before\n%%CALENDAR_SYNC%%|source:team-beta\nNotes after';
    expect(extractSourceCalendarAlias(description)).toBe('team-beta');
  });
});

describe('buildAliasToCalendarIdMap', () => {
  it('should create map from alias to calendar ID', () => {
    const fromCalendars: CalendarEntry[] = [
      {id: 'calendar-b@example.com', alias: 'team-alpha'},
      {id: 'calendar-c@example.com', alias: 'team-beta'},
    ];
    const map = buildAliasToCalendarIdMap(fromCalendars);

    expect(map['team-alpha']).toBe('calendar-b@example.com');
    expect(map['team-beta']).toBe('calendar-c@example.com');
  });

  it('should handle empty input', () => {
    const map = buildAliasToCalendarIdMap([]);
    expect(Object.keys(map)).toHaveLength(0);
  });
});

describe('createSyncEventKey', () => {
  it('should create key from sourceAlias, startTime, and endTime', () => {
    const start = new Date('2024-01-01T10:00:00');
    const end = new Date('2024-01-01T11:00:00');
    const key = createSyncEventKey('team-alpha', start, end);

    expect(key).toBe(`team-alpha|${start.getTime()}|${end.getTime()}`);
  });

  it('should create different keys for different aliases with same time', () => {
    const start = new Date('2024-01-01T10:00:00');
    const end = new Date('2024-01-01T11:00:00');

    const key1 = createSyncEventKey('team-alpha', start, end);
    const key2 = createSyncEventKey('team-beta', start, end);

    expect(key1).not.toBe(key2);
  });

  it('should create different keys for same alias with different times', () => {
    const start1 = new Date('2024-01-01T10:00:00');
    const end1 = new Date('2024-01-01T11:00:00');
    const start2 = new Date('2024-01-01T14:00:00');
    const end2 = new Date('2024-01-01T15:00:00');

    const key1 = createSyncEventKey('team-alpha', start1, end1);
    const key2 = createSyncEventKey('team-alpha', start2, end2);

    expect(key1).not.toBe(key2);
  });
});

describe('isDeclinedByOwner', () => {
  it('should return true when status is "NO"', () => {
    const event = createMockEvent({myStatus: 'NO'});
    expect(isDeclinedByOwner(event)).toBe(true);
  });

  it('should return false when status is "YES"', () => {
    const event = createMockEvent({myStatus: 'YES'});
    expect(isDeclinedByOwner(event)).toBe(false);
  });

  it('should return false when status is "MAYBE"', () => {
    const event = createMockEvent({myStatus: 'MAYBE'});
    expect(isDeclinedByOwner(event)).toBe(false);
  });

  it('should return false when status is "INVITED"', () => {
    const event = createMockEvent({myStatus: 'INVITED'});
    expect(isDeclinedByOwner(event)).toBe(false);
  });

  it('should return false when status is "OWNER"', () => {
    const event = createMockEvent({myStatus: 'OWNER'});
    expect(isDeclinedByOwner(event)).toBe(false);
  });

  it('should return false when status is null', () => {
    const event = createMockEvent({myStatus: null});
    expect(isDeclinedByOwner(event)).toBe(false);
  });

  it('should treat objects whose toString returns "NO" as declined', () => {
    // GAS の CalendarApp.GuestStatus は enum object で、toString が "NO" 等を返す
    const gasLikeStatus = {toString: () => 'NO'};
    const event = {
      ...createMockEvent(),
      getMyStatus: () => gasLikeStatus as unknown as string,
    };
    expect(isDeclinedByOwner(event)).toBe(true);
  });
});

describe('classifySourceEvent', () => {
  const defaultArgs = {
    fromCalendarAlias: 'cal-b',
    toCalendarAlias: 'cal-a',
    aliasToCalendarId: {'cal-b': 'b@example.com', 'cal-c': 'c@example.com'},
    toCalendarId: 'a@example.com',
    fromCalendarAliases: new Set(['cal-b', 'cal-c']),
  };

  function classify(event: MockCalendarEvent) {
    return classifySourceEvent(
      event,
      defaultArgs.fromCalendarAlias,
      defaultArgs.toCalendarAlias,
      defaultArgs.aliasToCalendarId,
      defaultArgs.toCalendarId,
      defaultArgs.fromCalendarAliases,
    );
  }

  it('should return null for all-day events', () => {
    const event = createMockEvent({isAllDay: true});
    expect(classify(event)).toBeNull();
  });

  it('should return null for events declined by the source calendar owner', () => {
    const event = createMockEvent({myStatus: 'NO'});
    expect(classify(event)).toBeNull();
  });

  it('should classify original (non-synced) event with fromCalendarAlias', () => {
    const start = new Date('2024-01-01T10:00:00');
    const end = new Date('2024-01-01T11:00:00');
    const event = createMockEvent({startTime: start, endTime: end});

    const result = classify(event);

    expect(result).not.toBeNull();
    expect(result!.key).toBe(`cal-b|${start.getTime()}|${end.getTime()}`);
    expect(result!.description).toContain(SYNC_MARKER);
    expect(result!.description).toContain('source:cal-b');
  });

  it('should return null for synced events from a fromCalendar (prevent re-forwarding)', () => {
    const event = createMockEvent({
      description: '%%CALENDAR_SYNC%%|source:cal-c',
    });
    expect(classify(event)).toBeNull();
  });

  it('should return null for synced events targeting back to source (circular)', () => {
    const args = {
      ...defaultArgs,
      toCalendarAlias: 'cal-b',
      toCalendarId: 'b@example.com',
    };
    const event = createMockEvent({
      description: '%%CALENDAR_SYNC%%|source:cal-b',
    });
    const result = classifySourceEvent(
      event,
      args.fromCalendarAlias,
      args.toCalendarAlias,
      args.aliasToCalendarId,
      args.toCalendarId,
      args.fromCalendarAliases,
    );
    expect(result).toBeNull();
  });

  it('should treat malformed synced event (no source alias) as original event', () => {
    const start = new Date('2024-01-01T10:00:00');
    const end = new Date('2024-01-01T11:00:00');
    const event = createMockEvent({
      description: '%%CALENDAR_SYNC%%',
      startTime: start,
      endTime: end,
    });

    const result = classify(event);

    expect(result).not.toBeNull();
    // Falls back to fromCalendarAlias since sourceAlias is null
    expect(result!.key).toBe(`cal-b|${start.getTime()}|${end.getTime()}`);
    expect(result!.description).toContain('source:cal-b');
  });

  it('should forward synced events from external sources', () => {
    const start = new Date('2024-01-01T10:00:00');
    const end = new Date('2024-01-01T11:00:00');
    const event = createMockEvent({
      description: '%%CALENDAR_SYNC%%|source:external-cal',
      startTime: start,
      endTime: end,
    });

    const result = classify(event);

    expect(result).not.toBeNull();
    expect(result!.key).toBe(
      `external-cal|${start.getTime()}|${end.getTime()}`,
    );
    // Preserves original description
    expect(result!.description).toContain('source:external-cal');
  });
});

describe('computeSyncDiff', () => {
  it('should return empty diff when existing and desired match', () => {
    const existing = new Map([['key1', {id: 'e1'}]]);
    const desired = new Map([
      [
        'key1',
        {
          startTime: new Date('2024-01-01T10:00:00'),
          endTime: new Date('2024-01-01T11:00:00'),
          description: 'desc',
        },
      ],
    ]);

    const diff = computeSyncDiff(existing, desired);

    expect(diff.toCreate).toHaveLength(0);
    expect(diff.toDelete).toHaveLength(0);
  });

  it('should identify events to create (in desired but not existing)', () => {
    const existing = new Map<string, {id: string}>();
    const desired = new Map([
      [
        'key1',
        {
          startTime: new Date('2024-01-01T10:00:00'),
          endTime: new Date('2024-01-01T11:00:00'),
          description: 'desc',
        },
      ],
    ]);

    const diff = computeSyncDiff(existing, desired);

    expect(diff.toCreate).toHaveLength(1);
    expect(diff.toCreate[0].description).toBe('desc');
    expect(diff.toDelete).toHaveLength(0);
  });

  it('should identify events to delete (in existing but not desired)', () => {
    const existing = new Map([['key1', {id: 'e1'}]]);
    const desired = new Map<
      string,
      {startTime: Date; endTime: Date; description: string}
    >();

    const diff = computeSyncDiff(existing, desired);

    expect(diff.toCreate).toHaveLength(0);
    expect(diff.toDelete).toHaveLength(1);
    expect(diff.toDelete[0]).toEqual({id: 'e1'});
  });

  it('should handle mixed create and delete', () => {
    const existing = new Map([
      ['key1', {id: 'e1'}],
      ['key2', {id: 'e2'}],
    ]);
    const desired = new Map([
      [
        'key2',
        {
          startTime: new Date('2024-01-01T11:00:00'),
          endTime: new Date('2024-01-01T12:00:00'),
          description: 'desc2',
        },
      ],
      [
        'key3',
        {
          startTime: new Date('2024-01-01T13:00:00'),
          endTime: new Date('2024-01-01T14:00:00'),
          description: 'desc3',
        },
      ],
    ]);

    const diff = computeSyncDiff(existing, desired);

    // key1 only in existing → delete
    expect(diff.toDelete).toHaveLength(1);
    expect(diff.toDelete[0]).toEqual({id: 'e1'});
    // key3 only in desired → create
    expect(diff.toCreate).toHaveLength(1);
    expect(diff.toCreate[0].description).toBe('desc3');
    // key2 in both → no action
  });

  it('should return all as toCreate when existing is empty', () => {
    const existing = new Map<string, unknown>();
    const desired = new Map([
      [
        'key1',
        {
          startTime: new Date('2024-01-01T10:00:00'),
          endTime: new Date('2024-01-01T11:00:00'),
          description: 'desc1',
        },
      ],
      [
        'key2',
        {
          startTime: new Date('2024-01-01T11:00:00'),
          endTime: new Date('2024-01-01T12:00:00'),
          description: 'desc2',
        },
      ],
    ]);

    const diff = computeSyncDiff(existing, desired);

    expect(diff.toCreate).toHaveLength(2);
    expect(diff.toCreate[0].description).toBe('desc1');
    expect(diff.toCreate[1].description).toBe('desc2');
    expect(diff.toDelete).toHaveLength(0);
  });

  it('should return all as toDelete when desired is empty', () => {
    const existing = new Map([
      ['key1', {id: 'e1'}],
      ['key2', {id: 'e2'}],
    ]);
    const desired = new Map<
      string,
      {startTime: Date; endTime: Date; description: string}
    >();

    const diff = computeSyncDiff(existing, desired);

    expect(diff.toCreate).toHaveLength(0);
    expect(diff.toDelete).toHaveLength(2);
    expect(diff.toDelete[0]).toEqual({id: 'e1'});
    expect(diff.toDelete[1]).toEqual({id: 'e2'});
  });
});
