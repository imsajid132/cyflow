# Real-database integration tests

These run the real repositories, services and HTTP app against a real MariaDB.
Everything else in the suite uses in-memory fakes, and every defect that reached
the deployed host in this project was invisible to those fakes:

- `CAST(? AS JSON)`, MySQL-only syntax MariaDB rejects at parse time
- an `UPDATE` whose `affectedRows` nobody checked
- `INSERT ... ON DUPLICATE KEY UPDATE` reporting `affectedRows = 1` for a
  *matched* row on MariaDB, so every duplicate enqueue claimed to have created a job
- `SELECT ... FOR UPDATE` on a non-existent row taking a gap lock, so two
  instances deadlocked on the very first scheduler tick
- a queue claim outside its transaction, so two concurrent requests each created
  a scheduled post

## Running

Start a disposable database (never point this at staging or production — it
TRUNCATES tables):

```sh
docker run -d --name cyflow-test-mariadb \
  -e MARIADB_ROOT_PASSWORD="$(openssl rand -base64 18)" \
  -e MARIADB_DATABASE=cyflow_test -p 13306:3306 mariadb:10.11
```

Apply the schema, then the committed migrations:

```sh
docker exec -i cyflow-test-mariadb mariadb -uroot -p"$PW" cyflow_test < database/schema.sql
for f in database/migrations/0*.sql; do
  docker exec -i cyflow-test-mariadb mariadb -uroot -p"$PW" cyflow_test < "$f"
done
```

Then:

```sh
CYFLOW_TEST_DB_HOST=127.0.0.1 CYFLOW_TEST_DB_PORT=13306 \
CYFLOW_TEST_DB_USER=root CYFLOW_TEST_DB_PASSWORD="$PW" \
CYFLOW_TEST_DB_NAME=cyflow_test npm run test:integration
```

Tear down:

```sh
docker rm -f cyflow-test-mariadb
```

## Notes

Without `CYFLOW_TEST_DB_HOST` the tests **skip**, and `npm test` reports them as
skipped rather than passed. A skip is not a pass.

The database variables are applied by `helpers/preload.js` through `node
--import`, because ES module imports are hoisted: anything set at the top of a
test file runs *after* `src/config/env.js` has already validated and frozen
`process.env`.

Only the external network boundaries are mocked — OpenAI, HCTI and the provider
adapters. The provider adapters are counting stubs that throw if called, and
every journey test asserts zero provider calls.
