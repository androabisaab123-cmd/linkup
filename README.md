# LINKUP

LINKUP helps people find others nearby who want to do the same activity at the same time. The project has two modes:

- **Hosted mode:** Supabase provides unique email accounts, email confirmation, saved profiles, events, bookings, and database-enforced admin permissions.
- **Demo mode:** If Supabase is not configured, the original front-end prototype runs with browser-local demo data. Demo accounts are not real accounts and do not sync between devices.

## Run locally

Install the dependencies and start the Vite development server:

```sh
npm install
npm run dev
```

Open the local address Vite prints (normally `http://localhost:5173`). For hosted-mode development, copy `.env.example` to `.env.local` and add the two public Supabase settings below. Do not put private keys in frontend environment variables.

## Turn on real accounts and shared data

1. Create a Supabase project.
2. In its SQL Editor, run [`supabase/migrations/202610090001_linkup_core.sql`](supabase/migrations/202610090001_linkup_core.sql).
3. In Supabase Authentication settings, configure email confirmation and allow these redirect URLs:
   - `http://localhost:5173/**`
   - Your production URL, for example `https://linkitup-xi.vercel.app/**`
4. Set these Vercel project environment variables for **Production**, **Preview**, and **Development** as appropriate:

   | Name | Value |
   | --- | --- |
   | `VITE_SUPABASE_URL` | Your Supabase Project URL |
   | `VITE_SUPABASE_PUBLISHABLE_KEY` | The project's publishable key (`sb_publishable_…`) |

5. Redeploy Vercel after saving the variables. The project uses `npm run build` and outputs to `dist`.
6. Sign up with the email you want to use as the LINKUP administrator, confirm it, and finish profile onboarding. In Supabase SQL Editor, replace the sample address below with that same email and run the statement:

   ```sql
   insert into public.user_roles (user_id, role)
   select id, 'admin'
   from auth.users
   where lower(email) = lower('you@example.com')
   on conflict (user_id) do update set role = excluded.role;
   ```

   Sign out and sign back in. The Admin dashboard will appear only for that account. The database also checks the role for every admin data request; hiding the button alone is not the security boundary.

Never add a Supabase **secret** or `service_role` key to Vercel's `VITE_` variables, this repository, or browser code. The publishable key is intended for the browser; row-level security policies in the migration protect each user's data.

## Account and profile behavior

- Supabase Auth enforces one account per normalized email address. Sign-up uses a non-enumerating confirmation message, so the interface does not disclose whether an address is already registered.
- New accounts must finish onboarding before event discovery opens: name, age (16–110), a sex/gender choice, city, skill level from 1–5 for each activity type, and at least one available day Monday–Sunday.
- The sex/gender question includes “Prefer not to say.” Its answer is private to the account and is not included in public member profiles or the admin member list.
- City/area is visible on member and attendee cards. Browser location is requested only when the user presses **Allow location**. LINKUP rounds the coordinates before saving them, keeps them in a private row accessible only to that account, and lets the user remove them under Preferences. A city is enough to continue.
- Event creation, editing, deletion, joining, leaving, saved events, attendee lists, event search/categories, safety reports, and blocks use the Supabase database in hosted mode. Joining is transactional and checks event capacity on the server.
- Password recovery sends a one-time code to the account email. The user must verify that code before LINKUP opens the new-password form. In Supabase Dashboard, set **Authentication → Email Templates → Reset Password** to include the token in the message body, for example: `Your LINKUP password reset code is {{ .Token }}`. The app verifies that code with Supabase as a recovery OTP before changing the password. See the [Supabase email template guide](https://supabase.com/docs/guides/auth/auth-email-templates). Configure custom SMTP for reliable production delivery.
- The admin dashboard is granted manually through Supabase SQL Editor. There is no client-side way to promote an account.

## Demo mode and production limits

With no Supabase environment variables, the prototype keeps its local demo authentication and browser storage. That mode cannot prevent the same email from being used in another browser, cannot provide verified sign-in, and does not share bookings with other people. Password recovery is disabled in demo mode because it cannot verify email ownership. Configure Supabase before presenting LINKUP as an online multi-user service.

The demo sign-up and sign-in screens include a show-password control. The account menu includes My profile, Settings, Help & safety, and Logout.

Hosted mode currently includes email/password sign-in, email verification, email-code password reset, event discovery and booking, member profiles, reports, and a private admin dashboard. It does not include live chat, push notifications, automated moderation, a map, or production SMTP/abuse monitoring. Configure reliable email delivery, monitoring, backups, a privacy policy, and regional age/safety requirements before a public launch.
