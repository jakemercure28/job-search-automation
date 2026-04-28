'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { applyBaseSchema, applyMigrations } = require('../lib/db/schema');
const {
  isRejectionEmail,
  matchRejectionEmail,
  REJECTION_EMAIL_SYNC_LOG,
  syncRejectionEmails,
} = require('../lib/rejection-email-sync');

function createDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'job-search-rejection-sync-'));
  const db = new Database(path.join(dir, 'jobs.db'));
  applyBaseSchema(db);
  applyMigrations(db);
  return db;
}

function insertJob(db, job) {
  db.prepare(`
    INSERT INTO jobs (
      id, title, company, url, platform, location, posted_at, description,
      status, applied_at, stage
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    job.id,
    job.title,
    job.company,
    job.url,
    job.platform || 'Greenhouse',
    job.location || 'Remote',
    job.posted_at || '2026-04-01T00:00:00Z',
    job.description || 'Build infrastructure',
    job.status || 'applied',
    job.applied_at || '2026-04-02T00:00:00Z',
    job.stage || 'applied'
  );
}

function makeMessage({ uid, subject, fromAddress, receivedAt, raw }) {
  return {
    uid,
    subject,
    fromAddress,
    receivedAt: receivedAt || '2026-04-14T18:33:58.000Z',
    messageId: `<message-${uid}@example.com>`,
    raw,
  };
}

function makeFetcher(messages, uidValidity = '777') {
  return async ({ lastUid }) => ({
    uidValidity,
    lastUid: messages.length ? messages[messages.length - 1].uid : lastUid,
    messages: messages.filter((message) => lastUid == null || message.uid > Number(lastUid)),
  });
}

describe('rejection email sync', () => {
  it('detects rejection language in raw email text', () => {
    const message = makeMessage({
      uid: 1,
      subject: 'Important information about your application to Gather AI',
      fromAddress: 'careers@gather.ai',
      raw: `
        Content-Type: text/html; charset="utf-8"

        <p>Thank you for applying for the Platform Engineer role at Gather AI.</p>
        <p>Unfortunately, we have decided not to proceed with your candidacy at this time.</p>
      `,
    });

    assert.equal(isRejectionEmail(message), true);
  });

  it('matches and applies a rejection when company and title are both present', async () => {
    const db = createDb();
    insertJob(db, {
      id: 'job-1',
      company: 'Gather AI',
      title: 'Platform Engineer',
      url: 'https://job-boards.greenhouse.io/gather/jobs/12345',
    });

    const summary = await syncRejectionEmails(db, {
      skipTrash: true,
      fetchMessages: makeFetcher([
        makeMessage({
          uid: 11,
          subject: 'Important information about your application to Gather AI',
          fromAddress: 'careers@gather.ai',
          raw: `
            Thank you for applying for the Platform Engineer role at Gather AI.
            Unfortunately, we have decided not to proceed with your candidacy at this time.
          `,
        }),
      ]),
    });

    const job = db.prepare(`
      SELECT status, stage, rejected_from_stage, rejected_at
      FROM jobs
      WHERE id = 'job-1'
    `).get();
    const events = db.prepare(`
      SELECT event_type, from_value, to_value
      FROM events
      WHERE job_id = 'job-1'
    `).all();
    const emailLog = db.prepare(`
      SELECT matched_job_id, match_status, reason
      FROM rejection_email_log
      WHERE uid = 11
    `).get();

    assert.deepEqual(summary, {
      fetched: 1,
      candidates: 1,
      applied: 1,
      dryRun: 0,
      ignored: 0,
      unmatched: 0,
    });
    assert.equal(job.status, 'rejected');
    assert.equal(job.stage, 'rejected');
    assert.equal(job.rejected_from_stage, 'applied');
    assert.ok(job.rejected_at);
    assert.equal(events.length, 1);
    assert.deepEqual(events[0], {
      event_type: 'stage_change',
      from_value: 'applied',
      to_value: 'rejected',
    });
    assert.deepEqual(emailLog, {
      matched_job_id: 'job-1',
      match_status: 'applied',
      reason: 'single_active_company_job',
    });
  });

  it('does not auto-match a company-only rejection when multiple active jobs share that company', async () => {
    const db = createDb();
    insertJob(db, {
      id: 'job-1',
      company: 'Railway',
      title: 'Platform Engineer',
      url: 'https://jobs.ashbyhq.com/railway/1111',
    });
    insertJob(db, {
      id: 'job-2',
      company: 'Railway',
      title: 'Site Reliability Engineer',
      url: 'https://jobs.ashbyhq.com/railway/2222',
    });

    const summary = await syncRejectionEmails(db, {
      skipTrash: true,
      fetchMessages: makeFetcher([
        makeMessage({
          uid: 12,
          subject: 'Follow-up from Railway',
          fromAddress: 'no-reply@ashbyhq.com',
          raw: `
            Hey there,
            Our team was able to have a look at your resume.
            Unfortunately, we will not be moving forward with the process.
          `,
        }),
      ]),
    });

    const jobs = db.prepare(`
      SELECT id, status, stage
      FROM jobs
      ORDER BY id
    `).all();
    const emailLog = db.prepare(`
      SELECT matched_job_id, match_status, reason
      FROM rejection_email_log
      WHERE uid = 12
    `).get();

    assert.deepEqual(summary, {
      fetched: 1,
      candidates: 1,
      applied: 0,
      dryRun: 0,
      ignored: 0,
      unmatched: 1,
    });
    assert.deepEqual(jobs, [
      { id: 'job-1', status: 'applied', stage: 'applied' },
      { id: 'job-2', status: 'applied', stage: 'applied' },
    ]);
    assert.deepEqual(emailLog, {
      matched_job_id: null,
      match_status: 'unmatched',
      reason: 'ambiguous_company_match',
    });
  });

  it('skips already-seen messages on later sync runs', async () => {
    const db = createDb();
    insertJob(db, {
      id: 'job-1',
      company: 'Gather AI',
      title: 'Platform Engineer',
      url: 'https://job-boards.greenhouse.io/gather/jobs/12345',
    });

    const fetchMessages = makeFetcher([
      makeMessage({
        uid: 13,
        subject: 'Important information about your application to Gather AI',
        fromAddress: 'careers@gather.ai',
        raw: `
          Thank you for applying for the Platform Engineer role at Gather AI.
          Unfortunately, we have decided not to proceed with your candidacy at this time.
        `,
      }),
    ]);

    const first = await syncRejectionEmails(db, { fetchMessages, dryRun: true, skipTrash: true });
    const second = await syncRejectionEmails(db, { fetchMessages, dryRun: true, skipTrash: true });
    const rows = db.prepare('SELECT COUNT(*) AS n FROM rejection_email_log').get();

    assert.equal(first.dryRun, 1);
    assert.deepEqual(second, {
      fetched: 0,
      candidates: 0,
      applied: 0,
      dryRun: 0,
      ignored: 0,
      unmatched: 0,
    });
    assert.equal(rows.n, 1);
  });

  it('can disambiguate same-company jobs when the exact title is present', () => {
    const db = createDb();
    insertJob(db, {
      id: 'job-1',
      company: 'Railway',
      title: 'Platform Engineer',
      url: 'https://jobs.ashbyhq.com/railway/1111',
    });
    insertJob(db, {
      id: 'job-2',
      company: 'Railway',
      title: 'Site Reliability Engineer',
      url: 'https://jobs.ashbyhq.com/railway/2222',
    });

    const match = matchRejectionEmail(db, makeMessage({
      uid: 14,
      subject: 'Follow-up from Railway',
      fromAddress: 'no-reply@ashbyhq.com',
      raw: `
        Thanks for your interest in Railway.
        Unfortunately, we will not be moving forward with the Site Reliability Engineer role.
      `,
    }));

    assert.equal(match.job.id, 'job-2');
    assert.equal(match.reason, 'company_title_match');
  });

  it('matches compact company names against spaced email text when there is one active job', () => {
    const db = createDb();
    insertJob(db, {
      id: 'job-1',
      company: 'gatherai',
      title: 'Platform Engineer',
      url: 'https://job-boards.greenhouse.io/gather/jobs/12345',
    });

    const match = matchRejectionEmail(db, makeMessage({
      uid: 15,
      subject: 'Important information about your application to Gather AI',
      fromAddress: 'careers@gather.ai',
      raw: `
        Thank you for applying for the Platform Engineer role at Gather AI.
        Unfortunately, we have decided not to proceed with your candidacy at this time.
      `,
    }));

    assert.equal(match.job.id, 'job-1');
    assert.equal(match.reason, 'single_active_company_job');
  });

  it('uses the daily rejection-sync log path', () => {
    assert.equal(path.dirname(REJECTION_EMAIL_SYNC_LOG), path.join(__dirname, '..', 'logs', 'rejection-sync'));
    assert.match(path.basename(REJECTION_EMAIL_SYNC_LOG), /^\d{8}\.log$/);
  });

  it('records already-rejected matching jobs as ignored instead of unmatched', async () => {
    const db = createDb();
    insertJob(db, {
      id: 'job-1',
      company: 'blinkhealth',
      title: 'Staff Site Reliability Engineer',
      url: 'https://job-boards.greenhouse.io/blinkhealth/jobs/12345',
      status: 'rejected',
      stage: 'rejected',
    });

    const summary = await syncRejectionEmails(db, {
      skipTrash: true,
      fetchMessages: makeFetcher([
        makeMessage({
          uid: 16,
          subject: 'Important information about your application to Blink Health: Staff Site Reliability Engineer',
          fromAddress: 'no-reply@greenhouse.io',
          raw: `
            Thank you for applying to Blink Health.
            Unfortunately, we have decided not to move forward.
          `,
        }),
      ]),
    });

    const emailLog = db.prepare(`
      SELECT matched_job_id, match_status, reason
      FROM rejection_email_log
      WHERE uid = 16
    `).get();

    assert.equal(summary.ignored, 1);
    assert.equal(summary.unmatched, 0);
    assert.deepEqual(emailLog, {
      matched_job_id: 'job-1',
      match_status: 'ignored',
      reason: 'already_rejected',
    });
  });

  it('prefers active jobs before falling back to already-rejected jobs', () => {
    const db = createDb();
    insertJob(db, {
      id: 'job-1',
      company: 'Acme',
      title: 'Platform Engineer',
      url: 'https://job-boards.greenhouse.io/acme/jobs/1111',
      status: 'rejected',
      stage: 'rejected',
    });
    insertJob(db, {
      id: 'job-2',
      company: 'Acme',
      title: 'Site Reliability Engineer',
      url: 'https://job-boards.greenhouse.io/acme/jobs/2222',
    });

    const match = matchRejectionEmail(db, makeMessage({
      uid: 17,
      subject: 'Important information about your application to Acme',
      fromAddress: 'careers@acme.example',
      raw: `
        Thank you for applying to Acme.
        Unfortunately, we have decided not to proceed.
      `,
    }));

    assert.equal(match.job.id, 'job-2');
    assert.equal(match.reason, 'single_active_company_job');
  });

  it('matches company suffix variants like PitchBook Data emails that say PitchBook', () => {
    const db = createDb();
    insertJob(db, {
      id: 'job-1',
      company: 'pitchbookdata',
      title: 'Software Development Engineer, Platform Engineering',
      url: 'https://job-boards.greenhouse.io/pitchbookdata/jobs/1111',
      status: 'closed',
      stage: 'closed',
    });
    insertJob(db, {
      id: 'job-2',
      company: 'pitchbookdata',
      title: 'Sr. Site Reliability Engineer',
      url: 'https://job-boards.greenhouse.io/pitchbookdata/jobs/2222',
    });

    const match = matchRejectionEmail(db, makeMessage({
      uid: 18,
      subject: 'Your application for Sr. Site Reliability Engineer at PitchBook',
      fromAddress: 'no-reply@greenhouse.io',
      raw: `
        Thank you for applying to PitchBook.
        Unfortunately, we have decided not to move forward with your application
        for the Sr. Site Reliability Engineer role.
      `,
    }));

    assert.equal(match.job.id, 'job-2');
    assert.equal(match.reason, 'company_title_match');
  });
});
