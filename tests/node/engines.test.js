const assert = require('node:assert/strict');
const { test } = require('node:test');
const { gluesql, storages } = require('../../gluesql.node.js');
const { tempDir } = require('./support.js');

test('starts with the in-memory engine as default', () => {
  const db = gluesql();

  assert.deepEqual(db.listEngines(), ['memory']);
  assert.equal(db.defaultEngine(), 'memory');
});

test('registers engines declaratively', () => {
  const db = gluesql({
    engines: { scratch: { storage: 'memory' } },
    defaultEngine: 'scratch',
  });

  assert.deepEqual(db.listEngines(), ['memory', 'scratch']);
  assert.equal(db.defaultEngine(), 'scratch');
});

test('the default engine owns tables created without an ENGINE clause', async () => {
  const db = gluesql({
    engines: { scratch: { storage: 'memory' } },
    defaultEngine: 'scratch',
  });

  await db.query(`
    CREATE TABLE Implicit (id INTEGER);
    CREATE TABLE Explicit (id INTEGER) ENGINE = memory;
  `);

  db.setDefaultEngine('memory');
  db.removeEngine('scratch');

  // `Implicit` lived in the removed engine, `Explicit` did not.
  await assert.rejects(
    () => db.query('SELECT * FROM Implicit'),
    /table not found: Implicit/,
  );
  assert.deepEqual(await db.query('SELECT * FROM Explicit'), [
    { type: 'SELECT', rows: [] },
  ]);
});

test('routes tables by the ENGINE clause and joins across engines', async () => {
  const db = gluesql();
  db.addEngine('scratch', { storage: 'memory' });

  await db.query(`
    CREATE TABLE Main (mid INTEGER) ENGINE = memory;
    CREATE TABLE Scratch (sid INTEGER) ENGINE = scratch;
    INSERT INTO Main VALUES (1), (2);
    INSERT INTO Scratch VALUES (10);
  `);

  assert.deepEqual(await db.query('SELECT mid, sid FROM Main JOIN Scratch'), [
    {
      type: 'SELECT',
      rows: [
        { mid: 1, sid: 10 },
        { mid: 2, sid: 10 },
      ],
    },
  ]);
});

test('SHOW TABLES lists the tables of every engine', async (t) => {
  const db = gluesql({
    engines: {
      docs: { storage: 'json', path: tempDir(t) },
      sheets: { storage: 'csv', path: tempDir(t) },
    },
  });

  await db.query(`
    CREATE TABLE Cached (id INTEGER) ENGINE = memory;
    CREATE TABLE Docs (id INTEGER) ENGINE = docs;
    CREATE TABLE Sheets (id INTEGER) ENGINE = sheets;
  `);

  assert.deepEqual(await db.query('SHOW TABLES'), [
    { type: 'SHOW TABLES', tables: ['Cached', 'Docs', 'Sheets'] },
  ]);

  db.removeEngine('sheets');

  assert.deepEqual(await db.query('SHOW TABLES'), [
    { type: 'SHOW TABLES', tables: ['Cached', 'Docs'] },
  ]);
});

test('joins tables owned by two persistent engines', async (t) => {
  const db = gluesql({
    engines: {
      docs: { storage: 'json', path: tempDir(t) },
      sheets: { storage: 'csv', path: tempDir(t) },
    },
  });

  await db.query(`
    CREATE TABLE Docs (id INTEGER, name TEXT) ENGINE = docs;
    CREATE TABLE Sheets (id INTEGER, tag TEXT) ENGINE = sheets;
    INSERT INTO Docs VALUES (1, 'glue'), (2, 'sql');
    INSERT INTO Sheets VALUES (2, 'kept');
  `);

  assert.deepEqual(
    await db.query(
      'SELECT Docs.name, Sheets.tag FROM Docs JOIN Sheets ON Docs.id = Sheets.id',
    ),
    [{ type: 'SELECT', rows: [{ name: 'sql', tag: 'kept' }] }],
  );
});

test('removed engines drop out of the registry', async () => {
  const db = gluesql();
  db.addEngine('scratch', { storage: 'memory' });
  await db.query('CREATE TABLE Foo (id INTEGER) ENGINE = scratch');

  db.removeEngine('scratch');

  assert.deepEqual(db.listEngines(), ['memory']);
  await assert.rejects(
    () => db.query('SELECT * FROM Foo'),
    /table not found: Foo/,
  );
});

