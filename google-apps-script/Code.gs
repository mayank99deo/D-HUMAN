/**
 * D-Human waitlist, feedback and users webhook for Google Sheets.
 *
 * NEW (2026-11-25): the Users tab, one row per D-Human account. To switch it on, Mayank:
 *   1. Opens the Sheet > Extensions > Apps Script, selects everything in Code.gs, pastes
 *      this whole file over it and clicks Save.
 *   2. Picks "setupUsers" in the function menu and clicks Run. It adds and formats the
 *      Users tab. Safe to run again: it never deletes data, and it stops if the tab's
 *      headers differ and there is data below them.
 *   3. Deploy > Manage deployments > selects the web app > Edit (pencil icon) > Version:
 *      New version > Deploy. The URL stays the same, so nothing changes in Vercel.
 *   4. Checks: opening the web app URL in a browser shows "users": true.
 * The website then adds or updates a row when someone signs up, finishes onboarding or
 * changes their profile, and its daily job (about 10:30 and 19:30 IST) updates every row
 * that changed, rewrites them all once a day (the first run fills in everyone who signed
 * up before this) and removes rows of deleted accounts. Rows are matched by User ID, so
 * sorting or filtering the tab is safe. Add your own columns only to the right of the
 * last one ("Synced (IST)"): the site rewrites the columns up to it. The tab holds names
 * and email addresses: keep the Sheet shared with the founding team only.
 *
 * NEW (2026-11-18): the Feedback tab. To switch it on, Mayank:
 *   1. Opens the Sheet > Extensions > Apps Script, selects everything in Code.gs,
 *      pastes this whole file over it and clicks Save.
 *   2. Picks "setupFeedback" in the function menu and clicks Run. It adds and
 *      formats the Feedback and Replies tabs and checks the secret. Safe to run
 *      again: it never deletes data, and it stops if a tab's headers differ and
 *      there is data below them.
 *   3. Deploy > Manage deployments > selects the web app > Edit (pencil icon) >
 *      Version: New version > Deploy. The URL stays the same, so nothing changes
 *      in Vercel. Without a new version the live URL keeps running the old code.
 *   4. Checks: opening the web app URL in a browser shows "feedback": true.
 * The website then copies each answer to the Feedback tab (action "feedback",
 * added or updated by Answer ID) and, when someone deletes their account, asks
 * for every Feedback and Replies row with their respondent code to be deleted
 * (action "forget"). Both use the same WEBHOOK_SECRET as the waitlist. Rows carry
 * a respondent code, not an email address, unless the person ticked "You can email
 * me about this". Keep the Sheet shared with the founding team only: typed
 * answers may hold personal details.
 *
 * Setup (once):
 *   1. In the Sheet: Extensions > Apps Script, paste this file as Code.gs.
 *   2. Project Settings > Script properties > add WEBHOOK_SECRET with the same
 *      value as GOOGLE_SHEETS_WEBHOOK_SECRET in the website's environment.
 *   3. In the editor, pick "setup" in the function menu and click Run. It builds
 *      and formats the Waitlist tab and checks the secret. Safe to run again.
 *   4. Deploy > New deployment > Web app.
 *      Execute as: Me. Who has access: Anyone.
 *   5. Copy the web app URL into GOOGLE_SHEETS_WEBHOOK_URL.
 * After editing this file, deploy again (Manage deployments > Edit > New
 * version) or the live URL keeps running the old code.
 *
 * Google Form (a second way onto the waitlist):
 *   1. Paste this file and save. Pick "setupForm" in the function menu, click
 *      Run and allow every permission it asks for.
 *   2. Copy the share link from the Execution log.
 * It builds the form, links it to this spreadsheet, opens it to anyone with the
 * link and adds the trigger that files each answer in the Waitlist tab. Safe to
 * run again: it keeps the same form. Triggers run the saved code, so the form
 * needs no new deployment.
 */

const SHEET_NAME = 'Waitlist';
const HEADERS = [
  'Joined at',
  'Email',
  'Source',
  'UTM source',
  'UTM medium',
  'UTM campaign',
  'Referrer',
  'First name',
  'City',
  'Plan interest',
  'Training',
  'WhatsApp',
  'Updated at',
];
const EMAIL_COL = HEADERS.indexOf('Email') + 1;
const DETAIL_FIELDS = {
  firstName: 'First name',
  city: 'City',
  plan: 'Plan interest',
  training: 'Training',
  whatsapp: 'WhatsApp',
};

