const supabase = window.linkupSupabase;
const app = document.getElementById('app');
const modalRoot = document.getElementById('modal-root');
const toastRoot = document.getElementById('toast-root');
const categories = ['Sports', 'Outdoors', 'Food & drink', 'Culture', 'Gaming', 'Social'];
const categoryIcons = { Sports: '🏸', Outdoors: '🌿', 'Food & drink': '☕', Culture: '🎨', Gaming: '🎮', Social: '✨' };
const weekdays = [['monday','Monday'],['tuesday','Tuesday'],['wednesday','Wednesday'],['thursday','Thursday'],['friday','Friday'],['saturday','Saturday'],['sunday','Sunday']];
const skillLabels = ['New to it', 'Beginner', 'Getting comfortable', 'Confident', 'Expert'];
const state = {
  session: null, user: null, profile: null, gender: '', selfGender: '', isAdmin: false,
  page: 'discover', authMode: 'signup', theme: localStorage.getItem('linkup-secure-theme') || 'system',
  events: [], publicProfiles: {}, attendeeRows: [], savedIds: [], blockedIds: [], notifications: [], locationShared: false,
  category: 'All', search: '', locationQuery: '', dateFilter: 'Any date', skillFilter: 'Any skill', budgetFilter: 'Any budget', sortBy: 'recommended',
  modal: null, editingId: null, location: null, locationGranted: false,
  adminProfiles: [], adminEvents: [], reports: [], busy: false, resetMode: false, resetStage: 'request',
};
let notificationChannel = null;
let notificationChannelUserId = null;

