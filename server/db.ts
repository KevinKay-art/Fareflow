import { PGlite } from '@electric-sql/pglite';
import path from 'path';
import fs from 'fs';

// Ensure data directory exists for PostgreSQL persistence
const dataDir = path.join(process.cwd(), '.pglite_data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const rawPg = new PGlite(dataDir);
export const pg = {
  exec: (sql: string) => rawPg.exec(sql),
  query: async <T = any>(sql: string, params?: any[]): Promise<{ rows: T[] }> => {
    const res = await rawPg.query<T>(sql, params);
    return res as unknown as { rows: T[] };
  },
  transaction: <T = any>(callback: (tx: any) => Promise<T>): Promise<T> => {
    return rawPg.transaction(callback as any) as Promise<T>;
  }
};

export async function initDatabase() {
  console.log('[Database] Initializing PostgreSQL database with FareFlow schema...');

  // Create tables with relational constraints, foreign keys, and indexes
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
      conductor_id INTEGER NOT NULL REFERENCES conductors(id) ON DELETE RESTRICT,
      vehicle_id INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE RESTRICT,
      route_id INTEGER NOT NULL REFERENCES routes(id) ON DELETE RESTRICT,
      fare_mode VARCHAR(20) NOT NULL DEFAULT 'STANDARD', -- 'STANDARD', 'PEAK', 'OFF_PEAK'
      current_fare_amount INTEGER NOT NULL DEFAULT 100,
      status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE', -- 'ACTIVE', 'COMPLETED'
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
      shift_id INTEGER NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
      conductor_id INTEGER NOT NULL REFERENCES conductors(id) ON DELETE RESTRICT,
      vehicle_id INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE RESTRICT,
      route_id INTEGER NOT NULL REFERENCES routes(id) ON DELETE RESTRICT,
      amount INTEGER NOT NULL,
      fare_type VARCHAR(30) NOT NULL DEFAULT 'STANDARD', -- 'STANDARD', 'STUDENT', 'SHORT_STAGE', 'CUSTOM'
      stage_name VARCHAR(100) DEFAULT 'Stage Stop',
      payment_method VARCHAR(30) NOT NULL, -- 'MPESA_STK', 'CASH', 'DYNAMIC_QR'
      status VARCHAR(30) NOT NULL DEFAULT 'PENDING', -- 'PENDING', 'CONFIRMED', 'FAILED', 'DISPUTED'
      idempotency_key VARCHAR(100) UNIQUE NOT NULL,
      passenger_phone VARCHAR(20),
      mpesa_receipt_number VARCHAR(50),
      failure_reason TEXT,
      is_offline_synced BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );

    -- 6. Payments Table (Granular transaction ledger)
    CREATE TABLE IF NOT EXISTS payments (
      id SERIAL PRIMARY KEY,
      fare_id INTEGER REFERENCES fares(id) ON DELETE SET NULL,
      shift_id INTEGER NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
      amount INTEGER NOT NULL,
      method VARCHAR(30) NOT NULL, -- 'MPESA_STK', 'CASH', 'DYNAMIC_QR'
      status VARCHAR(30) NOT NULL DEFAULT 'INITIATED', -- 'INITIATED', 'SUCCESS', 'FAILED', 'CANCELLED'
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

    -- 7. Sync Queue Table (Client offline batch reconciliation & deduplication)
    CREATE TABLE IF NOT EXISTS sync_queue (
      id SERIAL PRIMARY KEY,
      client_tx_id VARCHAR(100) UNIQUE NOT NULL,
      shift_id INTEGER REFERENCES shifts(id) ON DELETE CASCADE,
      conductor_id INTEGER REFERENCES conductors(id) ON DELETE SET NULL,
      payload JSONB NOT NULL,
      sync_status VARCHAR(30) NOT NULL DEFAULT 'QUEUED', -- 'QUEUED', 'PROCESSED', 'CONFLICT', 'ERROR'
      error_message TEXT,
      processed_at TIMESTAMP WITH TIME ZONE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );

    -- Create helpful indexes
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
    console.log('[Database] Seeding demo vehicles...');
    await pg.exec(`
      INSERT INTO vehicles (reg_number, fleet_name, sacco_name, capacity) VALUES
      ('KDA 482G', 'G-Force Express', '047 Nganya SACCO', 33),
      ('KCU 915M', 'Silver Bullet', '047 Nganya SACCO', 33),
      ('KDE 204T', 'City Glider', 'City Shuttle Sacco', 41),
      ('KBZ 772Q', 'Eastleigh Flyer', 'Forward Travellers', 14);
    `);
  }

  // Ensure any existing records reflect 047 Nganya SACCO
  await pg.exec(`
    UPDATE vehicles SET sacco_name = '047 Nganya SACCO' WHERE sacco_name ILIKE '%super metro%';
    UPDATE conductors SET sacco = '047 Nganya SACCO' WHERE sacco ILIKE '%super metro%';
  `);

  // Seed default routes if empty
  const routeCount = await pg.query(`SELECT COUNT(*) as count FROM routes;`);
  if (Number((routeCount.rows[0] as any).count) === 0) {
    console.log('[Database] Seeding demo routes...');
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
    console.log('[Database] Seeding demo conductors...');
    // Simple PIN storage (in production hashed with bcrypt; for easy demo PINs 1234, 2540, 0000)
    await pg.exec(`
      INSERT INTO conductors (name, phone_number, pin_hash, sacco, national_id) VALUES
      ('Kiprono "Kevo" Langat', '0712345678', '1234', '047 Nganya SACCO', '32456789'),
      ('Mwangi "Maina" Kamau', '0722001122', '2540', 'City Shuttle Sacco', '29845123'),
      ('Amina "Mama Mat" Hassan', '0733998877', '0000', 'Forward Travellers', '34129845');
    `);
  }

  // Seed some historic shifts and fares so SACCO / Owner Dashboard has rich analytics immediately
  const shiftCount = await pg.query(`SELECT COUNT(*) as count FROM shifts;`);
  if (Number((shiftCount.rows[0] as any).count) === 0) {
    console.log('[Database] Seeding initial shift and reconciled transaction history...');
    await pg.exec(`
      -- Insert a completed shift from earlier today
      INSERT INTO shifts (
        conductor_id, vehicle_id, route_id, fare_mode, current_fare_amount,
        status, start_time, end_time, opening_cash, closing_cash,
        total_collected, cash_total, digital_total, passenger_count, notes
      ) VALUES (
        1, 1, 1, 'PEAK', 120,
        'COMPLETED', CURRENT_TIMESTAMP - INTERVAL '6 hours', CURRENT_TIMESTAMP - INTERVAL '1 hour',
        500, 4200, 12840, 3700, 9140, 107, 'Morning peak run. Heavy traffic at Galleria. Reconciled clean.'
      );

      -- Insert some historical completed fares for audit
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

  console.log('[Database] Schema and seed data successfully initialized.');
}
