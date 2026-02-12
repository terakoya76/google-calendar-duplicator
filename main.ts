interface SyncConfig {
  toCalendarId: string;
  fromCalendarIds: string[];
  eventTitle: string;
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

  console.log(`Syncing to: ${config.toCalendarId}`);
  console.log(`Syncing from: ${config.fromCalendarIds.join(', ')}`);

  const toCalendar = getCalendarById(config.toCalendarId);
  const fromCalendars = config.fromCalendarIds.map(id => getCalendarById(id));

  deleteEventsForDay(toCalendar, startDate, days, config.eventTitle);
  fromCalendars.forEach(fromCalendar => {
    copyEventsForDay(
      fromCalendar,
      toCalendar,
      startDate,
      days,
      config.eventTitle,
    );
  });
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

  if (!config.toCalendarId) {
    throw new Error('SYNC_CONFIG.toCalendarId is required');
  }
  if (!config.fromCalendarIds || config.fromCalendarIds.length === 0) {
    throw new Error('SYNC_CONFIG.fromCalendarIds must be a non-empty array');
  }
  if (!config.eventTitle) {
    throw new Error('SYNC_CONFIG.eventTitle is required');
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
    if (e.getTitle() === eventTitle) {
      e.deleteEvent();
    }
  });
}

function copyEventsForDay(
  fromCalendar: GoogleAppsScript.Calendar.Calendar,
  toCalendar: GoogleAppsScript.Calendar.Calendar,
  startDate: Date,
  days: number,
  eventTitle: string,
) {
  const events = getEventsForDays(fromCalendar, startDate, days);
  events.forEach(e => {
    if (e.isAllDayEvent()) {
      // toCalendar.createAllDayEvent(eventTitle, e.getStartTime());
    } else {
      if (e.getTitle() !== eventTitle) {
        toCalendar.createEvent(eventTitle, e.getStartTime(), e.getEndTime());
      }
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
