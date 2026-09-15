import jwt from 'jsonwebtoken';
import { Request, Response, NextFunction } from 'express';
import { pg } from './db.ts';

const JWT_SECRET = process.env.JWT_SECRET || 'fareflow-conductor-secret-key-2026';

export interface ConductorUser {
  id: number;
  name: string;
  phone_number: string;
  sacco: string;
  national_id?: string;
  is_active: boolean;
}

export interface AuthenticatedRequest extends Request {
  conductor?: ConductorUser;
}

export function generateToken(conductor: ConductorUser): string {
  return jwt.sign(
    {
      id: conductor.id,
      name: conductor.name,
      phone_number: conductor.phone_number,
      sacco: conductor.sacco,
    },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
}

export async function authenticateConductor(phone: string, pin: string): Promise<{ token: string; conductor: ConductorUser } | null> {
  const cleanPhone = phone.replace(/\D/g, '');
  // Match standard 07... or 2547...
  const queryResult = await pg.query<ConductorUser & { pin_hash: string }>(
    `SELECT id, name, phone_number, pin_hash, sacco, national_id, is_active 
     FROM conductors 
     WHERE phone_number = $1 OR phone_number = $2 OR phone_number LIKE $3
     LIMIT 1;`,
    [phone, cleanPhone, `%${cleanPhone.slice(-9)}`]
  );

  if (queryResult.rows.length === 0) {
    return null;
  }

  const conductor = queryResult.rows[0];
  // Verify PIN (matches pin_hash directly for demo simplicity)
  if (conductor.pin_hash !== pin) {
    return null;
  }

  const userSafe: ConductorUser = {
    id: conductor.id,
    name: conductor.name,
    phone_number: conductor.phone_number,
    sacco: conductor.sacco,
    national_id: conductor.national_id,
    is_active: conductor.is_active,
  };

  const token = generateToken(userSafe);
  return { token, conductor: userSafe };
}

export function requireConductorAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Conductor PIN login required.' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as ConductorUser;
    req.conductor = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Session expired or invalid token. Tafadhali login tena.' });
  }
}
