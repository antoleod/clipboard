# Autocapture And Account Sync

This project now uses the simpler model taken from `antoleod/clipboard-Test` and adapted to this codebase without changing the UI.

## What Changed

- Auto-capture keeps the reference repo behavior:
  - poll clipboard while the app is open
  - retry on window focus
  - retry when the page becomes visible again
  - ignore unchanged clipboard content

- Sync now uses account-scoped Firestore only:
  - items are stored under the authenticated user's account
  - the app listens only to that user's clipboard items
  - save, update, and delete sync directly to Firestore
  - local pending items remain available until the next successful sync

## Why This Replaced The Previous Logic

The previous implementation added a more complex queue and shared-item listener model. That made the sync path harder to reason about and easier to break.

The reference repo used a much smaller capture flow:

- read clipboard
- detect meaningful change
- save locally
- retry when focus returns

This repo now keeps that stable capture behavior and pairs it with direct Firestore sync per authenticated account.

## Files

- `src/components/ClipboardAppProV2.jsx`
  - auto-capture trigger behavior
- `src/hooks/useClipboardSync.js`
  - simplified sync state and pending retry behavior
- `src/services/cloudClipboardService.js`
  - account-only Firestore reads and merge writes

## Current Model

1. User signs in.
2. App subscribes to that user's clipboard items in Firestore.
3. Auto-capture reads clipboard while the tab is active.
4. A new capture is added locally first.
5. If online, the app syncs it directly to Firestore.
6. If offline or Firestore fails, the item stays pending locally and is retried later.

## Reference

Reference repo used for the capture model:

- `https://github.com/antoleod/clipboard-Test`

Reference file used for the capture behavior:

- `src/components/ClipboardApp.jsx`
