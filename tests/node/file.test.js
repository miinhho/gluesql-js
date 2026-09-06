const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { gluesql } = require('../../gluesql.node.js');
const { tempDir } = require('./support.js');

function open(dir) {
  return gluesql({
    engines: { rows: { storage: 'file', path: dir } },
    defaultEngine: 'rows',
  });
}

test('persists appends, updates, deletes and drops', async (t) => {
  const dir = tempDir(t);
  const db = open(dir);

  await db.query(`
    CREATE TABLE User (id INTEGER, name TEXT);
    INSERT INTO User VALUES (1, 'glue');
  `);
  await db.query("INSERT INTO User VALUES (2, 'sql'), (3, 'sticky')");

  assert.deepEqual(await open(dir).query('SELECT * FROM User ORDER BY id'), [
    {
      type: 'SELECT',
      rows: [
        { id: 1, name: 'glue' },
        { id: 2, name: 'sql' },
        { id: 3, name: 'sticky' },
      ],
    },
  ]);

  await db.query("UPDATE User SET name = 'glued' WHERE id = 1");
  await db.query('DELETE FROM User WHERE id = 3');

  assert.deepEqual(await open(dir).query('SELECT * FROM User ORDER BY id'), [
    {
      type: 'SELECT',
      rows: [
        { id: 1, name: 'glued' },
        { id: 2, name: 'sql' },
      ],
    },
  ]);

  await db.query('DROP TABLE User');

  await assert.rejects(
    () => open(dir).query('SELECT * FROM User'),
    /table not found: User/,
  );
});

test('keeps one file per row', async (t) => {
  const dir = tempDir(t);
  const db = open(dir);

  await db.query(`
    CREATE TABLE User (id INTEGER PRIMARY KEY, name TEXT);
    INSERT INTO User VALUES (1, 'glue'), (2, 'sql');
  `);

  const rowFiles = () =>
    fs.readdirSync(path.join(dir, 'User')).filter((name) => name.endsWith('.ron'));

  assert.equal(rowFiles().length, 2);

  await db.query('DELETE FROM User WHERE id = 2');

  assert.equal(rowFiles().length, 1);
});

test('requires the path option', () => {
  const db = gluesql();

  assert.throws(
    () => db.addEngine('rows', { storage: 'file' }),
    /invalid storage config: missing field `path`/,
  );
});
