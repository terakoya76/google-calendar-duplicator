import {describe, it, expect, vi} from 'vitest';

import {
  SYNC_MARKER,
  isSyncedEvent,
  createSyncDescription,
  extractSourceCalendarAlias,
  buildAliasToCalendarIdMap,
} from './main';

// Mock GAS Calendar types
interface MockCalendarEvent {
  getTitle: () => string;
  getDescription: () => string | null;
  getStartTime: () => Date;
  getEndTime: () => Date;
  isAllDayEvent: () => boolean;
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
