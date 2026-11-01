/**
 * D-Human waitlist webhook for Google Sheets.
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

function doPost(e) {
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: 'bad_json' });
  }

  const secret = PropertiesService.getScriptProperties().getProperty('WEBHOOK_SECRET');
  if (!secret || body.secret !== secret) return json_({ ok: false, error: 'unauthorized' });

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
function doGet() {
  return json_({ ok: true, service: 'd-human-waitlist' });
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
function clean_(value) {
  if (value === undefined || value === null) return '';
  let s = String(value).trim().slice(0, 500);
  if (/^[=+\-@\t\r0-9]/.test(s)) s = "'" + s;
  return s;
}

function json_(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}
