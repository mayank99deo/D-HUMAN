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

function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
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
