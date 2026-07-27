interface CalendarEntry {
  id: string;
  alias: string;
}

/** Generic interface for calendar events (works in both GAS and Node.js) */
interface CalendarEventLike {
  getDescription(): string | null;
}

/** Generic interface for date objects (works with both standard Date and GAS Date) */
interface DateLike {
  getTime(): number;
}

/** Extended event interface for sync classification logic */
interface SyncableEvent extends CalendarEventLike {
  getStartTime(): DateLike;
  getEndTime(): DateLike;
  isAllDayEvent(): boolean;
  getMyStatus(): unknown;
}

/** Represents an event that should exist in the target calendar */
interface DesiredEvent {
  startTime: DateLike;
  endTime: DateLike;
  description: string;
}

/** Result of classifying a source event for sync eligibility */
interface ClassifiedEvent {
  key: string;
  description: string;
}

/** Result of computing the diff between existing and desired events */
interface SyncDiff<TExisting> {
  toCreate: DesiredEvent[];
  toDelete: TExisting[];
}

interface SyncConfig {
  toCalendar: CalendarEntry;
  fromCalendars: CalendarEntry[];
  eventTitle: string;
}

/**
 * Marker used to identify events created by the sync process.
 * Format: %%CALENDAR_SYNC%%|source:<alias>
 */
const SYNC_MARKER = '%%CALENDAR_SYNC%%';

function isSyncedEvent(event: CalendarEventLike): boolean {
  const description = event.getDescription() || '';
  return description.includes(SYNC_MARKER);
}

function createSyncDescription(sourceAlias: string): string {
  return `${SYNC_MARKER}|source:${sourceAlias}`;
}

function buildAliasToCalendarIdMap(
  fromCalendars: CalendarEntry[],
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const entry of fromCalendars) {
    map[entry.alias] = entry.id;
  }
  return map;
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractSourceCalendarAlias(description: string): string | null {
  if (!description || !description.includes(SYNC_MARKER)) {
    return null;
  }
  const pattern = new RegExp(
    escapeRegExp(SYNC_MARKER) + '\\|source:([^\\s\\n]+)',
  );
  const match = description.match(pattern);
  return match ? match[1] : null;
}

function createSyncEventKey(
  sourceAlias: string,
  startTime: DateLike,
  endTime: DateLike,
): string {
  return `${sourceAlias}|${startTime.getTime()}|${endTime.getTime()}`;
}

/**
 * Returns true when the source calendar owner has declined this event.
 *
 * GAS の `CalendarApp.GuestStatus` は enum だがテスト環境では利用できないため、
 * `toString()` で "NO" になる値をすべて辞退扱いとして判定する。GAS 実行時の
 * enum も文字列の "NO" と同じ扱いになる。
 */
function isDeclinedByOwner(event: SyncableEvent): boolean {
  const status = event.getMyStatus();
  if (status == null) {
    return false;
  }
  return String(status) === 'NO';
}

function classifySourceEvent(
  event: SyncableEvent,
  fromCalendarAlias: string,
  toCalendarAlias: string,
  aliasToCalendarId: Record<string, string>,
  toCalendarId: string,
  fromCalendarAliases: Set<string>,
): ClassifiedEvent | null {
  // Skip all-day events
  if (event.isAllDayEvent()) {
    return null;
  }

  // Skip events the source calendar owner has declined
  if (isDeclinedByOwner(event)) {
    return null;
  }

  if (isSyncedEvent(event)) {
    const sourceAlias = extractSourceCalendarAlias(
      event.getDescription() || '',
    );

    // Skip if the source alias is one of our fromCalendars (prevent re-forwarding)
    if (sourceAlias && fromCalendarAliases.has(sourceAlias)) {
      return null;
    }

    // Skip if target calendar matches source alias (prevent circular sync)
    if (sourceAlias && sourceAlias === toCalendarAlias) {
      return null;
    }

    // Also check by resolving alias to calendar ID
    if (sourceAlias && aliasToCalendarId[sourceAlias] === toCalendarId) {
      return null;
    }

    const effectiveAlias = sourceAlias || fromCalendarAlias;
    const key = createSyncEventKey(
      effectiveAlias,
      event.getStartTime(),
      event.getEndTime(),
    );
    // Preserve original description if valid, otherwise create a proper one
    const description = sourceAlias
      ? event.getDescription() || ''
      : createSyncDescription(fromCalendarAlias);

    return {key, description};
  }

  // Original (non-synced) event
  const key = createSyncEventKey(
    fromCalendarAlias,
    event.getStartTime(),
    event.getEndTime(),
  );
  const description = createSyncDescription(fromCalendarAlias);
  return {key, description};
}

