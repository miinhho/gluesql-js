const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { gluesql } = require('../../gluesql.node.js');
const { tempDir } = require('./support.js');

function open(dir) {
  return gluesql({
    engines: { sheets: { storage: 'csv', path: dir } },
    defaultEngine: 'sheets',
  });
}

test('writes tables as CSV files', async (t) => {
  const dir = tempDir(t);
  const db = open(dir);

  await db.query(`
    CREATE TABLE User (id INTEGER, name TEXT);
    INSERT INTO User VALUES (1, 'glue'), (2, 'sql');
  `);

  assert.equal(
    fs.readFileSync(path.join(dir, 'User.csv'), 'utf8'),
    'id,name\n1,glue\n2,sql\n',
  );
});

test('queries CSV files written outside of GlueSQL', async (t) => {
  const dir = tempDir(t);
  fs.writeFileSync(path.join(dir, 'Imported.csv'), 'id,name\n1,glue\n2,sql\n');

  const db = open(dir);

  assert.deepEqual(await db.query("SELECT name FROM Imported WHERE id = '2'"), [
    { type: 'SELECT', rows: [{ name: 'sql' }] },
  ]);
});

test('persists appends, updates, deletes and drops', async (t) => {
  const dir = tempDir(t);
  const db = open(dir);

  await db.query(`
    CREATE TABLE User (id INTEGER, name TEXT);
    INSERT INTO User VALUES (1, 'glue');
  `);
  await db.query("INSERT INTO User VALUES (2, 'sql'), (3, 'sticky')");

  assert.equal(
    fs.readFileSync(path.join(dir, 'User.csv'), 'utf8'),
    'id,name\n1,glue\n2,sql\n3,sticky\n',
  );

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

  assert.equal(fs.existsSync(path.join(dir, 'User.csv')), false);
  await assert.rejects(
    () => open(dir).query('SELECT * FROM User'),
    /table not found: User/,
  );
});

test('requires the path option', () => {
  const db = gluesql();

  assert.throws(
    () => db.addEngine('sheets', { storage: 'csv' }),
    /invalid storage config: missing field `path`/,
  );
});