const SITE_URL = 'https://www.dhuman.fit';
const FORM_SOURCE = 'google-form';
const FORM_TAB = 'Form responses';
const FORM_HANDLER = 'onWaitlistFormSubmit';
const FORM_INTRO = [
  'Your body speaks data. Hack your health.',
  '',
  'D-Human tests first (blood, gut, body), has a doctor review the results, recommends supplements only where your markers point, and retests to show what moved.',
  '',
  'One email when early access opens, plus launch news. Unsubscribe anytime.',
  '',
  'D-Human offers wellness guidance and screening. It does not diagnose or treat any condition.',
].join('\n');
// Same labels as lib/waitlist/options.ts, so both sources fill the columns alike.
const PLAN_CHOICES = ['Baseline', 'Core', 'Complete', 'Not sure yet'];
const TRAINING_CHOICES = ['Lifting', 'Running', 'Hyrox', 'Marathons and endurance', 'General health'];

// Feedback answers from the website (lib/waitlist/sheets.ts). One row per answer.
const FEEDBACK_TAB = 'Feedback';
const FEEDBACK_HEADERS = [
  'Answer ID',
  'Received at',
  'Updated at',
  'Survey',
  'Respondent',
  'Path',
  'Question',
  'Answer',
  'Plan',
  'Days since onboarding',
  'Days with meals logged',
  'Language',
  'Source',
  'Email',
];
// Replies to the feedback email, for a later Gmail import. "forget" clears these too.
const REPLIES_TAB = 'Replies';
const REPLIES_HEADERS = ['Received at', 'From', 'Subject', 'Reply', 'Respondent', 'Status'];
const ANSWER_ID = /^[A-Za-z0-9-]{1,64}$/;
const RESPONDENT = /^r_[0-9a-f]{12}$/;
const MAX_FEEDBACK_ROWS = 200;
const TEXT_MAX = 1000;

// Accounts from the website (lib/sheets/users.ts). One row per account, matched by User ID.
// What is deliberately never sent here: weight, height, medicines, health conditions
// (pregnancy among them), current supplements, the "Fix a known deficiency" goal, blood
// report markers, reads and stacks, what people ate, Ask questions and answers, feedback
// answers (and the respondent code that would link them to a name), payment and order IDs
// and amounts. Those are health or sensitive data, and the founders don't need them here.
const USERS_TAB = 'Users';
// [header, field in the website's row, kind, longest text kept]
const USER_COLUMNS = [
  ['User ID', 'id', 'text', 20],
  ['Founder', 'founder', 'text', 3],
  ['Name', 'name', 'text', 100],
  ['Email', 'email', 'text', 254],
  ['Signed up (IST)', 'signedUp', 'date'],
  ['Onboarding finished (IST)', 'onboarded', 'date'],
  ['Last active (IST)', 'lastActive', 'date'],
  ['Language', 'language', 'text', 20],
  ['City', 'city', 'text', 100],
  ['Age', 'age', 'count'],
  ['Sex', 'sex', 'text', 20],
  ['Main activity', 'activity', 'text', 40],
  ['Level', 'level', 'text', 40],
  ['Goals', 'goals', 'text', 200],
  ['Diet', 'diet', 'text', 40],
  ['Plan', 'plan', 'text', 40],
  ['Payments', 'payments', 'count'],
  ['Meals logged', 'meals', 'count'],
  ['Reports uploaded', 'reports', 'count'],
  ['Weekly email', 'weeklyEmail', 'text', 10],
  ['Synced (IST)', 'synced', 'date'],
];
const USERS_HEADERS = USER_COLUMNS.map(function (c) { return c[0]; });
const USER_ID = /^u_[0-9a-f]{12}$/;
const IST_STAMP = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/;
const MAX_USER_ROWS = 200;
const MAX_FORGET_IDS = 500;

function doPost(e) {
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: 'bad_json' });
  }
  if (!body || typeof body !== 'object') return json_({ ok: false, error: 'bad_json' });

  const secret = PropertiesService.getScriptProperties().getProperty('WEBHOOK_SECRET');
  if (!secret || body.secret !== secret) return json_({ ok: false, error: 'unauthorized' });

  // Feedback rows carry no email address, so they're handled before the waitlist's checks.
  if (body.action === 'feedback') return locked_(function () { return saveFeedback_(body.rows); });
  if (body.action === 'forget') return locked_(function () { return forgetRespondent_(body.respondent); });
  if (body.action === 'users') return locked_(function () { return saveUsers_(body.rows); });
  if (body.action === 'users-forget') return locked_(function () { return forgetUsers_(body.ids); });
  if (body.action === 'users-ids') return locked_(function () { return listUserIds_(); });
  return waitlist_(body);
}

