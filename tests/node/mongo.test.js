const assert = require('node:assert/strict');
const { test } = require('node:test');
const { gluesql } = require('../../gluesql.node.js');
const { requireServer, requireStorage } = require('./support.js');

const host = process.env.GLUESQL_TEST_MONGO_HOST ?? '127.0.0.1';
const port = Number(process.env.GLUESQL_TEST_MONGO_PORT ?? 27017);
const url = `mongodb://${host}:${port}`;

function open(database) {
  return gluesql({
    engines: { docs: { storage: 'mongo', url, database } },
    defaultEngine: 'docs',
  });
}

function database(suffix = '') {
  return `gluesql_test_${process.pid}_${Date.now()}${suffix}`;
}

test('rejects a malformed connection string', (t) => {
  if (!requireStorage(t, 'mongo')) {
    return;
  }

  const db = gluesql();

  assert.throws(
    () => db.addEngine('docs', { storage: 'mongo', url: 'http://localhost', database: 'test' }),
    /invalid connection string scheme: http/,
  );
});

test('requires the database option', (t) => {
  if (!requireStorage(t, 'mongo')) {
    return;
  }

  const db = gluesql();

  assert.throws(
    () => db.addEngine('docs', { storage: 'mongo' }),
    /invalid storage config: missing field `database`/,
  );
});

test('persists appends, updates, deletes and drops', async (t) => {
  if (!requireStorage(t, 'mongo')) {
    return;
  }

  if (!(await requireServer(t, { name: 'MongoDB', host, port }))) {
    return;
  }

  const name = database();
  const db = open(name);

  await db.query(`
    CREATE TABLE User (id INTEGER, name TEXT);
    INSERT INTO User VALUES (1, 'glue');
  `);
  await db.query("INSERT INTO User VALUES (2, 'sql'), (3, 'sticky')");
  await db.query("UPDATE User SET name = 'glued' WHERE id = 1");
  await db.query('DELETE FROM User WHERE id = 3');

  assert.deepEqual(await open(name).query('SELECT * FROM User ORDER BY id'), [
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
    () => open(name).query('SELECT * FROM User'),
    /table not found: User/,
  );
});

test('isolates databases', async (t) => {
  if (!requireStorage(t, 'mongo')) {
    return;
  }

  if (!(await requireServer(t, { name: 'MongoDB', host, port }))) {
    return;
  }

  const name = database();
  const db = open(name);
  await db.query(`
    CREATE TABLE User (id INTEGER);
    INSERT INTO User VALUES (1);
  `);

  await assert.rejects(
    () => open(database('_other')).query('SELECT * FROM User'),
    /table not found: User/,
  );

  await db.query('DROP TABLE User');
});

test('writes to the mongo engine when it is not the default', async (t) => {
  if (!requireStorage(t, 'mongo')) {
    return;
  }

  if (!(await requireServer(t, { name: 'MongoDB', host, port }))) {
    return;
  }

  const name = database();
  const db = gluesql({ engines: { docs: { storage: 'mongo', url, database: name } } });

  await db.query(`
    CREATE TABLE Stored (id INTEGER, name TEXT) ENGINE = docs;
    INSERT INTO Stored VALUES (1, 'glue');
  `);

  // The row is in MongoDB, not in the in-memory default engine.
  assert.deepEqual(await open(name).query('SELECT * FROM Stored'), [
    { type: 'SELECT', rows: [{ id: 1, name: 'glue' }] },
  ]);

  await db.query('DROP TABLE Stored');
});

test('surfaces connection failures on the first query', async (t) => {
  if (!requireStorage(t, 'mongo')) {
    return;
  }

  const db = gluesql({
    engines: {
      docs: {
        storage: 'mongo',
        url: 'mongodb://127.0.0.1:1/?serverSelectionTimeoutMS=500',
        database: 'test',
      },
    },
    defaultEngine: 'docs',
  });

  await assert.rejects(
    () => db.query('SELECT * FROM Missing'),
    /[Ss]erver selection timeout/,
  );
});