test('keeps the default engine registered', () => {
  const db = gluesql({ engines: { scratch: { storage: 'memory' } } });

  assert.throws(
    () => db.removeEngine('memory'),
    /cannot remove the default engine: memory \(call setDefaultEngine first\)/,
  );

  db.setDefaultEngine('scratch');
  db.removeEngine('memory');

  assert.deepEqual(db.listEngines(), ['scratch']);
  assert.equal(db.defaultEngine(), 'scratch');
});

test('rejects unknown engines and duplicated names', () => {
  const db = gluesql();

  assert.throws(
    () => db.addEngine('scratch', { storage: 'nope' }),
    /invalid storage config: unknown variant `nope`/,
  );
  assert.throws(
    () => db.addEngine('memory', { storage: 'memory' }),
    /engine already exists: memory/,
  );
  assert.throws(
    () => db.setDefaultEngine('scratch'),
    /engine not found: scratch \(registered: memory\)/,
  );
  assert.throws(() => db.removeEngine('scratch'), /engine not found: scratch/);
});

test('rejects engine names no ENGINE clause could reach', () => {
  const db = gluesql();

  for (const name of ['', '  ', 'my-db', '1st', 'a b']) {
    assert.throws(
      () => db.addEngine(name, { storage: 'memory' }),
      /invalid engine name/,
      `expected ${JSON.stringify(name)} to be rejected`,
    );
  }

  db.addEngine('my_db2', { storage: 'memory' });

  assert.deepEqual(db.listEngines(), ['memory', 'my_db2']);
});

test('rejects misspelled and misplaced config options', () => {
  const db = gluesql();

  // Would silently hand back a volatile engine if unknown keys were dropped.
  assert.throws(
    () => db.addEngine('disk', { storage: 'memory', path: './data' }),
    /invalid storage config: unknown field `path`/,
  );
  assert.throws(
    () => db.addEngine('disk', { storage: 'redb', paht: './data.db' }),
    /invalid storage config: unknown field `paht`/,
  );
});

test('supports custom functions', async () => {
  const db = gluesql();

  await db.query('CREATE FUNCTION add_one (n INT) RETURN n + 1');

  assert.deepEqual(await db.query('SELECT add_one(1) AS value'), [
    { type: 'SELECT', rows: [{ value: 2 }] },
  ]);
  assert.deepEqual(await db.query('SHOW FUNCTIONS'), [
    { type: 'SHOW FUNCTIONS', functions: ['add_one(n: INT)'] },
  ]);

  await db.query('DROP FUNCTION add_one');

  await assert.rejects(
    () => db.query('SELECT add_one(1) AS value'),
    /unsupported function: ADD_ONE/,
  );
});

test('reports table metadata of every engine', async (t) => {
  const db = gluesql({ engines: { docs: { storage: 'json', path: tempDir(t) } } });

  await db.query(`
    CREATE TABLE Cached (id INTEGER) ENGINE = memory;
    CREATE TABLE Docs (id INTEGER) ENGINE = docs;
  `);

  const [{ rows }] = await db.query(
    'SELECT OBJECT_NAME, CREATED FROM GLUE_OBJECTS ORDER BY OBJECT_NAME',
  );

  // Every engine contributes its tables; only the in-memory engine records a
  // creation timestamp.
  assert.deepEqual(
    rows.map(({ OBJECT_NAME }) => OBJECT_NAME),
    ['Cached', 'Docs'],
  );
  assert.match(rows[0].CREATED, /^\d{4}-\d{2}-\d{2} /);
  assert.equal(rows[1].CREATED, null);
});

test('reports the backends this build carries', () => {
  const compiled = storages();

  assert.deepEqual(compiled, [...compiled].sort());

  // The published build ships every embedded, pure-Rust backend.
  for (const name of ['csv', 'json', 'memory', 'redb']) {
    assert.ok(compiled.includes(name), `expected the build to carry ${name}`);
  }
});

test('rejects backends this build does not carry', (t) => {
  const missing = ['mongo', 'parquet', 'redis'].filter(
    (name) => !storages().includes(name),
  );

  if (missing.length === 0) {
    return t.skip('build with every optional storage');
  }

  for (const name of missing) {
    assert.throws(
      () => gluesql().addEngine('extra', { storage: name, path: './data' }),
      new RegExp(`invalid storage config: unknown variant \`${name}\``),
      `expected ${name} to be reported as unavailable`,
    );
  }
});