// The waitlist's "join" and "update", unchanged.
function waitlist_(body) {
  const email = String(body.email || '').trim().toLowerCase();
  if (!email || email.indexOf('@') < 1) return json_({ ok: false, error: 'missing_email' });

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) return json_({ ok: false, error: 'busy' });
  try {
    const sheet = getSheet_();
    const row = findRow_(sheet, email);

    if (body.action === 'join') {
      if (row) return json_({ ok: true, status: 'exists' });
      sheet.appendRow([
        new Date(),
        clean_(email),
        clean_(body.source),
        clean_(body.utmSource),
        clean_(body.utmMedium),
        clean_(body.utmCampaign),
        clean_(body.referrer),
        '', '', '', '', '', '',
      ]);
      return json_({ ok: true, status: 'created' });
    }

    if (body.action === 'update') {
      if (!row) return json_({ ok: false, error: 'not_found' });
      Object.keys(DETAIL_FIELDS).forEach(function (key) {
        if (body[key] === undefined || body[key] === null || body[key] === '') return;
        sheet.getRange(row, HEADERS.indexOf(DETAIL_FIELDS[key]) + 1).setValue(clean_(body[key]));
      });
      sheet.getRange(row, HEADERS.indexOf('Updated at') + 1).setValue(new Date());
      return json_({ ok: true, status: 'updated' });
    }

    return json_({ ok: false, error: 'unknown_action' });
  } finally {
    lock.releaseLock();
  }
}

// Visiting the web app URL in a browser shows this, which confirms the deployment works.
// "feedback": true means the deployed version has the Feedback tab's actions, and
// "users": true the Users tab's.
function doGet() {
  return json_({ ok: true, service: 'd-human-waitlist', feedback: true, users: true });
}

function locked_(run) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) return json_({ ok: false, error: 'busy' });
  try {
    return json_(run());
  } finally {
    lock.releaseLock();
  }
}

