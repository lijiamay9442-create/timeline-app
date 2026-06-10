# Timeline App

A lightweight schedule app built around a date-based timeline. It can be installed on a phone's home screen and used offline.

## Run Locally
https://lijiamay9442-create.github.io/timeline-app/

## Install on a Phone

1. Deploy the entire directory to any HTTPS-enabled static hosting service.
2. Open the page in a mobile browser.
3. On iPhone, select **Add to Home Screen** from the Share menu. On Android, select **Install App** from the browser menu.
4. Launch the app from the home screen. It opens in a standalone landscape window and works without an internet connection after the initial cache is created.

Events are stored in both local storage and IndexedDB, and the app requests persistent browser storage. Uninstalling the app, clearing its website data, or resetting the phone will still remove locally stored events.

## Features

- Add multiple events to any date
- Automatically sort same-day events by their start time
- Display single-day events as timeline points
- Display multi-day plans as highlighted ranges
- Separate past events from current and future events
- Search, locate, edit, and delete events
- Automatically scale the timeline while supporting manual zoom
- Store data locally for offline use
- Support desktop and mobile layouts
