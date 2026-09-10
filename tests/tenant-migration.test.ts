import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const root = path.resolve(process.cwd());
const migration = (name: string) => fs.readFileSync(path.join(root, 'drizzle', name), 'utf8');

function createLegacyPopulatedDatabase() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(migration('0000_init.sql'));
  db.exec(migration('0001_phase1_1_security.sql'));
  db.exec(migration('0002_attendance_clock_order_insert_guard.sql'));
  db.exec(`
    INSERT INTO departments VALUES ('d1','Engineering',CURRENT_TIMESTAMP);
    INSERT INTO employees (id,employee_code,first_name,last_name,work_email,date_of_joining,department_id,designation)
      VALUES ('e1','E1','A','One','a@example.test','2026-01-01','d1','Engineer');
    INSERT INTO users (id,email,password_hash,password_salt,role,employee_id)
      VALUES ('u1','a@example.test','h','s','admin','e1');
    INSERT INTO sessions (id,user_id,expires_at,last_active_at)
      VALUES ('s1','u1','2099-01-01T00:00:00.000Z',CURRENT_TIMESTAMP);
    INSERT INTO login_rate_limits (key,failed_attempts,window_started_at)
      VALUES ('k1',1,CURRENT_TIMESTAMP);
    INSERT INTO leave_types VALUES ('lt1','Annual',18,1,CURRENT_TIMESTAMP);
    INSERT INTO leave_balances VALUES ('lb1','e1','lt1',2026,18,0,CURRENT_TIMESTAMP);
    INSERT INTO leave_requests (id,employee_id,leave_type_id,start_date,end_date,days,status)
      VALUES ('lr1','e1','lt1','2026-09-10','2026-09-10',1,'pending');
    INSERT INTO attendance_records (id,employee_id,work_date,clock_in_at,status)
      VALUES ('a1','e1','2026-09-10','2026-09-10T08:00:00Z','present');
    INSERT INTO audit_logs (id,actor_user_id,action,entity_type,entity_id)
      VALUES ('al1','u1','test','employee','e1');
  `);
  return db;
}

test('Phase 1.2a migration backfills a populated Phase 1.1 database without data loss', () => {
  const db = createLegacyPopulatedDatabase();
  const tables = [
    'departments',
    'employees',
    'users',
    'sessions',
    'login_rate_limits',
    'leave_types',
    'leave_balances',
    'leave_requests',
    'attendance_records',
    'audit_logs'
  ];
  const before = Object.fromEntries(
    tables.map((table) => {
      const row = db.prepare(`SELECT count(*) AS count FROM ${table}`).get() as { count: number } | undefined;
      assert.ok(row);
      return [table, Number(row.count)];
    })
  );

  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(migration('0003_multi_tenant_foundation.sql'));
    db.exec('COMMIT');
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  }

  const organizationRow = db.prepare('SELECT count(*) AS count FROM organizations').get() as { count: number } | undefined;
  assert.ok(organizationRow);
  assert.equal(Number(organizationRow.count), 1);
  for (const table of tables) {
    const row = db.prepare(`SELECT count(*) AS count FROM ${table}`).get() as { count: number } | undefined;
    assert.ok(row);
    const count = Number(row.count);
    assert.equal(count, before[table], `${table} row count changed during migration`);
    const badTenantRows = Number(
      (db.prepare(`SELECT count(*) AS count FROM ${table} WHERE organization_id IS NULL OR organization_id <> 'org_default'`).get() as { count: number } | undefined)?.count ?? 0
    );
    assert.equal(badTenantRows, 0, `${table} contains an unbackfilled organization_id`);
  }

  const columnInfo = db.prepare('PRAGMA table_info(employees)').all() as Array<{ name: string; notnull: number }>;
  const organizationColumn = columnInfo.find((column) => column.name === 'organization_id');
  assert.ok(organizationColumn);
  assert.equal(organizationColumn!.notnull, 1);

  const triggerRow = db.prepare(`
    SELECT count(*) AS count
    FROM sqlite_master
    WHERE type = 'trigger'
      AND name IN (
        'attendance_coordinates_insert_guard',
        'attendance_coordinates_update_guard',
        'attendance_clock_order_guard',
        'attendance_clock_order_insert_guard',
        'leave_request_transition_guard',
        'audit_logs_no_update',
        'audit_logs_no_delete'
      )
  `).get() as { count: number } | undefined;
  assert.ok(triggerRow);
  const triggerCount = Number(triggerRow.count);
  assert.equal(triggerCount, 7);
  db.close();
});