// Adds each answer, or updates the row with its Answer ID, so a resend never duplicates.
// Every row is checked before any is written.
function saveFeedback_(rows) {
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > MAX_FEEDBACK_ROWS) {
    return { ok: false, error: 'bad_rows' };
  }
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row || !ANSWER_ID.test(String(row.answerId)) || !RESPONDENT.test(String(row.respondent))) {
      return { ok: false, error: 'bad_row' };
    }
  }

  const sheet = getTab_(FEEDBACK_TAB, FEEDBACK_HEADERS);
  const rowOf = {};
  const last = sheet.getLastRow();
  if (last > 1) {
    sheet.getRange(2, 1, last - 1, 1).getValues().forEach(function (cell, i) {
      rowOf[String(cell[0]).replace(/^'/, '').trim()] = i + 2;
    });
  }

  rows.forEach(function (row) {
    const values = feedbackValues_(row);
    const at = rowOf[row.answerId];
    if (at) {
      sheet.getRange(at, 1, 1, values.length).setValues([values]);
    } else {
      sheet.appendRow(values);
      rowOf[row.answerId] = sheet.getLastRow();
    }
  });
  return { ok: true, status: 'saved', saved: rows.length };
}

function feedbackValues_(row) {
  return [
    clean_(row.answerId, 64),
    date_(row.receivedAt),
    date_(row.updatedAt),
    clean_(row.survey, 40),
    clean_(row.respondent, 20),
    clean_(row.path, 20),
    clean_(row.question, 20),
    clean_(row.answer, TEXT_MAX),
    clean_(row.plan, 10),
    count_(row.daysSinceOnboarding),
    count_(row.daysWithMeals),
    clean_(row.language, 20),
    clean_(row.source, 20),
    clean_(row.email, 254),
  ];
}

// Deletes every Feedback and Replies row for one respondent (their account was deleted).
// Bottom up, so the row numbers still to check don't move.
function forgetRespondent_(code) {
  code = String(code || '');
  if (!RESPONDENT.test(code)) return { ok: false, error: 'bad_respondent' };
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let deleted = 0;
  [
    [FEEDBACK_TAB, FEEDBACK_HEADERS],
    [REPLIES_TAB, REPLIES_HEADERS],
  ].forEach(function (tab) {
    const sheet = ss.getSheetByName(tab[0]);
    if (!sheet) return;
    const last = sheet.getLastRow();
    if (last < 2) return;
    const col = tab[1].indexOf('Respondent') + 1;
    const cells = sheet.getRange(2, col, last - 1, 1).getValues();
    for (let i = cells.length - 1; i >= 0; i--) {
      if (String(cells[i][0]).replace(/^'/, '').trim() === code) {
        sheet.deleteRow(i + 2);
        deleted++;
      }
    }
  });
  return { ok: true, status: 'forgotten', deleted: deleted };
}

// Adds each account's row, or rewrites the row with its User ID. Every row is checked
// before any is written. Only the tab's own columns are written, so notes kept to the
// right of them stay. Rows next to each other go in one write, which keeps a daily
// rewrite of everyone fast.
function saveUsers_(rows) {
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > MAX_USER_ROWS) {
    return { ok: false, error: 'bad_rows' };
  }
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row || typeof row !== 'object' || !USER_ID.test(String(row.id))) return { ok: false, error: 'bad_row' };
  }

  const sheet = getTab_(USERS_TAB, USERS_HEADERS);
  const width = USERS_HEADERS.length;
  // Columns moved or renamed by hand: writing by position would put data under the wrong
  // heading, so nothing is written until the tab is set up again.
  const header = sheet.getRange(1, 1, 1, width).getValues()[0].map(String);
  if (header.join('|') !== USERS_HEADERS.join('|')) return { ok: false, error: 'headers_changed' };

  const tz = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
  const rowOf = userRows_(sheet);
  const updates = [];
  const adds = [];
  const addAt = {};
  rows.forEach(function (row) {
    const id = String(row.id);
    const values = userValues_(row, tz);
    if (rowOf[id]) {
      updates.push({ at: rowOf[id], values: values });
    } else if (addAt[id] !== undefined) {
      adds[addAt[id]] = values; // the same account twice in one batch: the later row wins
    } else {
      addAt[id] = adds.length;
      adds.push(values);
    }
  });

  // Sorting is stable, so for the same row the later of two updates stays last and wins.
  updates.sort(function (a, b) { return a.at - b.at; });
  let i = 0;
  while (i < updates.length) {
    const start = updates[i].at;
    const block = [updates[i].values];
    let j = i;
    while (j + 1 < updates.length && updates[j + 1].at <= updates[j].at + 1) {
      if (updates[j + 1].at === updates[j].at) block[block.length - 1] = updates[j + 1].values;
      else block.push(updates[j + 1].values);
      j++;
    }
    sheet.getRange(start, 1, block.length, width).setValues(block);
    i = j + 1;
  }

  if (adds.length) {
    const first = sheet.getLastRow() + 1;
    const short = first + adds.length - 1 - sheet.getMaxRows();
    if (short > 0) sheet.insertRowsAfter(sheet.getMaxRows(), short);
    sheet.getRange(first, 1, adds.length, width).setValues(adds);
  }
  return { ok: true, status: 'saved', saved: rows.length, added: adds.length };
}

function userValues_(row, tz) {
  return USER_COLUMNS.map(function (c) {
    const value = row[c[1]];
    if (c[2] === 'date') return istDate_(value, tz);
    if (c[2] === 'count') return count_(value);
    return clean_(value, c[3]);
  });
}

// The website sends Indian time as "2026-11-25 14:30". Read in this spreadsheet's own time
// zone, the cell shows that same clock time whatever the spreadsheet is set to, and it
// stays a real date for sorting and filtering.
function istDate_(value, tz) {
  const s = String(value || '');
  if (!IST_STAMP.test(s)) return '';
  return Utilities.parseDate(s, tz, 'yyyy-MM-dd HH:mm');
}

