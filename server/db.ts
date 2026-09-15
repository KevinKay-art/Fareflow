import path from 'path';
import fs from 'fs';
import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
import pgPkg from 'pg';

const { Pool } = pgPkg;

interface QueryResult<T = any> {
  rows: T[];
  rowCount?: number;
}

interface DatabaseAdapter {
  exec: (sql: string) => Promise<void>;
  query: <T = any>(sql: string, params?: any[]) => Promise<QueryResult<T>>;
  transaction: <T = any>(callback: (tx: DatabaseAdapter) => Promise<T>) => Promise<T>;
}

// ---------------------------------------------------------------------------
// 1. PostgreSQL Adapter (Used when DATABASE_URL is set, e.g. Render/Cloud SQL)
// ---------------------------------------------------------------------------
let pool: pgPkg.Pool | null = null;
if (process.env.DATABASE_URL) {
  console.log('[Database] Connecting to PostgreSQL via DATABASE_URL...');
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL.includes('localhost')
      ? false
      : { rejectUnauthorized: false },
    max: 5,
  });
}

// ---------------------------------------------------------------------------
// 2. Embedded SQLite (sql.js) Adapter (Zero-config, ~60MB RAM fallback)
// ---------------------------------------------------------------------------
let sqliteDb: SqlJsDatabase | null = null;
const dbFilePath = path.join(process.cwd(), '.fareflow.sqlite');

function saveSqliteToFile() {
  if (!sqliteDb) return;
  try {
    const data = sqliteDb.export();
    fs.writeFileSync(dbFilePath, Buffer.from(data));
  } catch (err) {
    console.error('[Database] Error saving SQLite database to disk:', err);
  }
}

async function getSqliteDb(): Promise<SqlJsDatabase> {
  if (sqliteDb) return sqliteDb;

  const SQL = await initSqlJs();
  if (fs.existsSync(dbFilePath)) {
    try {
      const fileBuffer = fs.readFileSync(dbFilePath);
      sqliteDb = new SQL.Database(fileBuffer);
      console.log('[Database] Loaded existing database from disk:', dbFilePath);
      return sqliteDb;
    } catch (err) {
      console.warn('[Database] Could not read existing sqlite file, creating fresh database:', err);
    }
  }

  sqliteDb = new SQL.Database();
  console.log('[Database] Initialized fresh SQLite database instance.');
  return sqliteDb;
}

// Helper: Translate PostgreSQL DDL & dialect queries into SQLite compatible syntax
function sanitizeSqlForSqlite(sql: string): string {
  return sql
    .replace(/\bSERIAL\s+PRIMARY\s+KEY\b/gi, 'INTEGER PRIMARY KEY AUTOINCREMENT')
    .replace(/\bTIMESTAMP\s+WITH\s+TIME\s+ZONE\b/gi, 'DATETIME')
    .replace(/\bTIMESTAMP\s+WITHOUT\s+TIME\s+ZONE\b/gi, 'DATETIME')
    .replace(/\bJSONB\b/gi, 'TEXT')
    .replace(/\bILIKE\b/gi, 'LIKE')
    .replace(/CURRENT_TIMESTAMP\s*-\s*INTERVAL\s*'(\d+)\s*hours?'/gi, "datetime('now', '-$1 hours')")
    .replace(/CURRENT_TIMESTAMP\s*-\s*INTERVAL\s*'(\d+)\s*minutes?'/gi, "datetime('now', '-$1 minutes')")
    .replace(/CURRENT_TIMESTAMP\s*-\s*INTERVAL\s*'4\s*hours\s*40\s*minutes?'/gi, "datetime('now', '-4 hours')");
}

function sanitizeParamsForSqlite(params?: any[]): any[] {
  if (!params || !Array.isArray(params)) return [];
  return params.map(val => {
    if (typeof val === 'boolean') return val ? 1 : 0;
    if (val !== null && typeof val === 'object') {
      try {
        return JSON.stringify(val);
      } catch {
        return String(val);
      }
    }
    return val;
  });
}