function esc(value = '') {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}
function localDateISO(date = new Date()) {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}
function applyTheme() {
  const dark = state.theme === 'dark' || (state.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.body.classList.toggle('dark', dark);
  localStorage.setItem('linkup-secure-theme', state.theme);
  if (state.user?.id) localStorage.setItem(`linkup-secure-theme:${state.user.id}`, state.theme);
}
function toast(message, type = 'success') {
  toastRoot.innerHTML = `<div class="toast-wrap"><div class="toast ${type === 'error' ? 's-toast-error' : ''}" role="status">${esc(message)}</div></div>`;
  window.setTimeout(() => { toastRoot.innerHTML = ''; }, 3600);
}
function errorText(error) {
  const msg = error?.message || 'Something went wrong. Please try again.';
  if (/notifications.*(does not exist|schema cache)|could not find the table .*notifications/i.test(msg)) return 'Hosted setup is incomplete. Run both Supabase migrations in filename order, then reload LINKUP.';
  if (/failed to fetch|networkerror|load failed|fetch failed/i.test(msg)) return 'LINKUP cannot reach Supabase. Check that the project URL and publishable key are correct, that the Supabase project is active, and that this site URL is allowed in Supabase Auth settings.';
  if (/email link is invalid|invalid.*(otp|token)|expired.*(otp|token|link)|token.*(expired|invalid)/i.test(msg)) return 'That recovery email is expired or already used. Request another recovery email and open the newest link.';
  if (/email.*rate limit|rate limit.*email|too many.*email/i.test(msg)) return 'Too many recovery emails were requested. Wait a few minutes, then try again.';
  if (/smtp|email provider|error sending.*email|failed to send.*email/i.test(msg)) return 'Supabase could not send the recovery email. Check Authentication → Emails and configure SMTP for delivery.';
  if (/invalid login credentials/i.test(msg)) return 'That email and password do not match. Check them and try again.';
  if (/already registered|already exists|email_exists|user exists/i.test(msg)) return 'This email already has an account. Sign in with it instead.';
  if (/email not confirmed/i.test(msg)) return 'Please confirm your email from the link we sent before signing in.';
  if (/password should be at least/i.test(msg)) return 'Use a longer password and try again.';
  if (/maximum people cannot be lower than the current attendee count/i.test(msg)) return 'The maximum people count cannot be lower than the number already booked.';
  if (/this event is unavailable/i.test(msg)) return 'This event is unavailable because of a block between the accounts.';
  if (/row-level security|permission denied/i.test(msg)) return 'This action is not allowed for this account. Refresh and try again.';
  return msg;
}
function setBusy(value) {
  state.busy = value;
  document.querySelectorAll('[data-submit]').forEach((button) => {
    button.disabled = value;
    if (!button.dataset.original) button.dataset.original = button.textContent;
    button.textContent = value ? 'Please wait…' : button.dataset.original;
  });
}
function loading(message = 'Getting your LINKUP ready…') {
  app.innerHTML = `<main class="s-center"><div class="s-brand"><span class="brand-mark">↗</span> LINKUP</div><div class="s-spinner"></div><p>${esc(message)}</p></main>`;
}
function authShell(body, kicker, title, intro) {
  app.innerHTML = `<main class="s-auth"><section class="s-auth-story"><a class="s-brand" href="#"><span class="brand-mark">↗</span> LINKUP</a><div><div class="eyebrow">${esc(kicker)}</div><h1>Find people who want the same thing, at the same time.</h1><p>Make a plan, meet in a public place, and bring more of what you love into your week.</p></div><span class="s-auth-foot">Find your people. Make plans that happen.</span></section><section class="s-auth-form"><div class="s-auth-card"><div class="eyebrow">${esc(kicker)}</div><h2>${esc(title)}</h2><p>${esc(intro)}</p>${body}<div class="s-demo-label">Secure account mode · Email confirmation may be required</div></div></section></main>`;
}
function renderAuth(message = '') {
  const recoveryCodeStep = state.resetMode && state.resetStage === 'code';
  const nameField = !state.resetMode && state.authMode === 'signup' ? `<div class="field"><label for="signup-name">Your name</label><input id="signup-name" name="name" autocomplete="name" minlength="2" maxlength="60" placeholder="e.g. Alex Novak" required value="${esc(state.user?.user_metadata?.display_name || '')}"></div>` : '';
  const emailField = `<div class="field"><label for="auth-email">Email address</label><input id="auth-email" name="email" type="email" autocomplete="email" placeholder="you@example.com" required value="${esc(state.lastEmail || '')}" ${recoveryCodeStep ? 'readonly' : ''}></div>`;
  const passwordField = !state.resetMode ? `<div class="field"><label for="auth-password">Password</label><div class="s-password-control"><input id="auth-password" name="password" type="password" autocomplete="${state.authMode === 'signup' ? 'new-password' : 'current-password'}" minlength="10" placeholder="At least 10 characters" required><button class="s-password-toggle" type="button" data-action="toggle-password" aria-label="Show password" title="Show password"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg></button></div></div>` : '';
  const codeField = recoveryCodeStep ? `<div class="field"><label for="recovery-code">Email recovery code</label><input id="recovery-code" name="token" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6,8}" maxlength="8" placeholder="Code from your email" required><small class="s-subtle">If your email contains a code, enter it here. If it contains a secure reset link, open that link in this browser.</small></div>` : '';
  const actionLinks = !state.resetMode
    ? `<div class="s-auth-links"><button type="button" data-action="forgot-password">Forgot password?</button></div><div class="auth-switch">${state.authMode === 'signup' ? 'Already have an account?' : 'New to LINKUP?'} <button data-action="auth-switch">${state.authMode === 'signup' ? 'Sign in' : 'Create account'}</button></div>`
    : `<div class="s-auth-links">${recoveryCodeStep ? `<button type="button" data-action="edit-recovery-email">Change email</button><button type="button" data-action="resend-recovery-email">Resend email</button>` : ''}<button type="button" data-action="cancel-reset">Back to sign in</button></div>`;
  const body = `<form id="auth-form" class="auth-form">${nameField}${emailField}${passwordField}${codeField}${message ? `<div class="s-inline-note">${esc(message)}</div>` : ''}<button class="btn primary s-full" type="submit" data-submit>${state.resetMode ? recoveryCodeStep ? 'Verify recovery code' : 'Send recovery email' : state.authMode === 'signup' ? 'Create account' : 'Sign in'}</button></form>${actionLinks}`;
  authShell(body, state.resetMode ? 'Account recovery' : state.authMode === 'signup' ? 'Join your people' : 'Good to see you', state.resetMode ? recoveryCodeStep ? 'Check your email.' : 'Recover your account.' : state.authMode === 'signup' ? 'Your next plan starts here.' : 'Welcome back.', state.resetMode ? recoveryCodeStep ? 'Open the secure reset link from your email in this browser to choose a new password. If your email contains a code, enter it below.' : 'Enter your email and we will send a secure password recovery email if an account matches.' : state.authMode === 'signup' ? 'Create your account, then tell us a little about what you like.' : 'Sign in to continue to your plans.');
}
function renderCheckEmail(email) {
  const body = `<div class="s-check-mail"><div class="s-mail-icon">✉</div><h3>Check your inbox</h3><p>If <strong>${esc(email)}</strong> can be registered, we sent a confirmation link. If you already have an account, sign in with that address.</p><button class="btn primary s-full" data-action="back-signin">Back to sign in</button></div>`;
  authShell(body, 'One more step', 'Confirm your email.', 'Email confirmation helps protect your account.');
}
function normalizeProfile(row) {
  return row || {
    id: state.user.id,
    display_name: state.user.user_metadata?.display_name || '',
    age: '', city: '', bio: '', interests: [], activity_skills: Object.fromEntries(categories.map((c) => [c, '3'])),
    availability: [], profile_complete: false,
  };
}
async function loadSession(session) {
  state.session = session;
  state.user = session?.user || null;
  if (state.user) {
    state.theme = localStorage.getItem(`linkup-secure-theme:${state.user.id}`) || 'system';
  }
  state.profile = null;
  state.isAdmin = false;
  state.modal = null;
  if (!state.user) {
    state.authMode = 'signin';
    state.notifications = [];
    stopNotificationSubscription();
    renderAuth();
    return;
  }
  loading();
  try {
    const [profileResult, genderResult, roleResult, savedResult, blockResult, locationResult, notificationResult] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', state.user.id).maybeSingle(),
      supabase.from('private_demographics').select('gender,self_described_gender').eq('user_id', state.user.id).maybeSingle(),
      supabase.from('user_roles').select('role').eq('user_id', state.user.id).maybeSingle(),
      supabase.from('saved_events').select('event_id').eq('user_id', state.user.id),
      supabase.from('user_blocks').select('blocked_id').eq('blocker_id', state.user.id),
      supabase.from('profile_locations').select('user_id').eq('user_id', state.user.id).maybeSingle(),
      supabase.from('notifications').select('id,event_id,kind,title,body,created_at,read_at').eq('user_id', state.user.id).order('created_at', { ascending: false }).limit(50),
    ]);
    if (profileResult.error) throw profileResult.error;
    if (genderResult.error && genderResult.error.code !== 'PGRST116') throw genderResult.error;
    if (roleResult.error && roleResult.error.code !== 'PGRST116') throw roleResult.error;
    state.profile = normalizeProfile(profileResult.data);
    state.gender = genderResult.data?.gender || '';
    state.selfGender = genderResult.data?.self_described_gender || '';
    state.isAdmin = roleResult.data?.role === 'admin';
    state.savedIds = (savedResult.data || []).map((row) => row.event_id);
    state.blockedIds = (blockResult.data || []).map((row) => row.blocked_id);
    if (locationResult.error && locationResult.error.code !== 'PGRST116') throw locationResult.error;
    state.locationShared = Boolean(locationResult.data);
    if (notificationResult.error) throw notificationResult.error;
    state.notifications = notificationResult.data || [];
    if (!state.profile.profile_complete) {
      state.page = 'onboarding';
      renderOnboarding();
      if (state.resetMode && state.resetStage === 'password') renderPasswordUpdate();
      return;
    }
    await refreshData();
    applyTheme();
    renderApp();
    subscribeToNotifications(state.user.id);
    if (state.resetMode && state.resetStage === 'password') renderPasswordUpdate();
  } catch (error) {
    app.innerHTML = `<main class="s-center"><div class="s-brand"><span class="brand-mark">↗</span> LINKUP</div><h2>We could not load your account.</h2><p>${esc(errorText(error))}</p><button class="btn secondary" data-action="reload">Try again</button><button class="btn outline" data-action="logout">Sign out</button></main>`;
  }
}
async function refreshData() {
  const { data, error } = await supabase.from('events').select('*').eq('status', 'published').gte('event_date', localDateISO()).order('event_date').order('start_time');
  if (error) throw error;
  state.events = data || [];
  const ids = [...new Set(state.events.flatMap((event) => [event.host_id]))];
  if (ids.length) {
    const result = await supabase.from('public_profiles').select('id,display_name,age,city,bio,interests,activity_skills,availability').in('id', ids);
    if (result.error) throw result.error;
    state.publicProfiles = Object.fromEntries((result.data || []).map((profile) => [profile.id, profile]));
  } else state.publicProfiles = {};
  if (state.page === 'discover' || state.page === 'saved' || state.page === 'dashboard') {
    const eventIds = state.events.map((event) => event.id);
    if (eventIds.length) {
      const result = await supabase.from('event_attendees').select('event_id,user_id').in('event_id', eventIds);
      if (result.error) throw result.error;
      state.attendeeRows = result.data || [];
    } else state.attendeeRows = [];
  }
}
function renderOnboarding() {
  const profile = state.profile || normalizeProfile();
  const skills = profile.activity_skills || {};
  const genderOptions = [['prefer_not_to_say','Prefer not to say'],['woman','Woman'],['man','Man'],['non_binary','Non-binary'],['self_described','Self-describe']];
  app.innerHTML = `<main class="s-onboard"><header class="s-onboard-head"><a class="s-brand" href="#"><span class="brand-mark">↗</span> LINKUP</a><button class="text-button" data-action="logout">Sign out</button></header><section class="s-onboard-card"><div class="eyebrow">Your account is ready · step 1 of 1</div><h1>Let’s set up your profile.</h1><p class="s-onboard-intro">We use these details to help match you with activities and people. Your gender and exact location stay private.</p><form id="profile-form"><div class="s-form-grid"><div class="field"><label for="profile-name">Name *</label><input id="profile-name" name="display_name" required minlength="2" maxlength="60" value="${esc(profile.display_name || state.user?.user_metadata?.display_name || '')}" autocomplete="name"></div><div class="field"><label for="profile-age">Age *</label><input id="profile-age" name="age" type="number" inputmode="numeric" min="16" max="110" required value="${esc(profile.age || '')}"><small>Used to suggest suitable age ranges.</small></div><div class="field"><label for="profile-gender">Sex / gender *</label><select id="profile-gender" name="gender" required><option value="" disabled ${state.gender ? '' : 'selected'}>Choose an option</option>${genderOptions.map(([value,label]) => `<option value="${value}" ${state.gender === value ? 'selected' : ''}>${label}</option>`).join('')}</select><small>Choose “Prefer not to say” if you don’t want to share. This is private to your account.</small></div><div class="field ${state.gender === 'self_described' ? '' : 's-hidden'}" id="self-gender-wrap"><label for="self-gender">How do you describe your gender?</label><input id="self-gender" name="self_described_gender" maxlength="40" value="${esc(state.selfGender)}"></div><div class="field s-form-wide"><label for="profile-city">Your city or area *</label><input id="profile-city" name="city" required minlength="2" maxlength="100" placeholder="e.g. Prague" value="${esc(profile.city || '')}" autocomplete="address-level2"><small>Only your city or area is shown to other members.</small></div><div class="field s-form-wide"><label for="profile-bio">Short bio <span class="s-optional">optional</span></label><textarea id="profile-bio" name="bio" maxlength="500" rows="3" placeholder="What do you enjoy doing?">${esc(profile.bio || "")}</textarea><small>A few words to help other members get to know you.</small></div><div class="field s-form-wide"><label>Location access <span class="s-optional">optional</span></label><div class="s-location-box"><div><strong>Use approximate location</strong><p>${state.locationGranted ? 'Location permission granted. Only a rounded, approximate point will be saved.' : 'Share a rough location to help find nearby plans. Your exact coordinates are discarded.'}</p></div><button type="button" class="btn secondary" data-action="request-location">${state.locationGranted ? 'Location allowed ✓' : 'Allow location'}</button></div><div class="s-location-status" aria-live="polite"></div></div><div class="field s-form-wide"><label>Activity skill levels *</label><p class="s-field-hint">Choose your level from 1 to 5 for each activity type.</p><div class="s-skill-grid">${categories.map((category) => `<label class="s-skill-row"><span>${categoryIcons[category]} ${esc(category)}</span><select name="skill_${esc(category)}" required>${[1,2,3,4,5].map((n) => `<option value="${n}" ${Number(skills[category] || 3) === n ? 'selected' : ''}>${n} · ${skillLabels[n - 1]}</option>`).join('')}</select></label>`).join('')}</div></div><div class="field s-form-wide"><label>Availability *</label><p class="s-field-hint">Choose every day you are usually available.</p><div class="s-day-grid">${weekdays.map(([value,label]) => `<label class="s-day"><input type="checkbox" name="availability" value="${value}" ${(profile.availability || []).includes(value) ? 'checked' : ''}><span>${label}</span></label>`).join('')}</div></div><div class="field s-form-wide"><label>Activities you enjoy <span class="s-optional">optional</span></label><div class="s-interest-grid">${categories.map((category) => `<label class="s-interest"><input type="checkbox" name="interests" value="${esc(category)}" ${(profile.interests || []).includes(category) ? 'checked' : ''}><span>${categoryIcons[category]} ${esc(category)}</span></label>`).join('')}</div></div></div><div class="s-onboard-actions"><span>Required: name, age, sex/gender choice, city, skills and at least one available day.</span><button type="submit" class="btn primary" data-submit>Save profile and continue →</button></div></form></section><p class="s-privacy-foot">You can change these details later in My profile. LINKUP never shows your email or precise location to other members.</p></main>`;
  const ageInput = document.getElementById('profile-age');
  const ageHint = ageInput?.nextElementSibling;
  if (ageHint?.tagName === 'SMALL') ageHint.id = 'profile-age-note';
  const ageError = document.createElement('small');
  ageError.id = 'profile-age-error';
  ageError.className = 's-age-error';
  ageError.setAttribute('aria-live', 'polite');
  ageError.hidden = true;
  ageHint?.insertAdjacentElement('afterend', ageError);
  ageInput?.setAttribute('aria-describedby', 'profile-age-note profile-age-error');
  updateAgeValidation(ageInput);
  applyTheme();
}
function updateAgeValidation(input = document.getElementById('profile-age')) {
  if (!input) return true;
  const age = input.value === '' ? null : Number(input.value);
  const message = age !== null && age < 16
    ? "You're not old enough to use LINKUP. You must be at least 16."
    : '';
  input.setCustomValidity(message);
  const error = document.getElementById('profile-age-error');
  if (error) {
    error.textContent = message;
    error.hidden = !message;
  }
  return !message;
}
function profileCard(profile) {
  if (!profile) return 'LINKUP member';
  const publicName = String(profile.display_name || '').trim().split(/\s+/)[0] || 'LINKUP member';
  return `${esc(publicName)}${profile.age ? `, ${esc(profile.age)}` : ''}`;
}
function pageTitle() {
  return ({ discover: 'Discover', dashboard: 'My activity', saved: 'Saved events', notifications: 'Notifications', profile: 'My profile', settings: 'Settings', help: 'Help & safety', admin: 'Admin dashboard' })[state.page] || 'Discover';
}
const nav = [['discover','⌕','Discover'],['dashboard','▦','My activity'],['saved','♡','Saved events'],['notifications','♧','Notifications'],['profile','◉','My profile'],['settings','⚙','Preferences']];
function renderApp() {
  if (!state.profile?.profile_complete) return renderOnboarding();
  const links = nav.map(([key, icon, label]) => `<button class="s-nav-item ${state.page === key ? 'active' : ''}" data-page="${key}"><span>${icon}</span>${label}</button>`).join('');
  app.innerHTML = `<div class="s-app"><aside class="s-sidebar"><a class="s-brand" href="#" data-page="discover"><span class="brand-mark">↗</span> LINKUP</a><div class="nav-label">Menu</div>${links}${state.isAdmin ? `<div class="nav-label s-admin-label">Administration</div><button class="s-nav-item ${state.page === 'admin' ? 'active' : ''}" data-page="admin"><span>▤</span>Admin dashboard <i>ADMIN</i></button>` : ''}<div class="s-sidebar-bottom"><div class="s-account"><div class="s-avatar">${esc((state.profile.display_name || '?').slice(0,1).toUpperCase())}</div><button class="s-account-name" data-page="profile"><strong>${esc(state.profile.display_name)}</strong><small>${state.isAdmin ? 'Admin account' : 'LINKUP member'}</small></button><button class="s-icon-btn" aria-label="Sign out" data-action="logout">↪</button></div></div></aside><header class="s-mobile-head"><a class="s-brand" href="#" data-page="discover"><span class="brand-mark">↗</span> LINKUP</a><button class="s-mobile-user" data-page="profile">${esc((state.profile.display_name || '?').slice(0,1).toUpperCase())}</button></header><main class="s-main"><header class="s-topbar"><div class="crumb">LINKUP <span>/</span> <b>${pageTitle()}</b></div><div class="s-top-actions"><button class="s-icon-btn" data-action="theme" title="Switch theme">${state.theme === 'dark' ? '☼' : '☾'}</button><button class="s-user-link" data-page="profile">${esc(state.profile.display_name.split(' ')[0])} <span>⌄</span></button></div></header><section class="s-page">${pageContent()}</section></main><nav class="s-mobile-nav">${links}${state.isAdmin ? `<button class="s-nav-item ${state.page === 'admin' ? 'active' : ''}" data-page="admin"><span>▤</span>Admin</button>` : ''}</nav></div>`;
  renderModal();
}
function pageContent() {
  if (state.page === 'dashboard') return dashboardPage();
  if (state.page === 'saved') return savedPage();
  if (state.page === 'notifications') return notificationsPage();
  if (state.page === 'profile') return profilePage();
  if (state.page === 'settings') return settingsPage();
  if (state.page === 'help') return helpPage();
  if (state.page === 'admin' && state.isAdmin) return adminPage();
  state.page = 'discover';
  return discoverPage();
}
function filteredEvents() {
  const today = localDateISO();
  const week = new Date(); week.setDate(week.getDate() + 6);
  const weekEnd = localDateISO(week);
  const rows = state.events.filter((event) => {
    if (state.blockedIds.includes(event.host_id)) return false;
    const phrase = `${event.title} ${event.category} ${event.city} ${event.public_place} ${event.description}`.toLowerCase();
    const location = `${event.city} ${event.public_place}`.toLowerCase();
    const budgetValue = Number((event.budget.match(/\d+/) || [])[0] || 0);
    const dateMatches = state.dateFilter === 'Any date' || (state.dateFilter === 'Today' ? event.event_date === today : state.dateFilter === 'This week' ? event.event_date >= today && event.event_date <= weekEnd : true);
    const skillMatches = state.skillFilter === 'Any skill' || !event.skill_level || Number(event.skill_level) === Number(state.skillFilter);
    const budgetMatches = state.budgetFilter === 'Any budget' || (state.budgetFilter === 'Free' ? event.budget.toLowerCase() === 'free' : budgetValue <= Number((state.budgetFilter.match(/\d+/) || [])[0] || Infinity));
    return (state.category === 'All' || event.category === state.category)
      && (!state.search || phrase.includes(state.search.toLowerCase()))
      && (!state.locationQuery || location.includes(state.locationQuery.toLowerCase()))
      && dateMatches && skillMatches && budgetMatches;
  });
  const score = (event) => {
    const profile = state.publicProfiles[event.host_id];
    const cityMatch = event.city.toLowerCase() === state.profile.city.toLowerCase();
    const day = new Date(`${event.event_date}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
    const available = (state.profile.availability || []).includes(day);
    const preferred = (state.profile.interests || []).includes(event.category);
    const skill = Number(state.profile.activity_skills?.[event.category] || 3);
    const levelFit = event.skill_level ? Math.max(0, 2 - Math.abs(skill - Number(event.skill_level))) : 1;
    const ageBounds = (event.age_range || '').match(/\d+/g)?.map(Number) || [];
    const ageFits = !ageBounds.length || (ageBounds.length > 1
      ? Number(state.profile.age) >= ageBounds[0] && Number(state.profile.age) <= ageBounds[1]
      : (event.age_range.includes('+') ? Number(state.profile.age) >= ageBounds[0] : Number(state.profile.age) === ageBounds[0]));
    return (preferred ? 5 : 0) + (cityMatch ? 3 : 0) + (available ? 2 : 0) + levelFit + (ageFits ? 1 : 0) + (profile?.city?.toLowerCase() === state.profile.city.toLowerCase() ? 1 : 0);
  };
  if (state.sortBy === 'soonest') rows.sort((a,b) => `${a.event_date}${a.start_time}`.localeCompare(`${b.event_date}${b.start_time}`));
  else if (state.sortBy === 'spots') rows.sort((a,b) => (b.capacity - attendeesFor(b.id).length) - (a.capacity - attendeesFor(a.id).length));
  else if (state.sortBy === 'popular') rows.sort((a,b) => attendeesFor(b.id).length - attendeesFor(a.id).length);
  else rows.sort((a,b) => score(b) - score(a) || `${a.event_date}${a.start_time}`.localeCompare(`${b.event_date}${b.start_time}`));
  return rows;
}
function recommendedEvents() {
  const already = (event) => attendeesFor(event.id).some((row) => row.user_id === state.user.id);
  return filteredEvents().filter((event) => event.host_id !== state.user.id && !already(event) && attendeesFor(event.id).length < event.capacity).slice(0,3);
}
function attendeesFor(eventId) { return state.attendeeRows.filter((row) => row.event_id === eventId); }
function eventCard(event) {
  const host = state.publicProfiles[event.host_id];
  const count = attendeesFor(event.id).length;
  const going = attendeesFor(event.id).some((row) => row.user_id === state.user.id);
  const spots = Math.max(0, event.capacity - count);
  const date = new Date(`${event.event_date}T${event.start_time}`).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  return `<article class="s-event"><div class="s-event-art"><span>${categoryIcons[event.category] || '✨'}</span><b>${esc(event.category)}</b><button aria-label="${state.savedIds.includes(event.id) ? 'Unsave' : 'Save'} event" class="s-save ${state.savedIds.includes(event.id) ? 'is-saved' : ''}" data-action="save" data-id="${event.id}">${state.savedIds.includes(event.id) ? '♥' : '♡'}</button></div><div class="s-event-body"><div class="s-event-host">Hosted by ${profileCard(host)}</div><h3>${esc(event.title)}</h3><p class="s-event-meta">◷ ${esc(date)}</p><p class="s-event-meta">⌖ ${esc(event.public_place)}, ${esc(event.city)}</p><p class="s-event-meta">Skill ${event.skill_level ? `${event.skill_level}/5` : 'all levels'} · ${esc(event.budget)}</p><div class="s-event-bottom"><span>${count}/${event.capacity} going · ${spots} spots left</span><button class="btn ${going ? 'secondary' : 'primary'}" data-action="event-detail" data-id="${event.id}">${going ? 'View plan' : 'See plan'}</button></div></div></article>`;
}
function eventGrid(events) {
  return events.length ? `<div class="s-event-grid">${events.map(eventCard).join('')}</div>` : `<div class="empty-state"><div class="empty-icon">✳</div><h3>No plans yet</h3><p>Try another category or be the first to host something.</p><button class="btn primary" data-action="create-event">＋ Create an event</button></div>`;
}
function discoverPage() {
  const today = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  const todayISO = localDateISO();
  const todayCount = filteredEvents().filter((event) => event.event_date === todayISO).length;
  const recommended = recommendedEvents();
  const suggested = recommended[0];
  const matchingDays = new Set(recommended.map((event) => event.event_date));
  const matchingIds = new Set(recommended.flatMap((event) => attendeesFor(event.id).map((row) => row.user_id)));
  const matchBanner = suggested ? `<div class="s-match-banner"><span class="s-match-icon">✳</span><div><strong>${matchingIds.size} ${matchingIds.size === 1 ? 'person is' : 'people are'} already going to ${esc(suggested.category.toLowerCase())} plans near ${esc(state.profile.city)}.</strong><span>${matchingDays.size === 1 ? 'A good fit for your activity, city and availability.' : 'Several days match your profile.'}</span></div><button class="text-button" data-action="event-detail" data-id="${suggested.id}">See a match →</button></div>` : '';
  return `<section class="s-hero"><div class="eyebrow">${esc(today)} · ${esc(state.profile.city)}</div><h1>Good things happen when you link up.</h1><p>Don’t search for people. Find people who already want to do the same thing.</p><button class="btn primary" data-action="create-event">＋ Create an event</button></section>${matchBanner}<div class="s-page-head"><div><div class="eyebrow">Find your kind of fun</div><h1>${state.category === 'All' ? 'Plans near you' : `${esc(state.category)} plans`}</h1><p>${todayCount} plans happening today · shared activities, familiar faces, new friends.</p></div></div><div class="s-filters"><input class="control" id="event-search" type="search" placeholder="Search activities and places…" value="${esc(state.search)}"><input class="control" id="location-search" type="search" placeholder="City or area" value="${esc(state.locationQuery)}"><select class="filter-select" id="category-filter"><option>All</option>${categories.map((category) => `<option ${state.category === category ? 'selected' : ''}>${esc(category)}</option>`).join('')}</select><select class="filter-select" id="date-filter"><option>Any date</option>${['Today','This week'].map((x) => `<option ${state.dateFilter === x ? 'selected' : ''}>${x}</option>`).join('')}</select><select class="filter-select" id="skill-filter"><option>Any skill</option>${[1,2,3,4,5].map((x) => `<option value="${x}" ${Number(state.skillFilter) === x ? 'selected' : ''}>Skill ${x}/5</option>`).join('')}</select><select class="filter-select" id="budget-filter"><option>Any budget</option>${['Free','Up to 150 Kč','Up to 300 Kč'].map((x) => `<option ${state.budgetFilter === x ? 'selected' : ''}>${x}</option>`).join('')}</select><select class="filter-select" id="sort-filter"><option value="recommended" ${state.sortBy === 'recommended' ? 'selected' : ''}>Recommended</option><option value="soonest" ${state.sortBy === 'soonest' ? 'selected' : ''}>Soonest</option><option value="spots" ${state.sortBy === 'spots' ? 'selected' : ''}>Most spots</option><option value="popular" ${state.sortBy === 'popular' ? 'selected' : ''}>Most popular</option></select><button class="btn outline" data-action="refresh">Refresh</button></div>${eventGrid(filteredEvents())}`;
}
function dashboardPage() {
  const mine = state.events.filter((event) => event.host_id === state.user.id || attendeesFor(event.id).some((row) => row.user_id === state.user.id));
  return `<div class="s-page-head"><div><div class="eyebrow">Your corner</div><h1>My activity</h1><p>Events you host and plans you have joined.</p></div><button class="btn primary" data-action="create-event">＋ Create an event</button></div>${eventGrid(mine)}`;
}
function savedPage() {
  return `<div class="s-page-head"><div><div class="eyebrow">For later</div><h1>Saved events</h1><p>Good plans worth keeping close.</p></div></div>${eventGrid(state.events.filter((event) => state.savedIds.includes(event.id)))}`;
}
async function loadNotifications() {
  const { data, error } = await supabase.from('notifications')
    .select('id,event_id,kind,title,body,created_at,read_at')
    .eq('user_id', state.user.id)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw error;
  state.notifications = data || [];
}
function stopNotificationSubscription() {
  if (notificationChannel) void supabase.removeChannel(notificationChannel);
  notificationChannel = null;
  notificationChannelUserId = null;
}
function subscribeToNotifications(userId) {
  if (notificationChannelUserId === userId) return;
  stopNotificationSubscription();
  notificationChannelUserId = userId;
  notificationChannel = supabase.channel(`linkup-notifications-${userId}`)
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'notifications',
      filter: `user_id=eq.${userId}`,
    }, ({ new: notification }) => {
      if (!notification?.id || notification.user_id !== state.user?.id) return;
      state.notifications = [notification, ...state.notifications.filter((item) => item.id !== notification.id)].slice(0, 50);
      toast('You have a new LINKUP update.');
      if (state.page === 'notifications') renderApp();
    })
    .subscribe();
}
async function markNotificationRead(id = null) {
  const readAt = new Date().toISOString();
  let query = supabase.from('notifications').update({ read_at: readAt }).eq('user_id', state.user.id).is('read_at', null);
  if (id) query = query.eq('id', id);
  const { error } = await query;
  if (error) throw error;
  state.notifications = state.notifications.map((notification) => (
    !id || notification.id === id ? { ...notification, read_at: readAt } : notification
  ));
}
async function openNotificationEvent(eventId, notificationId) {
  try {
    await markNotificationRead(notificationId);
    let event = state.events.find((row) => row.id === eventId);
    if (!event) {
      const result = await supabase.from('events').select('*').eq('id', eventId).eq('status', 'published').maybeSingle();
      if (result.error) throw result.error;
      event = result.data;
      if (event) state.events.push(event);
    }
    if (!event) {
      toast('This event is no longer available.', 'error');
      renderApp();
      return;
    }
    state.modal = `event:${eventId}`;
    renderApp();
  } catch (error) {
    toast(errorText(error), 'error');
  }
}
function notificationsPage() {
  const unread = state.notifications.filter((notification) => !notification.read_at).length;
  const rows = state.notifications.map((notification) => `
    <article class="s-notification ${notification.read_at ? 'is-read' : 'is-unread'}">
      <div class="s-notification-mark">${notification.kind === 'event_joined' ? '＋' : notification.kind === 'event_updated' ? '↻' : '!'}</div>
      <div class="s-notification-copy">
        <strong>${esc(notification.title)}</strong>
        <p>${esc(notification.body)}</p>
        <time datetime="${esc(notification.created_at)}">${esc(new Date(notification.created_at).toLocaleString())}</time>
        ${notification.event_id ? `<button class="text-button" data-action="notification-event" data-id="${esc(notification.event_id)}" data-notification="${esc(notification.id)}">Open event →</button>` : ''}
      </div>
      ${notification.read_at ? '<span class="s-read-label">Read</span>' : `<button class="text-button" data-action="mark-notification" data-id="${esc(notification.id)}">Mark read</button>`}
    </article>`).join('');
  return `
    <div class="s-page-head">
      <div><div class="eyebrow">Your LINKUP updates</div><h1>Notifications</h1><p>Event bookings and changes from your plans.</p></div>
      <button class="btn outline" data-action="mark-all-notifications" ${unread ? '' : 'disabled'}>Mark all read${unread ? ` · ${unread}` : ''}</button>
    </div>
    <section class="panel s-notifications-panel">
      ${rows || '<div class="s-empty-notifications"><strong>You’re all caught up.</strong><p>Updates about your events will appear here.</p></div>'}
    </section>`;
}
function profilePage() {
  const days = (state.profile.availability || []).map((day) => day[0].toUpperCase() + day.slice(1)).join(', ');
  const skillChips = categories.map((category) => `<span class="s-chip">${categoryIcons[category]} ${esc(category)} · ${Number(state.profile.activity_skills?.[category] || 1)}/5</span>`).join('');
  return `<div class="s-page-head"><div><div class="eyebrow">The person behind the plans</div><h1>My profile</h1><p>Your details help LINKUP recommend activities that fit.</p></div><button class="btn primary" data-action="edit-profile">Edit profile</button></div><section class="s-profile-banner"><div class="s-profile-avatar">${esc(state.profile.display_name.slice(0,1).toUpperCase())}</div><div><h2>${esc(state.profile.display_name)}, ${state.profile.age}</h2><p>⌖ ${esc(state.profile.city)}</p><p class="s-profile-bio">${esc(state.profile.bio || "Add a short bio about the activities you enjoy.")}</p></div></section><div class="s-two-col"><section class="panel"><div class="panel-head"><h2 class="panel-title">Activity skills</h2></div><div class="s-interest-grid">${skillChips}</div><div class="section-head"><h3>Your interests</h3></div><div class="s-interest-grid">${(state.profile.interests || []).map((category) => `<span class="s-chip">${categoryIcons[category] || '✨'} ${esc(category)}</span>`).join('') || '<span class="s-subtle">No interests selected yet.</span>'}</div></section><section class="panel"><div class="panel-head"><h2 class="panel-title">Profile details</h2></div>${[['Email',state.user.email],['Age',state.profile.age],['City or area',state.profile.city],['Usually available',days || 'Not set'],['Gender','Private to you']].map(([label,value]) => `<div class="s-detail-row"><strong>${label}</strong><span>${esc(value)}</span></div>`).join('')}<p class="s-privacy-note">Your email, gender and exact coordinates are private. Your public profile shares your first name, age, city, bio and activity details.</p></section></div>`;
}
function settingsPage() {
  return `<div class="s-page-head"><div><div class="eyebrow">Make it yours</div><h1>Preferences</h1><p>Choose how LINKUP looks on this device.</p></div></div><div class="s-two-col"><section class="panel"><div class="panel-head"><h2 class="panel-title">Appearance</h2></div><div class="s-theme-buttons">${[['light','☀ Light'],['dark','☾ Dark'],['system','◐ System']].map(([value,label]) => `<button class="category ${state.theme === value ? 'active' : ''}" data-theme="${value}">${label}</button>`).join('')}</div><p class="s-subtle">Your theme choice is stored in this browser.</p></section><section class="panel"><div class="panel-head"><h2 class="panel-title">Account</h2></div><p>${esc(state.user.email)}</p><p class="s-subtle">Approximate location sharing: ${state.locationShared ? 'on' : 'off'}.</p>${state.locationShared ? `<button class="btn outline small" data-action="remove-location">Remove saved approximate location</button>` : ''}<p class="s-privacy-note">You can share location again from your profile setup. LINKUP stores only the rounded area you approved.</p><button class="btn outline" data-action="logout">Sign out</button></section></div>`;
}
function helpPage() {
  return `<div class="s-page-head"><div><div class="eyebrow">Meet well, feel safe</div><h1>Help & safety</h1><p>Simple steps for good meetups and a community that feels welcoming.</p></div></div><div class="s-two-col"><section class="panel"><div class="panel-head"><h2 class="panel-title">Before you meet</h2></div><div class="s-safety-item"><strong>Choose a public place</strong><p>Meet at a cafe, park entrance, sports venue or another busy public spot, especially the first time.</p></div><div class="s-safety-item"><strong>Keep private details private</strong><p>Share your home address, phone number or live location only when you feel comfortable.</p></div><div class="s-safety-item"><strong>Trust your judgement</strong><p>You can leave a plan at any time. Let someone you trust know where you are going.</p></div></section><section class="panel"><div class="panel-head"><h2 class="panel-title">Need help with a member?</h2></div><p class="s-subtle">Open an event and choose Report host or Block host. Reports go to LINKUP administrators; blocked members and their events are hidden from your feed.</p><p class="s-privacy-note">If you are in immediate danger, contact your local emergency services.</p><button class="btn secondary" data-page="discover">Browse activities</button></section></div>`;
}
function adminPage() {
  return `<div class="s-page-head"><div><div class="eyebrow">Private tools · administrators only</div><h1>Admin dashboard</h1><p>Review members, events and safety reports. All actions are checked again by database access rules.</p></div><span class="s-admin-pill">ADMIN</span></div><div class="s-admin-stats"><div class="panel"><span>Members</span><strong>${state.adminProfiles.length}</strong></div><div class="panel"><span>Published events</span><strong>${state.adminEvents.filter((event) => event.status === 'published').length}</strong></div><div class="panel"><span>Open reports</span><strong>${state.reports.filter((report) => report.status === 'open' || report.status === 'reviewing').length}</strong></div></div><section class="panel s-admin-panel"><div class="panel-head"><h2 class="panel-title">Safety reports</h2><button class="btn outline small" data-action="refresh-admin">Refresh</button></div>${state.reports.length ? `<div class="s-table-wrap"><table><thead><tr><th>Reason</th><th>Reported member</th><th>Event</th><th>Status</th><th>Received</th><th></th></tr></thead><tbody>${state.reports.map((report) => `<tr><td>${esc(report.reason)}<small>${esc(report.details || '')}</small></td><td>${esc(state.adminProfiles.find((p) => p.id === report.reported_user_id)?.display_name || 'Not specified')}</td><td>${esc(state.adminEvents.find((event) => event.id === report.event_id)?.title || '—')}</td><td><span class="s-status">${esc(report.status)}</span></td><td>${new Date(report.created_at).toLocaleDateString()}</td><td><select aria-label="Update report status" data-report-status="${report.id}"><option value="">Update…</option><option value="reviewing">Reviewing</option><option value="resolved">Resolved</option><option value="dismissed">Dismissed</option></select></td></tr>`).join('')}</tbody></table></div>` : `<p class="s-subtle">No safety reports have been submitted.</p>`}</section><section class="panel s-admin-panel"><div class="panel-head"><h2 class="panel-title">Members</h2></div><div class="s-table-wrap"><table><thead><tr><th>Name</th><th>Age</th><th>City</th><th>Joined</th></tr></thead><tbody>${state.adminProfiles.map((profile) => `<tr><td>${esc(profile.display_name)}</td><td>${profile.age}</td><td>${esc(profile.city)}</td><td>${new Date(profile.created_at).toLocaleDateString()}</td></tr>`).join('')}</tbody></table></div></section><section class="panel s-admin-panel"><div class="panel-head"><h2 class="panel-title">Events</h2></div><div class="s-table-wrap"><table><thead><tr><th>Plan</th><th>Host</th><th>When</th><th>Location</th><th></th></tr></thead><tbody>${state.adminEvents.map((event) => `<tr><td>${esc(event.title)}<small>${esc(event.category)} · ${esc(event.status)}</small></td><td>${esc(state.adminProfiles.find((p) => p.id === event.host_id)?.display_name || 'Member')}</td><td>${esc(event.event_date)} · ${esc(String(event.start_time).slice(0,5))}</td><td>${esc(event.city)}</td><td><button class="btn danger small" data-action="admin-delete-event" data-id="${event.id}">Remove</button></td></tr>`).join('')}</tbody></table></div></section>`;
}
async function loadAdmin() {
  if (!state.isAdmin) return;
  const [profiles, events, reports] = await Promise.all([
    supabase.from('profiles').select('id,display_name,age,city,created_at').order('created_at', { ascending: false }),
    supabase.from('events').select('*').order('created_at', { ascending: false }),
    supabase.from('reports').select('*').order('created_at', { ascending: false }),
  ]);
  for (const result of [profiles, events, reports]) if (result.error) throw result.error;
  state.adminProfiles = profiles.data || [];
  state.adminEvents = events.data || [];
  state.reports = reports.data || [];
}
function renderModal() {
  if (!state.modal) { modalRoot.innerHTML = ''; return; }
  if (state.modal === 'event-form') {
    const event = state.editingId ? state.events.find((item) => item.id === state.editingId) : null;
    modalRoot.innerHTML = `<div class="modal-backdrop" data-close><section class="modal wide s-modal" role="dialog" aria-modal="true"><header class="modal-header"><div><div class="eyebrow">Bring people together</div><h2>${event ? 'Edit your plan' : 'Create an event'}</h2><p>Choose a public place and give people the details they need.</p></div><button class="close-btn" data-action="close">×</button></header><form id="event-form"><div class="form-grid"><div class="field"><label>Activity or event name *</label><input name="title" required minlength="3" maxlength="100" value="${esc(event?.title || '')}" placeholder="e.g. Sunset badminton"></div><div class="field"><label>Category *</label><select name="category" required>${categories.map((category) => `<option ${event?.category === category ? 'selected' : ''}>${esc(category)}</option>`).join('')}</select></div><div class="field"><label>Date *</label><input name="event_date" type="date" min="${localDateISO()}" required value="${esc(event?.event_date || '')}"></div><div class="field"><label>Start time *</label><input name="start_time" type="time" required value="${esc(String(event?.start_time || '').slice(0,5))}"></div><div class="field"><label>City or area *</label><input name="city" required minlength="2" maxlength="100" value="${esc(event?.city || state.profile.city)}"></div><div class="field"><label>Public meeting place *</label><input name="public_place" required minlength="2" maxlength="180" placeholder="e.g. Letná Park entrance" value="${esc(event?.public_place || '')}"></div><div class="field"><label>Skill level</label><select name="skill_level"><option value="">All levels</option>${[1,2,3,4,5].map((n) => `<option value="${n}" ${Number(event?.skill_level) === n ? 'selected' : ''}>${n} · ${skillLabels[n - 1]}</option>`).join('')}</select></div><div class="field"><label>Budget</label><input name="budget" maxlength="80" placeholder="Free / under 200 Kč" value="${esc(event?.budget || 'Free')}"></div><div class="field"><label>Maximum people *</label><input name="capacity" type="number" min="2" max="50" required value="${event?.capacity || 4}"></div><div class="field"><label>Age range</label><input name="age_range" maxlength="40" value="${esc(event?.age_range || 'Any age')}" placeholder="Any age"></div><div class="field s-form-wide"><label>Description</label><textarea name="description" maxlength="2000" placeholder="What should people expect?">${esc(event?.description || '')}</textarea></div></div><p class="form-note">Meet in a public place. Keep private addresses and exact home locations off your event.</p><div class="modal-actions"><button type="button" class="btn secondary" data-action="close">Cancel</button><button class="btn primary" type="submit" data-submit>${event ? 'Save changes' : 'Publish event →'}</button></div></form></section></div>`;
    return;
  }
  if (state.modal.startsWith('event:')) { renderEventDetail(state.modal.slice(6)); return; }
  if (state.modal.startsWith('report:')) {
    const event = state.events.find((item) => item.id === state.modal.slice(7));
    modalRoot.innerHTML = `<div class="modal-backdrop" data-close><section class="modal s-modal" role="dialog" aria-modal="true"><header class="modal-header"><div><div class="eyebrow">Help keep LINKUP safe</div><h2>Report this event or host</h2><p>Reports are private and sent to an administrator.</p></div><button class="close-btn" data-action="close">×</button></header><form id="report-form"><input type="hidden" name="event_id" value="${esc(event?.id || '')}"><input type="hidden" name="reported_user_id" value="${esc(event?.host_id || '')}"><div class="field"><label>Reason *</label><select name="reason" required><option value="">Choose a reason</option>${['Safety concern','Harassment','Spam or scam','Inaccurate event details','Other'].map((reason) => `<option>${esc(reason)}</option>`).join('')}</select></div><div class="field s-report-details"><label>Details</label><textarea name="details" maxlength="2000" placeholder="Tell us what happened."></textarea></div><div class="modal-actions"><button type="button" class="btn secondary" data-action="close">Cancel</button><button class="btn primary" type="submit" data-submit>Send report</button></div></form></section></div>`;
  }
}
async function renderEventDetail(id) {
  const event = state.events.find((item) => item.id === id) || state.adminEvents.find((item) => item.id === id);
  if (!event) { state.modal = null; renderModal(); return; }
  const attendees = await supabase.from('event_attendees').select('user_id').eq('event_id', event.id);
  if (attendees.error) { toast(errorText(attendees.error), 'error'); return; }
  const attendeeIdsFromDb = (attendees.data || []).map((row) => row.user_id);
  const profiles = await supabase.from('public_profiles').select('id,display_name,age,city,bio,activity_skills').in('id', [...new Set([event.host_id, ...attendeeIdsFromDb])]);
  if (profiles.error) { toast(errorText(profiles.error), 'error'); return; }
  const allProfiles = Object.fromEntries((profiles.data || []).map((profile) => [profile.id, profile]));
  const attendeeIds = [...new Set([event.host_id, ...(attendees.data || []).map((row) => row.user_id)])];
  const isHost = event.host_id === state.user.id;
  const isGoing = attendeeIds.includes(state.user.id);
  const count = attendeeIds.length;
  const date = new Date(`${event.event_date}T${event.start_time}`).toLocaleString(undefined, { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const rows = attendeeIds.map((userId) => `<div class="attendee-row"><div class="s-avatar">${esc((allProfiles[userId]?.display_name || 'L').slice(0,1).toUpperCase())}</div><div><strong>${profileCard(allProfiles[userId])}${userId === state.user.id ? ' · You' : ''}</strong><span>${userId === event.host_id ? 'Host' : 'Going'} · ${esc(allProfiles[userId]?.city || '')}</span>${allProfiles[userId]?.bio ? `<p class="s-attendee-bio">${esc(allProfiles[userId].bio)}</p>` : ''}</div></div>`).join('');
  modalRoot.innerHTML = `<div class="modal-backdrop" data-close><section class="modal s-modal" role="dialog" aria-modal="true"><header class="modal-header"><div><div class="eyebrow">${categoryIcons[event.category] || '✨'} ${esc(event.category)}</div><h2>${esc(event.title)}</h2><p>Hosted by ${profileCard(allProfiles[event.host_id])}</p></div><button class="close-btn" data-action="close">×</button></header><div class="s-event-detail"><p><strong>When</strong><span>${esc(date)}</span></p><p><strong>Where</strong><span>${esc(event.public_place)}, ${esc(event.city)}</span></p><p><strong>Skill level</strong><span>${event.skill_level ? `${event.skill_level}/5` : 'All levels'}</span></p><p><strong>Budget</strong><span>${esc(event.budget)}</span></p><p><strong>People</strong><span>${count} of ${event.capacity} · ${Math.max(0,event.capacity - count)} spots left</span></p></div>${event.description ? `<p class="s-event-description">${esc(event.description)}</p>` : ''}<div class="eyebrow">Attendees</div>${rows}<div class="s-detail-actions">${!isHost ? `<button class="text-button" data-action="report-event" data-id="${event.id}">Report</button><button class="text-button" data-action="block-host" data-id="${event.host_id}">Block host</button>` : `<button class="btn outline" data-action="edit-event" data-id="${event.id}">Edit plan</button><button class="btn danger" data-action="delete-event" data-id="${event.id}">Delete</button>`}${isHost ? '' : isGoing ? `<button class="btn outline" data-action="leave-event" data-id="${event.id}">Leave event</button>` : `<button class="btn primary" data-action="join-event" data-id="${event.id}" ${count >= event.capacity ? 'disabled' : ''}>${count >= event.capacity ? 'Event is full' : 'Join this event →'}</button>`}</div><p class="legal-note">Choose public meeting places. LINKUP never shares precise private addresses.</p></section></div>`;
}
function renderPasswordUpdate() {
  state.resetMode = true;
  state.resetStage = 'password';
  modalRoot.innerHTML = `<div class="modal-backdrop"><section class="modal s-modal" role="dialog" aria-modal="true"><div class="eyebrow">Account recovery</div><h2>Choose a new password.</h2><form id="password-update-form"><div class="field"><label for="recovery-new-password">New password</label><div class="s-password-control"><input id="recovery-new-password" type="password" name="password" minlength="10" autocomplete="new-password" required><button class="s-password-toggle" type="button" data-action="toggle-password" aria-label="Show password" title="Show password"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg></button></div></div><div class="field"><label for="recovery-confirm-password">Confirm new password</label><div class="s-password-control"><input id="recovery-confirm-password" type="password" name="confirm" minlength="10" autocomplete="new-password" required><button class="s-password-toggle" type="button" data-action="toggle-password" aria-label="Show password" title="Show password"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg></button></div></div><div class="modal-actions"><button class="btn primary" type="submit" data-submit>Update password</button></div></form></section></div>`;
}
function changePage(page) {
  state.page = page;
  state.modal = null;
  const task = page === 'admin' ? loadAdmin() : page === 'notifications' ? loadNotifications() : refreshData();
  Promise.resolve(task).then(renderApp).catch((error) => toast(errorText(error), 'error'));
}
async function submitAuth(form) {
  const fields = new FormData(form);
  const email = String(fields.get('email') || '').trim().toLowerCase();
  state.lastEmail = email;
  if (state.resetMode && state.resetStage === 'request') { await sendRecoveryEmail(email); return; }
  setBusy(true);
  try {
    if (state.resetMode) {
      const token = String(fields.get('token') || '').trim();
      const { data, error } = await supabase.auth.verifyOtp({ email, token, type: 'recovery' });
      if (error) throw error;
      state.session = data.session;
      state.user = data.user;
      state.resetStage = 'password';
      renderPasswordUpdate();
      return;
    }
    if (state.authMode === 'signup') {
      const displayName = String(fields.get('name') || '').trim();
      const { data, error } = await supabase.auth.signUp({
        email, password: String(fields.get('password') || ''),
        options: { data: { display_name: displayName }, emailRedirectTo: `${location.origin}${location.pathname}` },
      });
      if (error) throw error;
      if (data.session) await loadSession(data.session);
      else renderCheckEmail(email);
    } else {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password: String(fields.get('password') || '') });
      if (error) throw error;
      await loadSession(data.session);
    }
  } catch (error) {
    toast(errorText(error), 'error');
  } finally { setBusy(false); }
}
async function sendRecoveryEmail(email = state.lastEmail) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedEmail) { toast('Enter your email address first.', 'error'); return; }
  state.lastEmail = normalizedEmail;
  setBusy(true);
  try {
    const { error } = await supabase.auth.resetPasswordForEmail(normalizedEmail, { redirectTo: `${location.origin}${location.pathname}` });
    if (error) throw error;
    state.resetMode = true;
    state.resetStage = 'code';
    renderAuth(`If an account exists for ${normalizedEmail}, a password recovery email was sent. Open its secure link in this browser, or enter the code if your email contains one.`);
  } catch (error) { toast(errorText(error), 'error'); }
  finally { setBusy(false); }
}
function getLocation() {
  const status = document.querySelector('.s-location-status');
  if (!navigator.geolocation) {
    if (status) status.textContent = 'Location access is not available in this browser. Enter your city instead.';
    return;
  }
  if (status) status.textContent = 'Waiting for location permission…';
  navigator.geolocation.getCurrentPosition((position) => {
    state.location = { latitude: Math.round(position.coords.latitude * 100) / 100, longitude: Math.round(position.coords.longitude * 100) / 100 };
    state.locationGranted = true;
    renderOnboarding();
    const message = document.querySelector('.s-location-status');
    if (message) message.textContent = 'Approximate location ready. We rounded it before saving.';
  }, (error) => {
    if (status) status.textContent = error.code === error.PERMISSION_DENIED ? 'Location was not shared. Your city is enough to continue.' : 'Could not get your location. You can continue with your city.';
  }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 });
}
async function submitProfile(form) {
  const fields = new FormData(form);
  const ageValue = String(fields.get('age') || '');
  const age = Number(ageValue);
  if (!Number.isInteger(age) || age < 16) {
    const ageInput = document.getElementById('profile-age');
    updateAgeValidation(ageInput);
    ageInput?.focus();
    ageInput?.reportValidity();
    return;
  }
  const availability = fields.getAll('availability');
  if (!availability.length) { toast('Choose at least one day you are usually available.', 'error'); return; }
  const gender = String(fields.get('gender') || 'prefer_not_to_say');
  const selfGender = String(fields.get('self_described_gender') || '').trim();
  if (!fields.get('gender')) { toast('Choose an option for sex/gender, or select “Prefer not to say.”', 'error'); return; }
  if (gender === 'self_described' && !selfGender) { toast('Add a short description, or choose another gender option.', 'error'); return; }
  const skills = Object.fromEntries(categories.map((category) => [category, Number(fields.get(`skill_${category}`))]));
  const profile = {
    id: state.user.id,
    display_name: String(fields.get('display_name') || '').trim(),
    age,
    city: String(fields.get('city') || '').trim(),
    bio: String(fields.get('bio') || '').trim(),
    interests: fields.getAll('interests'),
    activity_skills: skills,
    availability,
    profile_complete: true,
  };
  setBusy(true);
  try {
    const genderRow = { user_id: state.user.id, gender, self_described_gender: gender === 'self_described' ? selfGender : null };
    const genderSave = await supabase.from('private_demographics').upsert(genderRow, { onConflict: 'user_id' });
    if (genderSave.error) throw genderSave.error;
    const { error } = await supabase.from('profiles').upsert(profile, { onConflict: 'id' });
    if (error) throw error;
    if (state.locationGranted && state.location) {
      const locationSave = await supabase.from('profile_locations').upsert({
        user_id: state.user.id,
        approximate_latitude: state.location.latitude,
        approximate_longitude: state.location.longitude,
      }, { onConflict: 'user_id' });
      if (locationSave.error) throw locationSave.error;
    }
    state.profile = { ...profile, created_at: state.profile?.created_at || new Date().toISOString() };
    state.gender = gender;
    state.selfGender = gender === 'self_described' ? selfGender : '';
    state.page = 'discover';
    await refreshData();
    renderApp();
    toast('Your profile is ready. Find your people!');
  } catch (error) {
    toast(errorText(error), 'error');
  } finally { setBusy(false); }
}
function eventPayload(fields) {
  return {
    host_id: state.user.id,
    title: String(fields.get('title') || '').trim(),
    category: String(fields.get('category') || 'Social'),
    description: String(fields.get('description') || '').trim(),
    event_date: String(fields.get('event_date') || ''),
    start_time: String(fields.get('start_time') || ''),
    city: String(fields.get('city') || '').trim(),
    public_place: String(fields.get('public_place') || '').trim(),
    capacity: Number(fields.get('capacity') || 4),
    skill_level: fields.get('skill_level') ? Number(fields.get('skill_level')) : null,
    age_range: String(fields.get('age_range') || 'Any age').trim(),
    budget: String(fields.get('budget') || 'Free').trim(),
  };
}
async function submitEvent(form) {
  const payload = eventPayload(new FormData(form));
  const startsAt = new Date(`${payload.event_date}T${payload.start_time}`);
  if (!Number.isFinite(startsAt.getTime()) || startsAt <= new Date()) {
    toast('Choose a future date and time for your event.', 'error');
    return;
  }
  setBusy(true);
  try {
    const result = state.editingId
      ? await supabase.from('events').update(payload).eq('id', state.editingId).eq('host_id', state.user.id)
      : await supabase.from('events').insert(payload);
    if (result.error) throw result.error;
    state.modal = null;
    state.editingId = null;
    await refreshData();
    renderApp();
    toast('Your event is updated and live.');
  } catch (error) { toast(errorText(error), 'error'); }
  finally { setBusy(false); }
}
async function submitReport(form) {
  const fields = new FormData(form);
  setBusy(true);
  try {
    const { error } = await supabase.from('reports').insert({
      reporter_id: state.user.id,
      reported_user_id: String(fields.get('reported_user_id') || '') || null,
      event_id: String(fields.get('event_id') || '') || null,
      reason: String(fields.get('reason') || ''),
      details: String(fields.get('details') || '').trim(),
    });
    if (error) throw error;
    state.modal = null; renderModal(); toast('Thanks. Your report was sent to the LINKUP admin.');
  } catch (error) { toast(errorText(error), 'error'); }
  finally { setBusy(false); }
}
async function withRefresh(action, success) {
  try {
    await action();
    await refreshData();
    renderApp();
    if (success) toast(success);
  } catch (error) { toast(errorText(error), 'error'); }
}
async function saveEvent(id) {
  const saved = state.savedIds.includes(id);
  return withRefresh(async () => {
    const result = saved
      ? await supabase.from('saved_events').delete().eq('user_id', state.user.id).eq('event_id', id)
      : await supabase.from('saved_events').insert({ user_id: state.user.id, event_id: id });
    if (result.error) throw result.error;
  }, saved ? 'Removed from saved events.' : 'Saved for later.');
}
async function joinEvent(id) {
  return withRefresh(async () => { const { error } = await supabase.rpc('join_linkup_event', { p_event_id: id }); if (error) throw error; state.modal = null; }, 'Your spot is booked!');
}
async function leaveEvent(id) {
  return withRefresh(async () => { const { error } = await supabase.rpc('leave_linkup_event', { p_event_id: id }); if (error) throw error; state.modal = null; }, 'You left this event.');
}
async function deleteEvent(id) {
  if (!confirm('Delete this event? This also removes its attendee list and saved copies.')) return;
  return withRefresh(async () => { const { error } = await supabase.from('events').delete().eq('id', id).eq('host_id', state.user.id); if (error) throw error; state.modal = null; }, 'Event deleted.');
}
async function blockMember(id) {
  if (!confirm('Block this host? Their future events will be hidden from your discovery page.')) return;
  return withRefresh(async () => {
    const { error } = await supabase.from('user_blocks').insert({ blocker_id: state.user.id, blocked_id: id });
    if (error && error.code !== '23505') throw error;
    state.blockedIds.push(id); state.modal = null;
  }, 'Host blocked.');
}
async function updateReport(id, status) {
  if (!state.isAdmin || !status) return;
  try {
    const { error } = await supabase.from('reports').update({ status, resolved_at: ['resolved','dismissed'].includes(status) ? new Date().toISOString() : null }).eq('id', id);
    if (error) throw error;
    await loadAdmin(); renderApp(); toast('Report status updated.');
  } catch (error) { toast(errorText(error), 'error'); }
}
async function adminDeleteEvent(id) {
  if (!state.isAdmin || !confirm('Remove this event from LINKUP?')) return;
  try {
    const { error } = await supabase.from('events').delete().eq('id', id);
    if (error) throw error;
    await loadAdmin(); renderApp(); toast('Event removed.');
  } catch (error) { toast(errorText(error), 'error'); }
}
async function signOut() {
  stopNotificationSubscription();
  const { error } = await supabase.auth.signOut();
  if (error) toast(errorText(error), 'error');
  state.session = null; state.user = null; state.profile = null; state.isAdmin = false;
  state.authMode = 'signin'; state.resetMode = false; state.resetStage = 'request'; state.modal = null;
  renderAuth();
}
async function removeLocation() {
  const { error } = await supabase.from('profile_locations').delete().eq('user_id', state.user.id);
  if (error) { toast(errorText(error), 'error'); return; }
  state.locationShared = false;
  renderApp();
  toast('Saved approximate location removed.');
}
async function updatePassword(form) {
  const fields = new FormData(form);
  const password = String(fields.get('password') || '');
  if (password !== String(fields.get('confirm') || '')) { toast('The passwords do not match.', 'error'); return; }
  setBusy(true);
  try {
    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw error;
    state.resetMode = false; state.resetStage = 'request'; modalRoot.innerHTML = '';
    history.replaceState(null, document.title, `${location.pathname}${location.search}`);
    await loadSession(state.session);
    toast('Your password has been updated.');
  } catch (error) { toast(errorText(error), 'error'); }
  finally { setBusy(false); }
}

document.addEventListener('click', (event) => {
  const trigger = event.target.closest('.s-topbar .s-user-link, .s-mobile-head .s-mobile-user');
  const openMenu = document.querySelector('.s-user-menu');
  if (trigger) {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (openMenu) { openMenu.remove(); trigger.setAttribute('aria-expanded', 'false'); return; }
    trigger.setAttribute('aria-expanded', 'true');
    trigger.insertAdjacentHTML('afterend', `<div class="s-user-menu" role="menu"><button role="menuitem" data-page="profile">My profile</button><button role="menuitem" data-page="settings">Settings</button><button role="menuitem" data-page="help">Help &amp; safety</button><button role="menuitem" data-action="logout">Logout</button></div>`);
    return;
  }
  if (openMenu && !openMenu.contains(event.target)) openMenu.remove();
}, true);
document.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-action],[data-page],[data-theme]');
  if (!button) { if (event.target.matches('[data-close]')) { state.modal = null; renderModal(); } return; }
  if (button.dataset.page) { event.preventDefault(); changePage(button.dataset.page); return; }
  if (button.dataset.theme) { state.theme = button.dataset.theme; applyTheme(); renderApp(); return; }
  const id = button.dataset.id;
  switch (button.dataset.action) {
    case 'toggle-password': {
      const input = button.closest('.s-password-control')?.querySelector('input') || document.getElementById('auth-password');
      if (input) { input.type = input.type === 'password' ? 'text' : 'password'; button.setAttribute('aria-label', input.type === 'password' ? 'Show password' : 'Hide password'); button.title = input.type === 'password' ? 'Show password' : 'Hide password'; }
      break;
    }
    case 'auth-switch': state.authMode = state.authMode === 'signup' ? 'signin' : 'signup'; renderAuth(); break;
    case 'forgot-password': state.lastEmail = document.getElementById('auth-email')?.value?.trim() || state.lastEmail; state.resetMode = true; state.resetStage = 'request'; renderAuth(); break;
    case 'resend-recovery-email': await sendRecoveryEmail(state.lastEmail); break;
    case 'edit-recovery-email': state.resetStage = 'request'; renderAuth(); break;
    case 'cancel-reset': state.authMode = 'signin'; state.resetMode = false; state.resetStage = 'request'; renderAuth(); break;
    case 'back-signin': state.authMode = 'signin'; state.resetMode = false; state.resetStage = 'request'; renderAuth(); break;
    case 'mark-notification': try { await markNotificationRead(id); renderApp(); } catch (error) { toast(errorText(error), 'error'); } break;
    case 'mark-all-notifications': try { await markNotificationRead(); renderApp(); } catch (error) { toast(errorText(error), 'error'); } break;
    case 'notification-event': await openNotificationEvent(id, button.dataset.notification); break;
    case 'logout': await signOut(); break;
    case 'reload': await loadSession(state.session); break;
    case 'request-location': getLocation(); break;
    case 'theme': state.theme = state.theme === 'dark' ? 'light' : 'dark'; applyTheme(); renderApp(); break;
    case 'create-event': state.modal = 'event-form'; state.editingId = null; renderModal(); break;
    case 'edit-profile': state.page = 'onboarding'; state.locationGranted = false; state.location = null; renderOnboarding(); break;
    case 'close': state.modal = null; renderModal(); break;
    case 'refresh': await withRefresh(async () => {}, 'Plans refreshed.'); break;
    case 'refresh-admin': try { await loadAdmin(); renderApp(); } catch (err) { toast(errorText(err), 'error'); } break;
    case 'event-detail': state.modal = `event:${id}`; await renderEventDetail(id); break;
    case 'save': await saveEvent(id); break;
    case 'join-event': await joinEvent(id); break;
    case 'leave-event': await leaveEvent(id); break;
    case 'edit-event': state.modal = 'event-form'; state.editingId = id; renderModal(); break;
    case 'delete-event': await deleteEvent(id); break;
    case 'report-event': state.modal = `report:${id}`; renderModal(); break;
    case 'block-host': await blockMember(id); break;
    case 'remove-location': await removeLocation(); break;
    case 'admin-delete-event': await adminDeleteEvent(id); break;
  }
});
document.addEventListener('submit', async (event) => {
  if (event.target.id === 'auth-form') { event.preventDefault(); await submitAuth(event.target); }
  if (event.target.id === 'profile-form') { event.preventDefault(); await submitProfile(event.target); }
  if (event.target.id === 'event-form') { event.preventDefault(); await submitEvent(event.target); }
  if (event.target.id === 'report-form') { event.preventDefault(); await submitReport(event.target); }
  if (event.target.id === 'password-update-form') { event.preventDefault(); await updatePassword(event.target); }
});
document.addEventListener('input', (event) => {
  if (event.target.id === 'profile-age') updateAgeValidation(event.target);
  if (event.target.id === 'event-search' || event.target.id === 'location-search') {
    if (event.target.id === 'event-search') state.search = event.target.value;
    else state.locationQuery = event.target.value;
    const cursor = event.target.selectionStart;
    renderApp();
    const input = document.getElementById('event-search');
    input?.focus(); input?.setSelectionRange(cursor, cursor);
  }
});
document.addEventListener('change', (event) => {
  if (event.target.id === 'category-filter') { state.category = event.target.value; renderApp(); }
  if (event.target.id === 'date-filter') { state.dateFilter = event.target.value; renderApp(); }
  if (event.target.id === 'skill-filter') { state.skillFilter = event.target.value; renderApp(); }
  if (event.target.id === 'budget-filter') { state.budgetFilter = event.target.value; renderApp(); }
  if (event.target.id === 'sort-filter') { state.sortBy = event.target.value; renderApp(); }
  if (event.target.id === 'profile-gender') {
    state.gender = event.target.value;
    document.getElementById('self-gender-wrap')?.classList.toggle('s-hidden', state.gender !== 'self_described');
  }
  if (event.target.dataset.reportStatus) void updateReport(event.target.dataset.reportStatus, event.target.value);
});

applyTheme();
supabase.auth.onAuthStateChange((event, session) => {
  if (event === 'PASSWORD_RECOVERY') { state.resetMode = true; state.resetStage = 'password'; if (session?.user) { state.session = session; state.user = session.user; if (state.profile) renderPasswordUpdate(); } return; }
  if (event === 'SIGNED_OUT') { stopNotificationSubscription(); state.session = null; state.user = null; state.profile = null; state.isAdmin = false; state.notifications = []; renderAuth(); return; }
  if (event === 'USER_UPDATED') {
    queueMicrotask(() => { if (session?.user?.id !== state.user?.id) void loadSession(session); });
  }
});
const { data: { session } } = await supabase.auth.getSession();
const hashParams = new URLSearchParams(location.hash.slice(1));
const queryParams = new URLSearchParams(location.search);
if (session && (hashParams.get('type') === 'recovery' || queryParams.get('type') === 'recovery')) { state.resetMode = true; state.resetStage = 'password'; }
await loadSession(session);