// Row number of each User ID in the tab (the first, should one appear twice).
function userRows_(sheet) {
  const rowOf = {};
  const last = sheet.getLastRow();
  if (last < 2) return rowOf;
  sheet.getRange(2, 1, last - 1, 1).getValues().forEach(function (cell, i) {
    const id = String(cell[0]).replace(/^'/, '').trim();
    if (USER_ID.test(id) && !rowOf[id]) rowOf[id] = i + 2;
  });
  return rowOf;
}

// Deletes every row with one of these User IDs (their accounts were deleted).
// Bottom up, so the row numbers still to check don't move.
function forgetUsers_(ids) {
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_FORGET_IDS) return { ok: false, error: 'bad_ids' };
  const wanted = {};
  for (let i = 0; i < ids.length; i++) {
    const id = String(ids[i]);
    if (!USER_ID.test(id)) return { ok: false, error: 'bad_id' };
    wanted[id] = true;
  }
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(USERS_TAB);
  if (!sheet) return { ok: true, status: 'forgotten', deleted: 0 };
  const last = sheet.getLastRow();
  if (last < 2) return { ok: true, status: 'forgotten', deleted: 0 };
  // Sheets refuses to delete every row below the frozen header, so keep a spare one.
  if (sheet.getMaxRows() <= last) sheet.insertRowsAfter(sheet.getMaxRows(), 1);
  const cells = sheet.getRange(2, 1, last - 1, 1).getValues();
  let deleted = 0;
  for (let i = cells.length - 1; i >= 0; i--) {
    if (wanted[String(cells[i][0]).replace(/^'/, '').trim()] === true) {
      sheet.deleteRow(i + 2);
      deleted++;
    }
  }
  return { ok: true, status: 'forgotten', deleted: deleted };
}

// Every User ID in the tab, so the website can remove rows of accounts that are gone.
function listUserIds_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(USERS_TAB);
  return { ok: true, status: 'listed', ids: sheet ? Object.keys(userRows_(sheet)) : [] };
}

/**
 * Run once from the editor (after pasting this file) to prepare the Users tab. Like
 * setup(), it never deletes data, so running it again only reapplies the headers and
 * formatting.
 */
function setupUsers() {
  setupTab_(
    USERS_TAB,
    USERS_HEADERS,
    USER_COLUMNS.filter(function (c) { return c[2] === 'date'; }).map(function (c) { return c[0]; }),
    null,
    {
      'User ID': 130,
      Founder: 70,
      Name: 170,
      Email: 240,
      'Signed up (IST)': 140,
      'Onboarding finished (IST)': 160,
      'Last active (IST)': 140,
      Age: 60,
      Goals: 220,
      Plan: 170,
      Payments: 80,
      'Synced (IST)': 140,
    },
    // The filter covers every column, so sorting moves notes kept to the right with their
    // rows, and 5,000 rows, so it covers accounts added later.
    { again: 'setupUsers', allColumns: true, minRows: 5000 }
  );

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const secret = PropertiesService.getScriptProperties().getProperty('WEBHOOK_SECRET');
  Logger.log(
    secret
      ? 'WEBHOOK_SECRET is set (' + secret.length + ' characters).'
      : 'WEBHOOK_SECRET is missing. Add it under Project Settings > Script properties.'
  );
  Logger.log('Dates show Indian time (IST), whatever this spreadsheet\'s time zone (' + ss.getSpreadsheetTimeZone() + ').');
  Logger.log('Add your own columns only to the right of "' + USERS_HEADERS[USERS_HEADERS.length - 1] + '".');
  Logger.log('Now deploy a new version: Deploy > Manage deployments > Edit > Version: New version > Deploy.');
  Logger.log('Keep this spreadsheet shared with the founding team only: the Users tab holds names and email addresses.');
}

/**
 * Run once from the editor (after pasting this file) to prepare the Feedback and
 * Replies tabs. Like setup(), it never deletes data, so running it again only
 * reapplies the headers and formatting.
 */
function setupFeedback() {
  setupTab_(FEEDBACK_TAB, FEEDBACK_HEADERS, ['Received at', 'Updated at'], 'Answer', {
    'Answer ID': 110,
    'Received at': 140,
    'Updated at': 140,
    Respondent: 130,
    Answer: 360,
    Email: 240,
  });
  setupTab_(REPLIES_TAB, REPLIES_HEADERS, ['Received at'], 'Reply', {
    'Received at': 140,
    From: 240,
    Subject: 240,
    Reply: 420,
  });

  const secret = PropertiesService.getScriptProperties().getProperty('WEBHOOK_SECRET');
  Logger.log(
    secret
      ? 'WEBHOOK_SECRET is set (' + secret.length + ' characters).'
      : 'WEBHOOK_SECRET is missing. Add it under Project Settings > Script properties.'
  );
  Logger.log('Now deploy a new version: Deploy > Manage deployments > Edit > Version: New version > Deploy.');
  Logger.log('Keep this spreadsheet shared with the founding team only: typed answers may hold personal details.');
}

// options.again: the function to run again after renaming a clashing tab (setupFeedback
// when left out). options.allColumns: the filter covers every column of the tab, not
// only these headers. options.minRows: the tab gets at least this many rows first, so the
// filter (which doesn't grow by itself) covers rows added later.
function setupTab_(name, headers, dateCols, wrapCol, widths, options) {
  const opts = options || {};
  const sheet = getTab_(name, headers);
  const header = sheet.getRange(1, 1, 1, headers.length);
  const current = header.getValues()[0].map(String);
  if (current.join('|') !== headers.join('|')) {
    if (sheet.getLastRow() > 1) {
      throw new Error(
        'Row 1 of the "' + name + '" tab has different headers and there is data below it. ' +
          'Rename that tab (e.g. "' + name + ' old") and run ' + (opts.again || 'setupFeedback') + ' again.'
      );
    }
    header.setValues([headers]);
  }

  header.setFontWeight('bold').setBackground('#000000').setFontColor('#ffffff');
  sheet.setFrozenRows(1);

  if (sheet.getMaxRows() < 2) sheet.insertRowsAfter(1, 999);
  if (opts.minRows && sheet.getMaxRows() < opts.minRows) sheet.insertRowsAfter(sheet.getMaxRows(), opts.minRows - sheet.getMaxRows());
  const rows = sheet.getMaxRows() - 1;
  dateCols.forEach(function (col) {
    sheet.getRange(2, headers.indexOf(col) + 1, rows, 1).setNumberFormat('yyyy-mm-dd hh:mm');
  });
  if (wrapCol) sheet.getRange(2, headers.indexOf(wrapCol) + 1, rows, 1).setWrap(true);
  headers.forEach(function (col, i) {
    sheet.setColumnWidth(i + 1, widths[col] || 130);
  });

  if (!sheet.getFilter()) {
    const filterWidth = opts.allColumns ? Math.max(sheet.getMaxColumns(), headers.length) : headers.length;
    sheet.getRange(1, 1, sheet.getMaxRows(), filterWidth).createFilter();
  }
  Logger.log('The "' + name + '" tab is ready with ' + headers.length + ' columns.');
}

// A tab by name, made with its headers if it's missing or empty.
function getTab_(name, headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  }
  return sheet;
}

