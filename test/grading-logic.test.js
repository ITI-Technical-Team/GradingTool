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

test('gradeRawSlugSubmissions - strict roster filtering excludes non-roster submissions', () => {
    const roster = { 'mazen_user': 'Mazen Ahmed' };
    const rosterDetails = [
        { id: 'mazen_user', username: 'mazen_user', name: 'Mazen Ahmed', isBlank: false }
    ];
    
    const rawDict = {
        'me/cs50/problems/2026/x/hello': [
            { github_username: 'mazen_user', timestamp: 'Wed, 22 Jul 2026 02:22:20PM EEST', checks_passed: 10, checks_run: 10 },
            { github_username: 'extra_unregistered_student', timestamp: 'Wed, 22 Jul 2026 02:25:00PM EEST', checks_passed: 10, checks_run: 10 }
        ]
    };
    
    // Strict Roster Enabled (Default)
    const strictResults = gradeRawSlugSubmissions(rawDict, 'me/cs50/problems/2026/x/hello', null, roster, rosterDetails, true, true);
    assert.equal(strictResults.length, 1);
    assert.equal(strictResults[0].github_username, 'mazen_user');

    // Strict Roster Disabled
    const nonStrictResults = gradeRawSlugSubmissions(rawDict, 'me/cs50/problems/2026/x/hello', null, roster, rosterDetails, false, true);
    assert.equal(nonStrictResults.length, 2);
    assert.equal(nonStrictResults[1].github_username, 'extra_unregistered_student');
});

test('gradeRawSlugSubmissions - preserves blank roster rows for 1-to-1 Excel alignment', () => {
    const rosterDetails = [
        { id: 'student_1', username: 'student_1', name: 'Student One', isBlank: false },
        { id: '__blank_row_2', username: '', name: 'Student Two (No Username)', isBlank: true },
        { id: 'student_3', username: 'student_3', name: 'Student Three', isBlank: false }
    ];
    
    const rawDict = {
        'me/cs50/problems/2026/x/hello': [
            { github_username: 'student_1', timestamp: 'Wed, 22 Jul 2026 02:22:20PM EEST', checks_passed: 10, checks_run: 10 },
            { github_username: 'student_3', timestamp: 'Wed, 22 Jul 2026 02:22:20PM EEST', checks_passed: 10, checks_run: 10 }
        ]
    };
    
    const results = gradeRawSlugSubmissions(rawDict, 'me/cs50/problems/2026/x/hello', null, null, rosterDetails, true, true);
    
    assert.equal(results.length, 3);
    assert.equal(results[0].github_username, 'student_1');
    
    // Row 2 preserved as blank username with 0 grade for exact Excel row alignment
    assert.equal(results[1].github_username, '');
    assert.equal(results[1].name, 'Student Two (No Username)');
    assert.equal(results[1].grade, 0);
    
    assert.equal(results[2].github_username, 'student_3');
});

test('Grade Rounding & EPSILON Precision Math', () => {
    const rawAverage = 4.499999999999999;
    const rounded = Math.round(rawAverage + Number.EPSILON);
    assert.equal(rounded, 4);
    
    const exactHalf = 4.5;
    assert.equal(Math.round(exactHalf + Number.EPSILON), 5);
    
    const exactFail = 4.4;
    assert.equal(Math.round(exactFail + Number.EPSILON), 4);
});
