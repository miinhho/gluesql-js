const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { gluesql } = require('../../gluesql.node.js');
const { tempDir } = require('./support.js');

function open(dir, { asDefault = true } = {}) {
  return gluesql({
    engines: { docs: { storage: 'json', path: dir } },
    ...(asDefault ? { defaultEngine: 'docs' } : {}),
  });
}

test('stores rows as JSONL files that are readable as text', async (t) => {
  const dir = tempDir(t);
  const db = open(dir);

  await db.query(`
    CREATE TABLE User (id INTEGER, name TEXT);
    INSERT INTO User VALUES (1, 'glue'), (2, 'sql');
  `);

  const lines = fs
    .readFileSync(path.join(dir, 'User.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));

  assert.deepEqual(lines, [
    { id: 1, name: 'glue' },
    { id: 2, name: 'sql' },
  ]);
});

test('reads JSONL files written outside of GlueSQL', async (t) => {
  const dir = tempDir(t);
  fs.writeFileSync(
    path.join(dir, 'Imported.jsonl'),
    '{"id": 1, "name": "glue"}\n{"id": 2, "name": "sql"}\n',
  );

  const db = open(dir);

  assert.deepEqual(await db.query('SELECT * FROM Imported ORDER BY id'), [
    {
      type: 'SELECT',
      rows: [
        { id: 1, name: 'glue' },
        { id: 2, name: 'sql' },
      ],
    },
  ]);
});

test('persists appends, updates, deletes and drops', async (t) => {
  const dir = tempDir(t);

  const writer = open(dir);
  await writer.query(`
    CREATE TABLE User (id INTEGER, name TEXT);
    INSERT INTO User VALUES (1, 'glue');
  `);
  await writer.query("INSERT INTO User VALUES (2, 'sql'), (3, 'sticky')");

  const reader = open(dir);
  assert.deepEqual(await reader.query('SELECT * FROM User ORDER BY id'), [
    {
      type: 'SELECT',
      rows: [
        { id: 1, name: 'glue' },
        { id: 2, name: 'sql' },
        { id: 3, name: 'sticky' },
      ],
    },
  ]);

  await writer.query("UPDATE User SET name = 'glued' WHERE id = 1");
  await writer.query('DELETE FROM User WHERE id = 3');

  assert.deepEqual(await open(dir).query('SELECT * FROM User ORDER BY id'), [
    {
      type: 'SELECT',
      rows: [
        { id: 1, name: 'glued' },
        { id: 2, name: 'sql' },
      ],
    },
  ]);

  await writer.query('DROP TABLE User');

  assert.equal(fs.existsSync(path.join(dir, 'User.jsonl')), false);
  await assert.rejects(
    () => open(dir).query('SELECT * FROM User'),
    /table not found: User/,
  );
});

test('writes to the JSON engine when it is not the default', async (t) => {
  const dir = tempDir(t);
  const db = open(dir, { asDefault: false });

  await db.query(`
    CREATE TABLE User (id INTEGER, name TEXT) ENGINE = docs;
    INSERT INTO User VALUES (1, 'glue');
  `);

  assert.equal(
    fs.readFileSync(path.join(dir, 'User.jsonl'), 'utf8').trim(),
    '{"id":1,"name":"glue"}',
  );
  assert.deepEqual(await db.query('SELECT * FROM User'), [
    { type: 'SELECT', rows: [{ id: 1, name: 'glue' }] },
  ]);
});

test('requires the path option', () => {
  const db = gluesql();

  assert.throws(
    () => db.addEngine('docs', { storage: 'json' }),
    /invalid storage config: missing field `path`/,
  );
});