function date_(value) {
  const d = new Date(String(value || ''));
  return isNaN(d.getTime()) ? '' : d;
}

function count_(value) {
  return typeof value === 'number' && isFinite(value) && value >= 0 ? Math.floor(value) : '';
}

/**
 * Run once from the editor to prepare the sheet. It never deletes data, so
 * running it again only reapplies the headers and formatting.
 */
function setup() {
  const sheet = getSheet_();
  const lastCol = HEADERS.length;
  const header = sheet.getRange(1, 1, 1, lastCol);

  const current = header.getValues()[0].map(String);
  if (current.join('|') !== HEADERS.join('|')) {
    if (sheet.getLastRow() > 1) {
      throw new Error(
        'Row 1 of the "' + SHEET_NAME + '" tab has different headers and there is data below it. ' +
          'Rename that tab (e.g. "Waitlist old") and run setup again.'
      );
    }
    header.setValues([HEADERS]);
  }

  header.setFontWeight('bold').setBackground('#000000').setFontColor('#ffffff');
  sheet.setFrozenRows(1);

  if (sheet.getMaxRows() < 2) sheet.insertRowsAfter(1, 999);
  const rows = sheet.getMaxRows() - 1;
  ['Joined at', 'Updated at'].forEach(function (name) {
    sheet.getRange(2, HEADERS.indexOf(name) + 1, rows, 1).setNumberFormat('yyyy-mm-dd hh:mm');
  });

  const widths = { 'Joined at': 140, Email: 260, Referrer: 220, Training: 220, 'Updated at': 140 };
  HEADERS.forEach(function (name, i) {
    sheet.setColumnWidth(i + 1, widths[name] || 130);
  });

  if (!sheet.getFilter()) sheet.getRange(1, 1, sheet.getMaxRows(), lastCol).createFilter();

  const secret = PropertiesService.getScriptProperties().getProperty('WEBHOOK_SECRET');
  Logger.log('The "' + SHEET_NAME + '" tab is ready with ' + lastCol + ' columns.');
  Logger.log(
    secret
      ? 'WEBHOOK_SECRET is set (' + secret.length + ' characters).'
      : 'WEBHOOK_SECRET is missing. Add it under Project Settings > Script properties.'
  );
}

/**
 * Run once from the editor to create the Google Form. Running it again keeps
 * the same form and only repairs its link, public access and trigger.
 */
function setupForm() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('FORM_ID');
  const form = id ? FormApp.openById(id) : buildForm_(ss, props);

  linkToSheet_(form, ss);
  nameResponsesTab_(form, ss);
  addTrigger_(form);
  const open = openToAnyone_(form);

  Logger.log('Share this link: ' + shareLink_(form));
  Logger.log('Edit the form: ' + form.getEditUrl());
  Logger.log(
    open
      ? 'Checked signed out: anyone with the link can answer.'
      : 'NOT CONFIRMED PUBLIC. Run setupForm again in a minute. If this stays, open the form, click Publish and set responders to Anyone with the link.'
  );
}

