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

function createTimeSlotKey(startTime: DateLike, endTime: DateLike): string {
  return `${startTime.getTime()}|${endTime.getTime()}`;
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

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function syncEventsForToday() {
  const today = new Date();
  syncEventsForDay(today, 1);
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function syncEventsForTommorow() {
  const today = new Date();
  const tomorrow = new Date(today.getTime() + 1 * 24 * 60 * 60 * 1000);
  syncEventsForDay(tomorrow, 1);
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function syncEventsAfter2To14Days() {
  const days = 2;
  const today = new Date();
  const twoDaysAfter = new Date(today.getTime() + days * 24 * 60 * 60 * 1000);
  syncEventsForDay(twoDaysAfter, 14 - days);
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
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

  deleteEventsForDay(toCalendar, startDate, days, config.eventTitle);

  for (const entry of config.fromCalendars) {
    const fromCalendar = getCalendarById(entry.id);

    copyEventsForDay(
      fromCalendar,
      entry.alias,
      toCalendar,
      toCalendarAlias,
      startDate,
      days,
      config.eventTitle,
      aliasToCalendarId,
      fromCalendarAliases,
    );
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

function deleteEventsForDay(
  calendar: GoogleAppsScript.Calendar.Calendar,
  startDate: Date,
  days: number,
  eventTitle: string,
) {
  const events = getEventsForDays(calendar, startDate, days);
  events.forEach(e => {
    // Only delete events that BOTH match the eventTitle AND have the sync marker.
    // This protects manually created events with the same title.
    if (e.getTitle() === eventTitle && isSyncedEvent(e)) {
      e.deleteEvent();
    }
  });
}

function copyEventsForDay(
  fromCalendar: GoogleAppsScript.Calendar.Calendar,
  fromCalendarAlias: string,
  toCalendar: GoogleAppsScript.Calendar.Calendar,
  toCalendarAlias: string,
  startDate: Date,
  days: number,
  eventTitle: string,
  aliasToCalendarId: Record<string, string>,
  fromCalendarAliases: Set<string>,
) {
  const events = getEventsForDays(fromCalendar, startDate, days);
  const processedTimeSlots = new Set<string>();

  events.forEach(e => {
    // Skip all-day events
    if (e.isAllDayEvent()) {
      return;
    }

    // Check if this is a synced event (has sync marker in description)
    if (isSyncedEvent(e)) {
      // Extract the original source alias from the marker
      const sourceAlias = extractSourceCalendarAlias(e.getDescription());

      // Skip if the source alias is one of our fromCalendars
      // This prevents re-forwarding events that have already been through this sync path
      // e.g., B -> A -> C, then C -> A should not re-forward the event back to A
      if (sourceAlias && fromCalendarAliases.has(sourceAlias)) {
        return;
      }

      // Skip if the target calendar's alias matches the source alias (prevent circular sync)
      // e.g., B's event in A should not be synced back to B
      if (sourceAlias && sourceAlias === toCalendarAlias) {
        return;
      }

      // Also check by resolving alias to calendar ID
      if (
        sourceAlias &&
        aliasToCalendarId[sourceAlias] === toCalendar.getId()
      ) {
        return;
      }

      // Skip duplicate time slots from the same source calendar
      // Check AFTER circular sync prevention so skipped events don't consume time slots
      const timeSlotKey = createTimeSlotKey(e.getStartTime(), e.getEndTime());
      if (processedTimeSlots.has(timeSlotKey)) {
        return;
      }
      processedTimeSlots.add(timeSlotKey);

      // Forward the event to next calendar, preserving the original source marker
      toCalendar
        .createEvent(eventTitle, e.getStartTime(), e.getEndTime())
        .setDescription(e.getDescription());
    } else {
      // Skip duplicate time slots from the same source calendar
      const timeSlotKey = createTimeSlotKey(e.getStartTime(), e.getEndTime());
      if (processedTimeSlots.has(timeSlotKey)) {
        return;
      }
      processedTimeSlots.add(timeSlotKey);

      // This is an original event (not synced)
      const description = createSyncDescription(fromCalendarAlias);
      toCalendar
        .createEvent(eventTitle, e.getStartTime(), e.getEndTime())
        .setDescription(description);
    }
  });
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
    createTimeSlotKey,
  };
}