// ---------------------------------------------------------------------------
// Unified Exported Database Interface (pg)
// ---------------------------------------------------------------------------
export const pg: DatabaseAdapter = {
  exec: async (sql: string): Promise<void> => {
    if (pool) {
      await pool.query(sql);
      return;
    }

    const db = await getSqliteDb();
    const sanitized = sanitizeSqlForSqlite(sql);
    db.run(sanitized);
    saveSqliteToFile();
  },

  query: async <T = any>(sql: string, params?: any[]): Promise<QueryResult<T>> => {
    if (pool) {
      const res = await pool.query(sql, params);
      return { rows: res.rows as T[], rowCount: res.rowCount ?? res.rows.length };
    }

    const db = await getSqliteDb();
    const sanitizedSql = sanitizeSqlForSqlite(sql);
    const sanitizedParams = sanitizeParamsForSqlite(params);

    try {
      if (!sanitizedParams || sanitizedParams.length === 0) {
        // Query without parameters
        const isSelectOrReturning = /^\s*(SELECT|INSERT.*RETURNING|UPDATE.*RETURNING|DELETE.*RETURNING)/i.test(sanitizedSql);
        
        if (isSelectOrReturning) {
          const stmt = db.prepare(sanitizedSql);
          const rows: T[] = [];
          while (stmt.step()) {
            rows.push(stmt.getAsObject() as unknown as T);
          }
          stmt.free();
          return { rows, rowCount: rows.length };
        } else {
          db.run(sanitizedSql);
          saveSqliteToFile();
          return { rows: [], rowCount: 1 };
        }
      } else {
        // Parameterized query ($1, $2, ...)
        const stmt = db.prepare(sanitizedSql);
        stmt.bind(sanitizedParams);
        const rows: T[] = [];
        while (stmt.step()) {
          rows.push(stmt.getAsObject() as unknown as T);
        }
        stmt.free();

        // If it was a mutation, persist to disk
        if (!/^\s*SELECT/i.test(sanitizedSql)) {
          saveSqliteToFile();
        }

        return { rows, rowCount: rows.length };
      }
    } catch (err: any) {
      console.error('[Database Error] SQL failed:', sanitizedSql, 'Params:', sanitizedParams, 'Error:', err);
      throw err;
    }
  },

  transaction: async <T = any>(callback: (tx: DatabaseAdapter) => Promise<T>): Promise<T> => {
    if (pool) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const txAdapter: DatabaseAdapter = {
          exec: async (s: string) => { await client.query(s); },
          query: async <R = any>(s: string, p?: any[]) => {
            const res = await client.query(s, p);
            return { rows: res.rows as R[], rowCount: res.rowCount ?? res.rows.length };
          },
          transaction: async <R = any>(cb: any) => cb(txAdapter),
        };
        const result = await callback(txAdapter);
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    }

    // For SQLite, wrap in BEGIN / COMMIT
    const db = await getSqliteDb();
    db.run('BEGIN TRANSACTION;');
    try {
      const result = await callback(pg);
      db.run('COMMIT;');
      saveSqliteToFile();
      return result;
    } catch (err) {
      try {
        db.run('ROLLBACK;');
      } catch {}
      throw err;
    }
  }
};

