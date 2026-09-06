const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { gluesql } = require('../../gluesql.node.js');
const { requireStorage, tempDir } = require('./support.js');

function open(dir) {
  return gluesql({
    engines: { columns: { storage: 'parquet', path: dir } },
    defaultEngine: 'columns',
  });
}

test('writes tables as parquet files', async (t) => {
  if (!requireStorage(t, 'parquet')) {
    return;
  }

  const dir = tempDir(t);
  const db = open(dir);

  await db.query(`
    CREATE TABLE User (id INTEGER, name TEXT);
    INSERT INTO User VALUES (1, 'glue'), (2, 'sql');
  `);

  const file = path.join(dir, 'User.parquet');

  assert.equal(fs.existsSync(file), true);
  assert.equal(fs.readFileSync(file).subarray(0, 4).toString(), 'PAR1');
});

test('persists appends, updates, deletes and drops', async (t) => {
  if (!requireStorage(t, 'parquet')) {
    return;
  }

  const dir = tempDir(t);
  const db = open(dir);

  await db.query(`
    CREATE TABLE User (id INTEGER, name TEXT);
    INSERT INTO User VALUES (1, 'glue');
  `);

  // Every write rewrites the whole file, so appending must not lose the
  // rows that are already stored.
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

  assert.equal(fs.existsSync(path.join(dir, 'User.parquet')), false);
  await assert.rejects(
    () => open(dir).query('SELECT * FROM User'),
    /table not found: User/,
  );
});

test('writes to the parquet engine when it is not the default', async (t) => {
  if (!requireStorage(t, 'parquet')) {
    return;
  }

  const dir = tempDir(t);
  const db = gluesql({ engines: { columns: { storage: 'parquet', path: dir } } });

  await db.query(`
    CREATE TABLE Stored (id INTEGER, name TEXT) ENGINE = columns;
    INSERT INTO Stored VALUES (1, 'glue');
  `);

  assert.equal(fs.existsSync(path.join(dir, 'Stored.parquet')), true);
  assert.deepEqual(await db.query('SELECT * FROM Stored'), [
    { type: 'SELECT', rows: [{ id: 1, name: 'glue' }] },
  ]);
});

test('requires the path option', (t) => {
  if (!requireStorage(t, 'parquet')) {
    return;
  }

  const db = gluesql();

  assert.throws(
    () => db.addEngine('columns', { storage: 'parquet' }),
    /invalid storage config: missing field `path`/,
  );
});