function computeSyncDiff<TExisting>(
  existingEvents: Map<string, TExisting>,
  desiredEvents: Map<string, DesiredEvent>,
): SyncDiff<TExisting> {
  const toCreate: DesiredEvent[] = [];
  const toDelete: TExisting[] = [];

  // Events in desired but not existing → create
  for (const [key, event] of desiredEvents) {
    if (!existingEvents.has(key)) {
      toCreate.push(event);
    }
  }

  // Events in existing but not desired → delete
  for (const [key, event] of existingEvents) {
    if (!desiredEvents.has(key)) {
      toDelete.push(event);
    }
  }

  return {toCreate, toDelete};
}

// biome-ignore lint/correctness/noUnusedVariables: GAS trigger entry point
function syncEventsForToday() {
  const today = new Date();
  syncEventsForDay(today, 1);
}

// biome-ignore lint/correctness/noUnusedVariables: GAS trigger entry point
function syncEventsForTommorow() {
  const today = new Date();
  const tomorrow = new Date(today.getTime() + 1 * 24 * 60 * 60 * 1000);
  syncEventsForDay(tomorrow, 1);
}

// biome-ignore lint/correctness/noUnusedVariables: GAS trigger entry point
function syncEventsAfter2To14Days() {
  const days = 2;
  const today = new Date();
  const twoDaysAfter = new Date(today.getTime() + days * 24 * 60 * 60 * 1000);
  syncEventsForDay(twoDaysAfter, 14 - days);
}

// biome-ignore lint/correctness/noUnusedVariables: GAS trigger entry point
function syncEventsAfter15To90Days() {
  const days = 15;
  const today = new Date();
  const fifteenDaysAfter = new Date(
    today.getTime() + days * 24 * 60 * 60 * 1000,
  );
  syncEventsForDay(fifteenDaysAfter, 90 - days);
}

function syncEventsForDay(startDate: Date, days: number) {
  const config = getConfig();
  const aliasToCalendarId = buildAliasToCalendarIdMap(config.fromCalendars);
  const fromCalendarAliases = new Set(config.fromCalendars.map(e => e.alias));

  const fromCalendarIds = config.fromCalendars.map(e => e.id);
  console.log(`Syncing to: ${config.toCalendar.id}`);
  console.log(`Syncing from: ${fromCalendarIds.join(', ')}`);

  const toCalendar = getCalendarById(config.toCalendar.id);
  const toCalendarAlias = config.toCalendar.alias;
  const toCalendarId = toCalendar.getId();

  // Step 1: Build map of existing synced events in target calendar
  const existingEvents = getEventsForDays(toCalendar, startDate, days);
  const existingMap = new Map<
    string,
    GoogleAppsScript.Calendar.CalendarEvent
  >();
  for (const event of existingEvents) {
    if (event.getTitle() === config.eventTitle && isSyncedEvent(event)) {
      const desc = event.getDescription() || '';
      const sourceAlias = extractSourceCalendarAlias(desc);
      if (sourceAlias) {
        const key = createSyncEventKey(
          sourceAlias,
          event.getStartTime(),
          event.getEndTime(),
        );
        if (existingMap.has(key)) {
          console.log(
            `Duplicate existing synced event for key ${key}, deleting duplicate`,
          );
          event.deleteEvent();
        } else {
          existingMap.set(key, event);
        }
      }
    }
  }

  // Step 2: Build map of desired events from all source calendars
  const desiredMap = new Map<string, DesiredEvent>();
  for (const entry of config.fromCalendars) {
    const fromCalendar = getCalendarById(entry.id);
    const sourceEvents = getEventsForDays(fromCalendar, startDate, days);

    for (const event of sourceEvents) {
      const classified = classifySourceEvent(
        event,
        entry.alias,
        toCalendarAlias,
        aliasToCalendarId,
        toCalendarId,
        fromCalendarAliases,
      );
      if (classified && !desiredMap.has(classified.key)) {
        desiredMap.set(classified.key, {
          startTime: event.getStartTime(),
          endTime: event.getEndTime(),
          description: classified.description,
        });
      }
    }
  }

  // Step 3: Compute diff and apply only the changes
  const diff = computeSyncDiff(existingMap, desiredMap);

  console.log(
    `Diff: ${diff.toCreate.length} to create, ${diff.toDelete.length} to delete (${existingMap.size} existing, ${desiredMap.size} desired)`,
  );

  for (const event of diff.toDelete) {
    try {
      event.deleteEvent();
    } catch (e) {
      console.log(`Failed to delete event: ${e}`);
    }
  }

  for (const event of diff.toCreate) {
    try {
      toCalendar
        .createEvent(
          config.eventTitle,
          event.startTime as Date,
          event.endTime as Date,
        )
        .setDescription(event.description);
    } catch (e) {
      console.log(`Failed to create event: ${e}`);
    }
  }
}