function buildForm_(ss, props) {
  const form = FormApp.create('Join the D-Human waitlist', true);
  form
    .setDescription(FORM_INTRO)
    .setConfirmationMessage("You're on the list. We'll email you when early access opens.")
    .setShowLinkToRespondAgain(false);

  // Answers are matched by question ID, so rewording a question later is safe.
  const items = {};
  const track = function (key, item) {
    items[item.getId()] = key;
    return item;
  };

  track('email', form.addTextItem())
    .setTitle('Email')
    .setRequired(true)
    .setValidation(
      FormApp.createTextValidation()
        .setHelpText('Enter an email address like name@example.com.')
        .requireTextIsEmail()
        .build()
    );

  form
    .addSectionHeaderItem()
    .setTitle('Optional')
    .setHelpText('A few answers help us decide what to launch first, and where.');

  track('firstName', form.addTextItem()).setTitle('First name');
  track('city', form.addTextItem()).setTitle('City');
  track('whatsapp', form.addTextItem())
    .setTitle('WhatsApp number')
    .setHelpText('For launch updates only. Include your country code.')
    .setValidation(
      FormApp.createTextValidation()
        .setHelpText('Enter a WhatsApp number with country code, like +91 98765 43210.')
        .requireTextMatchesPattern('^\\+?[0-9 ()-]{7,20}$')
        .build()
    );
  track('training', form.addCheckboxItem())
    .setTitle('What do you train for?')
    .setChoiceValues(TRAINING_CHOICES);
  track('plan', form.addMultipleChoiceItem())
    .setTitle('Which plan fits you?')
    .setHelpText(
      'Baseline: know your numbers. Core: know your body, with a retest at 3–4 months. ' +
        'Complete: know your risks. Pricing goes to the waitlist first.'
    )
    .setChoiceValues(PLAN_CHOICES);

  props.setProperties({
    FORM_ID: form.getId(),
    FORM_ITEMS: JSON.stringify(items),
    SHEET_ID: ss.getId(),
  });

  // Keeps the form beside the Sheet. Calling DriveApp is also what makes Apps
  // Script ask for the Drive permission that openToAnyone_ needs.
  const parents = DriveApp.getFileById(ss.getId()).getParents();
  if (parents.hasNext()) DriveApp.getFileById(form.getId()).moveTo(parents.next());
  return form;
}

function linkToSheet_(form, ss) {
  try {
    if (form.getDestinationId() === ss.getId()) return;
  } catch (err) {
    // A form with no destination yet throws here.
  }
  form.setDestination(FormApp.DestinationType.SPREADSHEET, ss.getId());
}

// Google adds a "Form Responses 1" tab with every answer as it was submitted.
// Name it plainly and keep it after the Waitlist tab, the one list to read.
function nameResponsesTab_(form, ss) {
  SpreadsheetApp.flush();
  const tab = ss.getSheets().filter(function (sheet) {
    const url = sheet.getFormUrl();
    return url && FormApp.openByUrl(url).getId() === form.getId();
  })[0];
  if (!tab) {
    Logger.log('The responses tab has not appeared yet. Run setupForm again to name it.');
    return;
  }

  tab.setName(FORM_TAB);
  tab.setFrozenRows(1);
  tab
    .getRange(1, 1, 1, Math.max(tab.getLastColumn(), 1))
    .setFontWeight('bold')
    .setBackground('#000000')
    .setFontColor('#ffffff');
  ss.setActiveSheet(tab);
  ss.moveActiveSheet(ss.getNumSheets());
  ss.setActiveSheet(getSheet_(ss));
}

function addTrigger_(form) {
  const exists = ScriptApp.getProjectTriggers().some(function (trigger) {
    return trigger.getHandlerFunction() === FORM_HANDLER;
  });
  if (!exists) ScriptApp.newTrigger(FORM_HANDLER).forForm(form).onFormSubmit().create();
}

