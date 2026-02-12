# google-calendar-duplicator

Google Calendar Duplicator is a Google Apps Script (GAS) application that synchronizes calendar availability between multiple Google Calendars while preserving privacy.

Instead of copying actual event details, it creates placeholder events (e.g., "Absence") that only show time slots, allowing users to indicate busy times without revealing meeting specifics.

Use Cases
1. Cross-account synchronization: Sync busy times between personal and work Google accounts
2. Calendar aggregation: Combine multiple source calendars into a single "availability" calendar

## Usage

### Install deps

```sh
mise install
pnpm install
```

### Deploy

```sh
clasp login

# The credential is saved into ~/.clasprc.json
mv ~/.clasprc{,-hoge}.json

# Create GAS manually on the google account.
# Then, update scriptId and repository location
cp .clasp-template.json ./config/.clasp-hoge.json
vim ./config/.clasp-hoge.json

# deploy
clasp push -P ./config/.clasp-hoge.json -A ~/.clasprc-hoge.json -I ./.claspignore
```

### Script Properties

You need to configure the following Script Properties in GAS.
1. Open your project in [Google Apps Script](https://script.google.com/)
2. Click `Project Settings` in the left menu
3. In the `Script Properties` section, click `Add script property`

Required Properties

| Property | Description |
|----------|-------------|
| `SYNC_CONFIG` | JSON configuration for calendar sync |

```sh
jq . -c <<EOF
{
  "toCalendarId": "target-calendar-id@example.com",
  "fromCalendarIds": [
    "source-calendar-1@example.com",
    "source-calendar-2@gmail.com",
    "source-calendar-2@group.calendar.google.com"
  ],
  "eventTitle": "Absence"
}
EOF
```

| Field | Type | Description |
|-------|------|-------------|
| `toCalendarId` | string | Target calendar ID to sync events to |
| `fromCalendarIds` | string[] | Array of source calendar IDs to sync events from |
| `eventTitle` | string | Title for the placeholder events created in target calendar |

### Setting Up Triggers

This application uses time-based triggers to automatically synchronize calendar events. You need to configure triggers through the GAS UI.
1. Open your project in [Google Apps Script](https://script.google.com/)
2. Click `Triggers` (clock icon) in the left menu
3. Click `+ Add Trigger` button in the bottom right
4. Configure the trigger:
   - `Choose which function to run`: Select one of the sync functions
   - `Choose which deployment should run`: Head
   - `Select event source`: Time-driven
   - `Select type of time based trigger`: Choose appropriate interval

Recommendation

| Function | Frequency | Rationale |
|----------|-----------|-----------|
| `syncEventsForToday` | Every 10 minutes | Catch last-minute changes for today |
| `syncEventsForTommorow` | Every 10 minutes | Keep tomorrow's schedule updated |
| `syncEventsAfter2To14Days` | Hourly | Near-future events change less frequently |
| `syncEventsAfter15To90Days` | Daily | Far-future events rarely change |

### Task Runner

Create your own mise.local.toml to register deploy commands.

```sh
cat <<EOF > mise.local.toml
[tasks.deploy]
description = "Deploy to all Google Apps Script projects"
depends = ["deploy-account-1", "deploy-account-2"]

[tasks.deploy-account-1]
description = "Deploy to account-1 Google Apps Script project"
run = "clasp push -P ./config/.clasp-account-1.json -A ~/.clasprc-account-1.json -I ./.claspignore"

[tasks.deploy-account-2]
description = "Deploy to account-2 Google Apps Script project"
run = "clasp push -P ./config/.clasp-account-2.json -A ~/.clasprc-account-2.json -I ./.claspignore"
EOF

mise run deploy
```
