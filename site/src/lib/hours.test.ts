import { test } from 'node:test';
import assert from 'node:assert/strict';
import { storeStatus, formatTime } from './hours.ts';

// Helper: a moment given in US Eastern daylight time (UTC-4) during October 2026.
const et = (iso: string) => new Date(`${iso}-04:00`);

test('formatTime', () => {
  assert.equal(formatTime(540), '9am');
  assert.equal(formatTime(1080), '6pm');
  assert.equal(formatTime(12 * 60), '12pm');
  assert.equal(formatTime(0), '12am');
  assert.equal(formatTime(9 * 60 + 30), '9:30am');
});

test('open on a weekday afternoon', () => {
  assert.deepEqual(storeStatus(et('2026-10-01T12:16')), { open: true, label: 'Open now', detail: 'until 6pm' });
});

test('closing soon in the last 30 minutes', () => {
  assert.equal(storeStatus(et('2026-10-01T17:40')).label, 'Closing soon');
});

test('before opening on a weekday', () => {
  assert.deepEqual(storeStatus(et('2026-10-01T07:00')), { open: false, label: 'Closed', detail: 'opens today at 9am' });
});

test('weeknight after closing opens tomorrow', () => {
  assert.equal(storeStatus(et('2026-10-01T18:00')).detail, 'opens tomorrow at 9am');
});

test('Saturday morning before opening', () => {
  assert.equal(storeStatus(et('2026-10-03T09:30')).detail, 'opens today at 10am');
});

test('Saturday afternoon opens Monday', () => {
  assert.equal(storeStatus(et('2026-10-03T14:05')).detail, 'opens Monday at 9am');
});

test('Sunday opens tomorrow', () => {
  assert.equal(storeStatus(et('2026-10-04T11:00')).detail, 'opens tomorrow at 9am');
});

test('uses Eastern time regardless of visitor time zone', () => {
  // 17:30 UTC on a Thursday = 1:30pm Eastern: open.
  assert.equal(storeStatus(new Date('2026-10-01T17:30:00Z')).open, true);
  // 23:30 UTC = 7:30pm Eastern: closed, even though it is 6:30pm in Chicago.
  assert.equal(storeStatus(new Date('2026-10-01T23:30:00Z')).open, false);
});
