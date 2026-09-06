const assert = require('node:assert/strict');
const { test } = require('node:test');
const { gluesql } = require('../../gluesql.node.js');
const { requireServer, requireStorage } = require('./support.js');

const host = process.env.GLUESQL_TEST_REDIS_HOST ?? '127.0.0.1';
const port = Number(process.env.GLUESQL_TEST_REDIS_PORT ?? 6379);

function open(namespace) {
  return gluesql({
    engines: { cache: { storage: 'redis', namespace, host, port } },
    defaultEngine: 'cache',
  });
}

function namespace(suffix = '') {
  return `gluesql-test-${process.pid}-${Date.now()}${suffix}`;
}

test('reports an unreachable server instead of crashing', (t) => {
  if (!requireStorage(t, 'redis')) {
    return;
  }

  const db = gluesql();

  assert.throws(
    // Port 1 never has a Redis server on it.
    () => db.addEngine('cache', { storage: 'redis', namespace: 'test', port: 1 }),
    /redis: cannot connect to 127\.0\.0\.1:1/,
  );
});

test('requires the namespace option', (t) => {
  if (!requireStorage(t, 'redis')) {
    return;
  }

  const db = gluesql();

  assert.throws(
    () => db.addEngine('cache', { storage: 'redis' }),
    /invalid storage config: missing field `namespace`/,
  );
});

test('shares rows between connections to the same namespace', async (t) => {
  if (!requireStorage(t, 'redis')) {
    return;
  }

  if (!(await requireServer(t, { name: 'Redis', host, port }))) {
    return;
  }

  const ns = namespace();
  const db = open(ns);

  await db.query(`
    CREATE TABLE User (id INTEGER, name TEXT);
    INSERT INTO User VALUES (1, 'glue');
  `);
  await db.query("INSERT INTO User VALUES (2, 'sql')");
  await db.query("UPDATE User SET name = 'glued' WHERE id = 1");

  assert.deepEqual(await open(ns).query('SELECT * FROM User ORDER BY id'), [
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
    () => open(ns).query('SELECT * FROM User'),
    /table not found: User/,
  );
});

test('isolates namespaces', async (t) => {
  if (!requireStorage(t, 'redis')) {
    return;
  }

  if (!(await requireServer(t, { name: 'Redis', host, port }))) {
    return;
  }

  const ns = namespace();
  const db = open(ns);
  await db.query(`
    CREATE TABLE User (id INTEGER);
    INSERT INTO User VALUES (1);
  `);

  const other = open(namespace('-other'));

  await assert.rejects(
    () => other.query('SELECT * FROM User'),
    /table not found: User/,
  );

  await db.query('DROP TABLE User');
});
