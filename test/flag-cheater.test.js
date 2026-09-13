const test = require('node:test');
const assert = require('node:assert/strict');

const { toggleFlagStudent, isStudentFlagged, clearFlaggedStudents } = require('../docs/app.js');

test('toggleFlagStudent - flags and unflags student in memory', () => {
    clearFlaggedStudents();

    assert.equal(isStudentFlagged('JohnDoe'), false, 'Should not be flagged initially');

    toggleFlagStudent('JohnDoe');
    assert.equal(isStudentFlagged('johndoe'), true, 'Should be flagged (case-insensitive)');
    assert.equal(isStudentFlagged('JohnDoe'), true, 'Should be flagged');

    toggleFlagStudent('johndoe');
    assert.equal(isStudentFlagged('JohnDoe'), false, 'Should be unflagged on second toggle');
});

test('clearFlaggedStudents - clears all flags for clean session state', () => {
    clearFlaggedStudents();

    toggleFlagStudent('user1');
    toggleFlagStudent('user2');

    assert.equal(isStudentFlagged('user1'), true);
    assert.equal(isStudentFlagged('user2'), true);

    clearFlaggedStudents();

    assert.equal(isStudentFlagged('user1'), false);
    assert.equal(isStudentFlagged('user2'), false);
});
