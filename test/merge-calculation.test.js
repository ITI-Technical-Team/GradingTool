const test = require('node:test');
const assert = require('node:assert/strict');

const { 
    monthNames, 
    parseSubmissionTimestamp, 
    gradeRawSlugSubmissions, 
    parseRosterText,
    toggleFlagStudent,
    isStudentFlagged,
    clearFlaggedStudents,
    detectDayNumberFromSlugs
} = require('../docs/app.js');

// ──────────────────────────────────────────────
// detectDayNumberFromSlugs Test Suite
// ──────────────────────────────────────────────

test('detectDayNumberFromSlugs - detects matching day number from lecture and lab slugs', () => {
    const slugs = ['lec/10/pset', 'lab/10/assignment'];
    const detected = detectDayNumberFromSlugs(slugs);
    assert.equal(detected, 10);
});

test('detectDayNumberFromSlugs - detects day from day-3 format', () => {
    const slugs = ['day-3/sheet1', 'day-3/sheet2'];
    const detected = detectDayNumberFromSlugs(slugs);
    assert.equal(detected, 3);
});

test('detectDayNumberFromSlugs - returns null when days conflict', () => {
    const slugs = ['lec/1/pset', 'lab/2/assignment'];
    const detected = detectDayNumberFromSlugs(slugs);
    assert.equal(detected, null);
});

test('detectDayNumberFromSlugs - returns null for empty array', () => {
    assert.equal(detectDayNumberFromSlugs([]), null);
});
