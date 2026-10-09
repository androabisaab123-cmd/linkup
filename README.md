# LINKUP

A responsive, front-end-only prototype for finding people nearby who want to do the same activity at the same time. It includes local demo sign-up/sign-in, editable profiles with optional local avatar photos, event discovery and management, matching recommendations, saved plans, attendee lists, onboarding preferences, local report/block controls, notifications, and persistent light/dark/system appearance.

## Run it

Open `index.html` in a modern browser. For a local server, from this folder run:

```sh
python -m http.server 8000
```

Then visit `http://localhost:8000`.

## Deployment

This is a static site with no framework, `package.json`, package manager, build command, or required environment variables. The repository root contains `index.html`, so when importing the repository in Vercel, choose **Other** (or let Vercel detect static files), keep the project root at the repository root, and leave the build, install, and output-directory overrides blank. GitHub → Vercel integration can redeploy on each push.

## Demo functionality

Profiles, demo passwords, events, preferences, notifications, and per-account saved events are stored in that browser's `localStorage`. A first-party cookie remembers the selected demo account and theme in that browser for one year. Nothing is encrypted, synchronized, or sent to an authentication or database service. Create an account with any email and a password of at least six characters; use the same credentials to sign in later in the same browser. Events are shared between demo accounts in that browser so they can discover, book, and host plans. Use browser storage controls to clear the demo data.

This prototype does not provide real authentication, email verification, password recovery, cross-device sync, server-side event storage, real push notifications, maps/geolocation, chat, moderation, or account security. Report and block actions are local demo controls; reports do not reach a moderation team. Cookies and browser storage are demo conveniences, not a secure login. Do not use real passwords or sensitive personal information.

## What production needs

- An authentication service or backend with secure password hashing, email verification, password reset, session management, and account deletion.
- A database and API for users, events, memberships, saved events, preferences, and notification state, with authorization rules so users can edit only their own profile and events.
- Server-side validation, rate limiting, abuse reporting/blocking, moderation, and privacy controls.
- A notifications provider and, if location matching is needed, explicit location consent and approximate-location processing. Use public meeting places and avoid exposing private addresses.
- Deployment, HTTPS, monitoring, backups, and a privacy policy appropriate to the launch regions.

The external font stylesheet is optional; system sans-serif fallbacks are defined in `styles.css`.
