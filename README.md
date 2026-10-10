# LINKUP

LINKUP helps people find others nearby who want to do the same activity at the same time. Production is designed to use real Supabase accounts and shared data. The browser-only demo is available in local development to preview the interface; production builds never silently fall back to fake accounts.

## Run locally

Install the dependencies and start the Vite development server. With no Supabase variables, local development opens the clearly labeled demo:

```sh
npm install
npm run dev
```

Open the local address Vite prints (normally `http://localhost:5173`). For hosted-mode development, copy `.env.example` to `.env.local` and add the two public Supabase settings below. Do not put private keys in frontend environment variables.

## Turn on real accounts and shared data

1. Create a Supabase project.
2. In its SQL Editor, run both migration files in filename order:
   - [`202610090001_linkup_core.sql`](supabase/migrations/202610090001_linkup_core.sql)
   - [`202610100001_production_hardening.sql`](supabase/migrations/202610100001_production_hardening.sql)
3. In Supabase Authentication settings, require email confirmation and allow these redirect URLs:
   - `http://localhost:5173/**`
   - Your production URL, for example `https://linkitup-xi.vercel.app/**`
4. In the Reset Password email template, use a code in the message body, for example: `Your LINKUP password reset code is {{ .Token }}`. Configure custom SMTP before sending auth email to the public.
5. Set these Vercel project environment variables for **Production**, **Preview**, and **Development** as appropriate:

   | Name | Value |
   | --- | --- |
   | `VITE_SUPABASE_URL` | Your Supabase Project URL |
   | `VITE_SUPABASE_PUBLISHABLE_KEY` | The project's publishable key (`sb_publishable_…`) |

6. Redeploy Vercel after saving the variables. The project uses `npm run build` and outputs to `dist`. If production variables are missing, the deployed app shows a setup message instead of creating fake accounts.
7. Sign up with the email you want to use as the LINKUP administrator, confirm it, and finish profile onboarding. In Supabase SQL Editor, replace the sample address below with that same email and run the statement:

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
- New accounts must finish onboarding before event discovery opens: name, age (16–110), a sex/gender choice, city, optional bio, skill level from 1–5 for each activity type, and at least one available day Monday–Sunday.
- The sex/gender question includes “Prefer not to say.” Its answer is private to the account and is not included in public member profiles or the admin member list.
- City/area is visible on member and attendee cards. Browser location is requested only when the user presses **Allow location**. LINKUP rounds the coordinates before saving them, keeps them in a private row accessible only to that account, and lets the user remove them under Preferences. A city is enough to continue.
- Event creation, editing, deletion, joining, leaving, saved events, attendee lists, event search/categories, in-app notifications, safety reports, and blocks use the Supabase database in hosted mode. Joining is transactional and checks event capacity on the server. Blocks are enforced by database policies, and hosts cannot lower capacity below the booked attendee count.
- Password recovery sends a Supabase recovery email and accepts the secure reset link from the default email template. LINKUP also accepts a one-time recovery code if a custom template includes `{{ .Token }}` in the message body; code delivery requires custom SMTP because Supabase does not allow editing email templates before SMTP is configured. The app verifies codes with Supabase before changing the password. See the [Supabase email template guide](https://supabase.com/docs/guides/auth/auth-email-templates). Configure custom SMTP for reliable production delivery.
- The admin dashboard is granted manually through Supabase SQL Editor. There is no client-side way to promote an account.

## Local demo and production limits

With no Supabase environment variables, local development keeps the original browser-storage demo. It cannot prevent the same email being used in another browser, verify sign-in, or share bookings. Password recovery is disabled there. Production never uses this demo: it shows a setup message until both Supabase variables are configured.

The demo sign-up and sign-in screens include a show-password control. The account menu includes My profile, Settings, Help & safety, and Logout.

The real-account build includes email/password sign-in, email verification, email-code password reset, shared events and bookings, profile matching, in-app attendee/event updates, safety reports and blocks, and a database-protected admin dashboard. It does not include live chat, push notifications, profile photo uploads, account self-deletion, a map, or a staffed moderation service. Before inviting the public, configure custom SMTP and CAPTCHA/rate limits, review privacy and age/safety requirements for your launch region, and arrange a process for moderation reports and account deletion requests.