function getConfig(): SyncConfig {
  const prop = PropertiesService.getScriptProperties();
  const configJson = prop.getProperty('SYNC_CONFIG');

  if (!configJson) {
    throw new Error(
      'SYNC_CONFIG is not configured. Please set it in Project Settings > Script Properties.',
    );
  }

  let config: SyncConfig;
  try {
    config = JSON.parse(configJson) as SyncConfig;
  } catch (e) {
    throw new Error(`Failed to parse SYNC_CONFIG: ${e}`);
  }

  if (!config.toCalendar || !config.toCalendar.id || !config.toCalendar.alias) {
    throw new Error(
      'SYNC_CONFIG.toCalendar must be an object with "id" and "alias" properties',
    );
  }
  if (
    !Array.isArray(config.fromCalendars) ||
    config.fromCalendars.length === 0
  ) {
    throw new Error(
      'SYNC_CONFIG.fromCalendars must be a non-empty array of {id, alias} objects',
    );
  }

  // Validate each entry has id and alias
  for (const entry of config.fromCalendars) {
    if (!entry.id || !entry.alias) {
      throw new Error(
        'Each entry in SYNC_CONFIG.fromCalendars must have "id" and "alias" properties',
      );
    }
  }

  if (!config.eventTitle) {
    throw new Error('SYNC_CONFIG.eventTitle is required');
  }

  // Validate that all aliases are unique
  const aliases = config.fromCalendars.map(e => e.alias);
  const uniqueAliases = new Set(aliases);
  if (aliases.length !== uniqueAliases.size) {
    throw new Error('SYNC_CONFIG.fromCalendars aliases must be unique');
  }

  // Validate that all calendar IDs are unique
  const ids = config.fromCalendars.map(e => e.id);
  const uniqueIds = new Set(ids);
  if (ids.length !== uniqueIds.size) {
    throw new Error('SYNC_CONFIG.fromCalendars calendar IDs must be unique');
  }

  return config;
}

function getCalendarById(
  calendarId: string,
): GoogleAppsScript.Calendar.Calendar {
  const calendar = CalendarApp.getCalendarById(calendarId);
  if (!calendar) {
    throw new Error(`Calendar not found or no access: ${calendarId}`);
  }
  return calendar;
}

function getEventsForDays(
  calendar: GoogleAppsScript.Calendar.Calendar,
  startDate: Date,
  days: number,
) {
  if (days === 0) {
    const events = calendar.getEventsForDay(startDate);
    return events;
  } else {
    const endTime = new Date(startDate.getTime() + days * 24 * 60 * 60 * 1000);
    const events = calendar.getEvents(startDate, endTime);
    return events;
  }
}

// Export for Node.js testing (GAS ignores this)
if (typeof module !== 'undefined') {
  module.exports = {
    SYNC_MARKER,
    isSyncedEvent,
    createSyncDescription,
    extractSourceCalendarAlias,
    buildAliasToCalendarIdMap,
    escapeRegExp,
    createSyncEventKey,
    isDeclinedByOwner,
    classifySourceEvent,
    computeSyncDiff,
  };
}