// ---------------------------------------------------------------------------
// Database Initialization & Seed Data (047 Nganya SACCO)
// ---------------------------------------------------------------------------
export async function initDatabase() {
  console.log('[Database] Initializing schema and seed records...');

  // Create tables
  await pg.exec(`
    -- 1. Vehicles Table
    CREATE TABLE IF NOT EXISTS vehicles (
      id SERIAL PRIMARY KEY,
      reg_number VARCHAR(20) UNIQUE NOT NULL,
      fleet_name VARCHAR(100) NOT NULL,
      sacco_name VARCHAR(100) NOT NULL,
      capacity INTEGER NOT NULL DEFAULT 33,
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );

    -- 2. Routes Table
    CREATE TABLE IF NOT EXISTS routes (
      id SERIAL PRIMARY KEY,
      code VARCHAR(20) NOT NULL,
      name VARCHAR(150) NOT NULL,
      base_fare INTEGER NOT NULL DEFAULT 100,
      peak_fare INTEGER NOT NULL DEFAULT 120,
      off_peak_fare INTEGER NOT NULL DEFAULT 80,
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );

    -- 3. Conductors Table
    CREATE TABLE IF NOT EXISTS conductors (
      id SERIAL PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      phone_number VARCHAR(20) UNIQUE NOT NULL,
      pin_hash VARCHAR(100) NOT NULL,
      sacco VARCHAR(100) NOT NULL,
      national_id VARCHAR(30),
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );

    -- 4. Shifts Table
    CREATE TABLE IF NOT EXISTS shifts (
      id SERIAL PRIMARY KEY,
      conductor_id INTEGER NOT NULL REFERENCES conductors(id),
      vehicle_id INTEGER NOT NULL REFERENCES vehicles(id),
      route_id INTEGER NOT NULL REFERENCES routes(id),
      fare_mode VARCHAR(20) NOT NULL DEFAULT 'STANDARD',
      current_fare_amount INTEGER NOT NULL DEFAULT 100,
      status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
      start_time TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      end_time TIMESTAMP WITH TIME ZONE,
      opening_cash INTEGER NOT NULL DEFAULT 0,
      closing_cash INTEGER DEFAULT 0,
      total_collected INTEGER NOT NULL DEFAULT 0,
      cash_total INTEGER NOT NULL DEFAULT 0,
      digital_total INTEGER NOT NULL DEFAULT 0,
      passenger_count INTEGER NOT NULL DEFAULT 0,
      notes TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );

    -- 5. Fares Table
    CREATE TABLE IF NOT EXISTS fares (
      id SERIAL PRIMARY KEY,
      shift_id INTEGER NOT NULL REFERENCES shifts(id),
      conductor_id INTEGER NOT NULL REFERENCES conductors(id),
      vehicle_id INTEGER NOT NULL REFERENCES vehicles(id),
      route_id INTEGER NOT NULL REFERENCES routes(id),
      amount INTEGER NOT NULL,
      fare_type VARCHAR(30) NOT NULL DEFAULT 'STANDARD',
      stage_name VARCHAR(100) DEFAULT 'Stage Stop',
      payment_method VARCHAR(30) NOT NULL,
      status VARCHAR(30) NOT NULL DEFAULT 'PENDING',
      idempotency_key VARCHAR(100) UNIQUE NOT NULL,
      passenger_phone VARCHAR(20),
      mpesa_receipt_number VARCHAR(50),
      failure_reason TEXT,
      is_offline_synced BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );

    -- 6. Payments Table
    CREATE TABLE IF NOT EXISTS payments (
      id SERIAL PRIMARY KEY,
      fare_id INTEGER REFERENCES fares(id),
      shift_id INTEGER NOT NULL REFERENCES shifts(id),
      amount INTEGER NOT NULL,
      method VARCHAR(30) NOT NULL,
      status VARCHAR(30) NOT NULL DEFAULT 'INITIATED',
      provider VARCHAR(50) NOT NULL DEFAULT 'DARAJA_MPESA',
      checkout_request_id VARCHAR(100) UNIQUE,
      merchant_request_id VARCHAR(100),
      mpesa_receipt_number VARCHAR(50),
      phone_number VARCHAR(20),
      failure_reason TEXT,
      raw_callback JSONB,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );

    -- 7. Sync Queue Table
    CREATE TABLE IF NOT EXISTS sync_queue (
      id SERIAL PRIMARY KEY,
      client_tx_id VARCHAR(100) UNIQUE NOT NULL,
      shift_id INTEGER REFERENCES shifts(id),
      conductor_id INTEGER REFERENCES conductors(id),
      payload JSONB NOT NULL,
      sync_status VARCHAR(30) NOT NULL DEFAULT 'QUEUED',
      error_message TEXT,
      processed_at TIMESTAMP WITH TIME ZONE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_fares_shift ON fares(shift_id);
    CREATE INDEX IF NOT EXISTS idx_fares_status ON fares(status);
    CREATE INDEX IF NOT EXISTS idx_fares_receipt ON fares(mpesa_receipt_number);
    CREATE INDEX IF NOT EXISTS idx_payments_checkout ON payments(checkout_request_id);
    CREATE INDEX IF NOT EXISTS idx_payments_shift ON payments(shift_id);
    CREATE INDEX IF NOT EXISTS idx_shifts_conductor ON shifts(conductor_id, status);
  `);

  // Seed default vehicles if empty
  const vehicleCount = await pg.query(`SELECT COUNT(*) as count FROM vehicles;`);
  if (Number((vehicleCount.rows[0] as any).count) === 0) {
    console.log('[Database] Seeding 047 Nganya SACCO vehicles...');
    await pg.exec(`
      INSERT INTO vehicles (reg_number, fleet_name, sacco_name, capacity) VALUES
      ('KDA 482G', 'G-Force Express', '047 Nganya SACCO', 33),
      ('KCU 915M', 'Silver Bullet', '047 Nganya SACCO', 33),
      ('KDE 204T', 'City Glider', 'City Shuttle Sacco', 41),
      ('KBZ 772Q', 'Eastleigh Flyer', 'Forward Travellers', 14);
    `);
  }

  // Ensure all existing vehicles reflect 047 Nganya SACCO
  await pg.exec(`
    UPDATE vehicles SET sacco_name = '047 Nganya SACCO' WHERE sacco_name ILIKE '%super metro%';
    UPDATE conductors SET sacco = '047 Nganya SACCO' WHERE sacco ILIKE '%super metro%';
  `);

  // Seed default routes if empty
  const routeCount = await pg.query(`SELECT COUNT(*) as count FROM routes;`);
  if (Number((routeCount.rows[0] as any).count) === 0) {
    console.log('[Database] Seeding Nairobi routes...');
    await pg.exec(`
      INSERT INTO routes (code, name, base_fare, peak_fare, off_peak_fare) VALUES
      ('105', 'CBD - Rongai (via Langata Rd)', 100, 120, 80),
      ('44', 'CBD - Kahawa West (via Thika Rd)', 80, 100, 60),
      ('33', 'CBD - Pipeline / Embakasi (via Outering)', 70, 90, 50),
      ('111', 'CBD - Ngong Town (via Karen)', 100, 130, 80);
    `);
  }

  // Seed default conductors if empty
  const conductorCount = await pg.query(`SELECT COUNT(*) as count FROM conductors;`);
  if (Number((conductorCount.rows[0] as any).count) === 0) {
    console.log('[Database] Seeding conductors...');
    await pg.exec(`
      INSERT INTO conductors (name, phone_number, pin_hash, sacco, national_id) VALUES
      ('Kiprono "Kevo" Langat', '0712345678', '1234', '047 Nganya SACCO', '32456789'),
      ('Mwangi "Maina" Kamau', '0722001122', '2540', 'City Shuttle Sacco', '29845123'),
      ('Amina "Mama Mat" Hassan', '0733998877', '0000', 'Forward Travellers', '34129845');
    `);
  }

  // Seed initial shift and historical fares for immediate analytics
  const shiftCount = await pg.query(`SELECT COUNT(*) as count FROM shifts;`);
  if (Number((shiftCount.rows[0] as any).count) === 0) {
    console.log('[Database] Seeding demo shifts and audited transactions...');
    await pg.exec(`
      INSERT INTO shifts (
        conductor_id, vehicle_id, route_id, fare_mode, current_fare_amount,
        status, start_time, end_time, opening_cash, closing_cash,
        total_collected, cash_total, digital_total, passenger_count, notes
      ) VALUES (
        1, 1, 1, 'PEAK', 120,
        'COMPLETED', CURRENT_TIMESTAMP - INTERVAL '6 hours', CURRENT_TIMESTAMP - INTERVAL '1 hour',
        500, 4200, 12840, 3700, 9140, 107, 'Morning peak run. Heavy traffic at Galleria. Reconciled clean.'
      );

      INSERT INTO fares (
        shift_id, conductor_id, vehicle_id, route_id, amount,
        fare_type, stage_name, payment_method, status,
        idempotency_key, passenger_phone, mpesa_receipt_number, created_at
      ) VALUES
      (1, 1, 1, 1, 120, 'STANDARD', 'CBD Stage', 'MPESA_STK', 'CONFIRMED', 'SEED-TX-001', '0712889900', 'QFT7931KD8', CURRENT_TIMESTAMP - INTERVAL '5 hours'),
      (1, 1, 1, 1, 120, 'STANDARD', 'CBD Stage', 'MPESA_STK', 'CONFIRMED', 'SEED-TX-002', '0724112233', 'QFT7932AL2', CURRENT_TIMESTAMP - INTERVAL '5 hours'),
      (1, 1, 1, 1, 100, 'STUDENT', 'Madaraka', 'CASH', 'CONFIRMED', 'SEED-TX-003', NULL, NULL, CURRENT_TIMESTAMP - INTERVAL '4 hours 40 minutes'),
      (1, 1, 1, 1, 120, 'STANDARD', 'Bomas', 'DYNAMIC_QR', 'CONFIRMED', 'SEED-TX-004', '0799445566', 'QFT7935ZM9', CURRENT_TIMESTAMP - INTERVAL '3 hours'),
      (1, 1, 1, 1, 120, 'STANDARD', 'Karen Roundabout', 'MPESA_STK', 'FAILED', 'SEED-TX-005', '0700112233', NULL, CURRENT_TIMESTAMP - INTERVAL '2 hours');
    `);
  }

  console.log('[Database] Schema and initial seed data ready.');
}