// A published form still turns people away until anyone with the link holds the
// responder role, and that role lives in Drive, not FormApp. The check loads the
// form signed out, because its owner can always open it.
function openToAnyone_(form) {
  const response = UrlFetchApp.fetch(
    'https://www.googleapis.com/drive/v3/files/' + form.getId() + '/permissions',
    {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
      payload: JSON.stringify({ type: 'anyone', role: 'reader', view: 'published' }),
      muteHttpExceptions: true,
    }
  );
  if (response.getResponseCode() >= 300) {
    Logger.log('Drive refused public access: HTTP ' + response.getResponseCode());
  }

  const page = UrlFetchApp.fetch(form.getPublishedUrl(), { muteHttpExceptions: true });
  return page.getContentText().indexOf(form.getTitle()) !== -1;
}

function shareLink_(form) {
  const url = form.getPublishedUrl();
  try {
    return form.shortenFormUrl(url);
  } catch (err) {
    return url;
  }
}

// Runs on each form submission, through the trigger setupForm adds, and files
// the answers in the Waitlist tab beside the website's signups.
function onWaitlistFormSubmit(e) {
  const props = PropertiesService.getScriptProperties();
  const answers = readAnswers_(e.response, JSON.parse(props.getProperty('FORM_ITEMS')));
  const email = String(answers.email || '').trim().toLowerCase();
  if (!email || email.indexOf('@') < 1) return;

  let created = false;
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet = getSheet_(SpreadsheetApp.openById(props.getProperty('SHEET_ID')));
    const row = findRow_(sheet, email);
    if (row) {
      fillBlanks_(sheet, row, answers);
    } else {
      sheet.appendRow([
        e.response.getTimestamp(),
        clean_(email),
        FORM_SOURCE,
        '', '', '', '',
        clean_(answers.firstName),
        clean_(answers.city),
        clean_(answers.plan),
        clean_(answers.training),
        clean_(answers.whatsapp),
        '',
      ]);
      created = true;
    }
  } finally {
    lock.releaseLock();
  }

  if (created) sendWelcome_(email, answers.firstName);
}

function readAnswers_(response, keys) {
  const answers = {};
  response.getItemResponses().forEach(function (itemResponse) {
    const key = keys[itemResponse.getItem().getId()];
    const value = itemResponse.getResponse();
    if (key) answers[key] = Array.isArray(value) ? value.join(', ') : value;
  });
  return answers;
}

// The form doesn't prove who is filling it in, unlike the website's signed
// token, so an existing person's answers are never overwritten.
function fillBlanks_(sheet, row, answers) {
  let changed = false;
  Object.keys(DETAIL_FIELDS).forEach(function (key) {
    if (!answers[key]) return;
    const cell = sheet.getRange(row, HEADERS.indexOf(DETAIL_FIELDS[key]) + 1);
    if (cell.getValue() !== '') return;
    cell.setValue(clean_(answers[key]));
    changed = true;
  });
  if (changed) sheet.getRange(row, HEADERS.indexOf('Updated at') + 1).setValue(new Date());
}

// The site sends the welcome email and adds the person to Resend, so launch
// broadcasts reach both sources. The row is already saved, so a failure here
// is only logged.
function sendWelcome_(email, firstName) {
  const secret = PropertiesService.getScriptProperties().getProperty('WEBHOOK_SECRET');
  try {
    const response = UrlFetchApp.fetch(SITE_URL + '/api/waitlist/form', {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + secret },
      payload: JSON.stringify({ email: email, firstName: firstName }),
      muteHttpExceptions: true,
    });
    if (response.getResponseCode() !== 200) {
      console.error('Welcome request got HTTP ' + response.getResponseCode());
    }
  } catch (err) {
    console.error('Welcome request failed: ' + err.message);
  }
}

function getSheet_(ss = SpreadsheetApp.getActiveSpreadsheet()) {
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
  }
  return sheet;
}

function findRow_(sheet, email) {
  const last = sheet.getLastRow();
  if (last < 2) return 0;
  const emails = sheet.getRange(2, EMAIL_COL, last - 1, 1).getValues();
  for (let i = 0; i < emails.length; i++) {
    if (String(emails[i][0]).replace(/^'/, '').trim().toLowerCase() === email) return i + 2;
  }
  return 0; 
}

// The leading apostrophe stores a value as plain text: "=IMPORTXML(...)" can't run
// as a formula, and numbers such as "09876 54321" keep their leading zero.
// `max` (500 when left out) counts characters as people see them, so typed feedback
// keeps its 1,000 and an emoji is never cut in half.
function clean_(value, max) {
  if (value === undefined || value === null) return '';
  let s = Array.from(String(value).trim()).slice(0, max || 500).join('');
  if (/^[=+\-@\t\r0-9]/.test(s)) s = "'" + s;
  return s;
}

function json_(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}
