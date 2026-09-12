const test = require('node:test');
const assert = require('node:assert/strict');

const { monthNames, parseSubmissionTimestamp, gradeRawSlugSubmissions } = require('../docs/app.js');

test('parseSubmissionTimestamp - parses standard EEST timestamp strings correctly', () => {
    const ts = 'Wed, 22 Jul 2026 02:22:20PM EEST';
    const date = parseSubmissionTimestamp(ts);
    assert.ok(date instanceof Date);
    assert.equal(date.getFullYear(), 2026);
    assert.equal(date.getMonth(), 6); // July is index 6
    assert.equal(date.getDate(), 22);
    assert.equal(date.getHours(), 14); // 2 PM -> 14
    assert.equal(date.getMinutes(), 22);
    assert.equal(date.getSeconds(), 20);
});

test('parseSubmissionTimestamp - handles null, empty, and invalid inputs gracefully', () => {
    assert.equal(parseSubmissionTimestamp(null), null);
    assert.equal(parseSubmissionTimestamp(''), null);
    assert.equal(parseSubmissionTimestamp('invalid string'), null);
});

test('gradeRawSlugSubmissions - computes grade from checks_passed / checks_run and caps at 5', () => {
    const rawDict = {
        'me/cs50/problems/2026/x/hello': [
            { github_username: 'MAZEN_USER', timestamp: 'Wed, 22 Jul 2026 02:22:20PM EEST', checks_passed: 10, checks_run: 10 },
            { github_username: 'john_doe', timestamp: 'Wed, 22 Jul 2026 03:00:00PM EEST', checks_passed: 4, checks_run: 5 }
        ]
    };
    
    const results = gradeRawSlugSubmissions(rawDict, 'me/cs50/problems/2026/x/hello', null, null);
    
    assert.equal(results.length, 2);
    
    const mazenRec = results.find(r => r.github_username === 'MAZEN_USER');
    assert.ok(mazenRec);
    assert.equal(mazenRec.grade, 5); // 10/10 * 5 = 5

    const johnRec = results.find(r => r.github_username === 'john_doe');
    assert.ok(johnRec);
    assert.equal(johnRec.grade, 4); // 4/5 * 5 = 4
});

test('gradeRawSlugSubmissions - filters out submissions submitted after deadline', () => {
    const rawDict = {
        'me/cs50/problems/2026/x/hello': [
            { github_username: 'on_time_student', timestamp: 'Wed, 22 Jul 2026 01:00:00PM EEST', checks_passed: 10, checks_run: 10 },
            { github_username: 'late_student', timestamp: 'Thu, 23 Jul 2026 01:00:00PM EEST', checks_passed: 10, checks_run: 10 }
        ]
    };
    
    // Deadline: Jul 22, 2026, 23:59
    const deadlineStr = '2026-07-22T23:59';
    const results = gradeRawSlugSubmissions(rawDict, 'me/cs50/problems/2026/x/hello', deadlineStr, null);
    
    const onTimeRec = results.find(r => r.github_username === 'on_time_student');
    assert.equal(onTimeRec.grade, 5);
    
    const lateRec = results.find(r => r.github_username === 'late_student');
    assert.equal(lateRec.grade, 0); // No valid submission prior to deadline
});

test('Grade Rounding & EPSILON Precision Math', () => {
    const rawAverage = 4.499999999999999;
    const rounded = Math.round(rawAverage + Number.EPSILON);
    assert.equal(rounded, 4); // Standard JS rounding of 4.4999... + EPSILON = 4.5 -> 4 (Math.round(4.5) is 5 in JS)
    
    const exactHalf = 4.5;
    assert.equal(Math.round(exactHalf + Number.EPSILON), 5);
    
    const exactFail = 4.4;
    assert.equal(Math.round(exactFail + Number.EPSILON), 4);
});
