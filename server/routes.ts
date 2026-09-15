import express, { Request, Response } from 'express';
import QRCode from 'qrcode';
import { pg } from './db.ts';
import { 
  authenticateConductor, 
  requireConductorAuth, 
  AuthenticatedRequest 
} from './auth.ts';
import { 
  initiateSTKPush, 
  generateMpesaReceiptNumber, 
  darajaConfig, 
  updateDarajaConfig,
  formatKenyanPhone 
} from './daraja.ts';

export const apiRouter = express.Router();

// ---------------------------------------------------------------------------
// 0. HEALTH CHECK
// ---------------------------------------------------------------------------
apiRouter.get('/health', async (req: Request, res: Response) => {
  try {
    const dbTest = await pg.query('SELECT 1 as alive;');
    res.json({
      status: 'ok',
      service: 'FareFlow Matatu Fleet Core API',
      database: 'PostgreSQL (PGlite)',
      db_alive: dbTest.rows.length > 0,
      timestamp: new Date().toISOString(),
      daraja_simulated: darajaConfig.isSimulated,
    });
  } catch (err: any) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// ---------------------------------------------------------------------------
// 1. AUTHENTICATION (Phone + PIN)
// ---------------------------------------------------------------------------
apiRouter.post('/auth/login', async (req: Request, res: Response) => {
  const { phone, pin } = req.body;
  if (!phone || !pin) {
    return res.status(400).json({ error: 'Tafadhali weka nambari ya simu na PIN (Phone & PIN required).' });
  }

  try {
    const result = await authenticateConductor(phone, pin);
    if (!result) {
      return res.status(401).json({ error: 'Nambari ya simu au PIN sio sahihi (Invalid Phone or PIN).' });
    }

    // Check if conductor has an active shift
    const activeShiftRes = await pg.query(
      `SELECT s.*, v.reg_number, v.fleet_name, r.code as route_code, r.name as route_name
       FROM shifts s
       JOIN vehicles v ON s.vehicle_id = v.id
       JOIN routes r ON s.route_id = r.id
       WHERE s.conductor_id = $1 AND s.status = 'ACTIVE'
       ORDER BY s.id DESC LIMIT 1;`,
      [result.conductor.id]
    );

    const activeShift = activeShiftRes.rows[0] || null;

    res.json({
      success: true,
      token: result.token,
      conductor: result.conductor,
      activeShift,
    });
  } catch (err: any) {
    console.error('[Auth Error]', err);
    res.status(500).json({ error: 'Hitilafu ya seva (Server error): ' + err.message });
  }
});

// Quick demo conductor list for low-friction evaluation
apiRouter.get('/auth/demo-conductors', async (req: Request, res: Response) => {
  try {
    const conductors = await pg.query(
      `SELECT id, name, phone_number, sacco, national_id FROM conductors WHERE is_active = true ORDER BY id;`
    );
    res.json(conductors.rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.get('/auth/me', requireConductorAuth, async (req: AuthenticatedRequest, res: Response) => {
  const conductorId = req.conductor!.id;
  try {
    const conductorRes = await pg.query(
      `SELECT id, name, phone_number, sacco, national_id FROM conductors WHERE id = $1;`,
      [conductorId]
    );
    if (conductorRes.rows.length === 0) {
      return res.status(404).json({ error: 'Conductor not found' });
    }

    const activeShiftRes = await pg.query(
      `SELECT s.*, v.reg_number, v.fleet_name, v.capacity, r.code as route_code, r.name as route_name
       FROM shifts s
       JOIN vehicles v ON s.vehicle_id = v.id
       JOIN routes r ON s.route_id = r.id
       WHERE s.conductor_id = $1 AND s.status = 'ACTIVE'
       ORDER BY s.id DESC LIMIT 1;`,
      [conductorId]
    );

    res.json({
      conductor: conductorRes.rows[0],
      activeShift: activeShiftRes.rows[0] || null,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// 2. METADATA: ROUTES & VEHICLES
// ---------------------------------------------------------------------------
apiRouter.get('/routes', async (req: Request, res: Response) => {
  try {
    const routes = await pg.query(`SELECT * FROM routes WHERE is_active = true ORDER BY code;`);
    res.json(routes.rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.get('/vehicles', async (req: Request, res: Response) => {
  try {
    const vehicles = await pg.query(`SELECT * FROM vehicles WHERE is_active = true ORDER BY reg_number;`);
    res.json(vehicles.rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// 3. SHIFT MANAGEMENT & RECONCILIATION
// ---------------------------------------------------------------------------
// Get active shift with live real-time counters and recent fares
apiRouter.get('/shifts/active', requireConductorAuth, async (req: AuthenticatedRequest, res: Response) => {
  const conductorId = req.conductor!.id;
  try {
    const shiftRes = await pg.query(
      `SELECT s.*, v.reg_number, v.fleet_name, v.capacity, v.sacco_name, 
              r.code as route_code, r.name as route_name, r.base_fare, r.peak_fare, r.off_peak_fare
       FROM shifts s
       JOIN vehicles v ON s.vehicle_id = v.id
       JOIN routes r ON s.route_id = r.id
       WHERE s.conductor_id = $1 AND s.status = 'ACTIVE'
       ORDER BY s.id DESC LIMIT 1;`,
      [conductorId]
    );

    if (shiftRes.rows.length === 0) {
      return res.json({ activeShift: null });
    }

    const activeShift = shiftRes.rows[0];

    // Fetch recent 20 fares for live feed
    const faresRes = await pg.query(
      `SELECT f.*, p.checkout_request_id, p.provider
       FROM fares f
       LEFT JOIN payments p ON p.fare_id = f.id
       WHERE f.shift_id = $1
       ORDER BY f.id DESC LIMIT 20;`,
      [activeShift.id]
    );

    // Compute live exact tallies from PostgreSQL
    const statsRes = await pg.query(
      `SELECT 
         COUNT(*) as total_fares,
         COUNT(CASE WHEN status = 'CONFIRMED' THEN 1 END) as confirmed_fares,
         COUNT(CASE WHEN status = 'PENDING' THEN 1 END) as pending_fares,
         COUNT(CASE WHEN status = 'FAILED' THEN 1 END) as failed_fares,
         COALESCE(SUM(CASE WHEN status = 'CONFIRMED' THEN amount ELSE 0 END), 0) as total_amount,
         COALESCE(SUM(CASE WHEN status = 'CONFIRMED' AND payment_method = 'CASH' THEN amount ELSE 0 END), 0) as cash_amount,
         COALESCE(SUM(CASE WHEN status = 'CONFIRMED' AND payment_method IN ('MPESA_STK', 'DYNAMIC_QR') THEN amount ELSE 0 END), 0) as digital_amount
       FROM fares 
       WHERE shift_id = $1;`,
      [activeShift.id]
    );

    const stats = statsRes.rows[0];

    res.json({
      activeShift,
      recentFares: faresRes.rows,
      liveTallies: {
        passengerCount: Number(stats.confirmed_fares),
        totalCollected: Number(stats.total_amount),
        cashTotal: Number(stats.cash_amount),
        digitalTotal: Number(stats.digital_amount),
        pendingCount: Number(stats.pending_fares),
        failedCount: Number(stats.failed_fares),
      }
    });
  } catch (err: any) {
    console.error('[Active Shift Error]', err);
    res.status(500).json({ error: err.message });
  }
});

// Start Shift
apiRouter.post('/shifts/start', requireConductorAuth, async (req: AuthenticatedRequest, res: Response) => {
  const conductorId = req.conductor!.id;
  const { vehicle_id, route_id, fare_mode = 'STANDARD', opening_cash = 0 } = req.body;

  if (!vehicle_id || !route_id) {
    return res.status(400).json({ error: 'Gari na Route zinahitajika (Vehicle & Route required).' });
  }

  try {
    // 1. Check if conductor already has an active shift
    const existing = await pg.query(
      `SELECT id FROM shifts WHERE conductor_id = $1 AND status = 'ACTIVE' LIMIT 1;`,
      [conductorId]
    );
    if (existing.rows.length > 0) {
      return res.status(400).json({ 
        error: 'Tayari una shift inayoendelea. Tafadhali maliza shift ya kwanza kabla ya kuanzisha nyingine.' 
      });
    }

    // 2. Fetch route base/peak fare
    const routeRes = await pg.query(`SELECT base_fare, peak_fare, off_peak_fare FROM routes WHERE id = $1;`, [route_id]);
    const route = routeRes.rows[0];
    let fareAmount = route ? route.base_fare : 100;
    if (fare_mode === 'PEAK' && route) fareAmount = route.peak_fare;
    if (fare_mode === 'OFF_PEAK' && route) fareAmount = route.off_peak_fare;

    // 3. Create Shift
    const insertRes = await pg.query(
      `INSERT INTO shifts (
         conductor_id, vehicle_id, route_id, fare_mode, current_fare_amount,
         opening_cash, status, start_time
       ) VALUES ($1, $2, $3, $4, $5, $6, 'ACTIVE', CURRENT_TIMESTAMP)
       RETURNING *;`,
      [conductorId, vehicle_id, route_id, fare_mode, fareAmount, opening_cash]
    );

    const newShift = insertRes.rows[0];

    res.json({
      success: true,
      message: 'Shift imeanza rasmi! Good luck barabarani.',
      shift: newShift,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Switch active shift fare mode (PEAK / OFF_PEAK / STANDARD)
apiRouter.post('/shifts/fare-mode', requireConductorAuth, async (req: AuthenticatedRequest, res: Response) => {
  const { shift_id, fare_mode, custom_fare } = req.body;
  try {
    const shiftRes = await pg.query(
      `SELECT s.*, r.base_fare, r.peak_fare, r.off_peak_fare 
       FROM shifts s 
       JOIN routes r ON s.route_id = r.id 
       WHERE s.id = $1;`,
      [shift_id]
    );
    if (shiftRes.rows.length === 0) {
      return res.status(404).json({ error: 'Shift not found' });
    }

    const shift = shiftRes.rows[0];
    let newAmount = custom_fare;
    if (!newAmount) {
      if (fare_mode === 'PEAK') newAmount = shift.peak_fare;
      else if (fare_mode === 'OFF_PEAK') newAmount = shift.off_peak_fare;
      else newAmount = shift.base_fare;
    }

    await pg.query(
      `UPDATE shifts SET fare_mode = $1, current_fare_amount = $2 WHERE id = $3;`,
      [fare_mode, newAmount, shift_id]
    );

    res.json({ success: true, fare_mode, current_fare_amount: newAmount });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// End Shift and Reconcile
apiRouter.post('/shifts/end', requireConductorAuth, async (req: AuthenticatedRequest, res: Response) => {
  const conductorId = req.conductor!.id;
  const { shift_id, closing_cash = 0, notes = '' } = req.body;

  try {
    // 1. Fetch shift
    const shiftRes = await pg.query(
      `SELECT s.*, v.reg_number, v.fleet_name, v.sacco_name, r.code as route_code, r.name as route_name
       FROM shifts s
       JOIN vehicles v ON s.vehicle_id = v.id
       JOIN routes r ON s.route_id = r.id
       WHERE s.id = $1 AND s.conductor_id = $2;`,
      [shift_id, conductorId]
    );

    if (shiftRes.rows.length === 0) {
      return res.status(404).json({ error: 'Shift not found or unauthorized' });
    }

    // 2. Perform reconciliation calculations from PostgreSQL ledger
    const statsRes = await pg.query(
      `SELECT 
         COUNT(*) as total_attempts,
         COUNT(CASE WHEN status = 'CONFIRMED' THEN 1 END) as confirmed_pax,
         COUNT(CASE WHEN status = 'FAILED' THEN 1 END) as failed_tx,
         COALESCE(SUM(CASE WHEN status = 'CONFIRMED' THEN amount ELSE 0 END), 0) as grand_total,
         COALESCE(SUM(CASE WHEN status = 'CONFIRMED' AND payment_method = 'CASH' THEN amount ELSE 0 END), 0) as cash_total,
         COALESCE(SUM(CASE WHEN status = 'CONFIRMED' AND payment_method IN ('MPESA_STK', 'DYNAMIC_QR') THEN amount ELSE 0 END), 0) as digital_total
       FROM fares 
       WHERE shift_id = $1;`,
      [shift_id]
    );

    const stats = statsRes.rows[0];
    const totalCollected = Number(stats.grand_total);
    const cashTotal = Number(stats.cash_total);
    const digitalTotal = Number(stats.digital_total);
    const paxCount = Number(stats.confirmed_pax);

    // 3. Update shift to COMPLETED
    await pg.query(
      `UPDATE shifts SET 
         status = 'COMPLETED',
         end_time = CURRENT_TIMESTAMP,
         closing_cash = $1,
         total_collected = $2,
         cash_total = $3,
         digital_total = $4,
         passenger_count = $5,
         notes = $6
       WHERE id = $7;`,
      [closing_cash, totalCollected, cashTotal, digitalTotal, paxCount, notes, shift_id]
    );

    // 4. Return full shift reconciliation breakdown
    res.json({
      success: true,
      message: 'Shift imefungwa kikamilifu. Reconciled successfully.',
      reconciliation: {
        shiftId: shift_id,
        vehicleReg: shiftRes.rows[0].reg_number,
        fleetName: shiftRes.rows[0].fleet_name,
        saccoName: shiftRes.rows[0].sacco_name,
        routeName: `${shiftRes.rows[0].route_code}: ${shiftRes.rows[0].route_name}`,
        conductorName: req.conductor!.name,
        conductorPhone: req.conductor!.phone_number,
        startTime: shiftRes.rows[0].start_time,
        endTime: new Date().toISOString(),
        passengerCount: paxCount,
        totalCollected,
        cashTotal,
        digitalTotal,
        openingCash: shiftRes.rows[0].opening_cash,
        closingCash: closing_cash,
        failedTransactions: Number(stats.failed_tx),
        notes,
      }
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Shift Summary for handover / printing / sharing
apiRouter.get('/shifts/:id/summary', async (req: Request, res: Response) => {
  const shiftId = req.params.id;
  try {
    const shiftRes = await pg.query(
      `SELECT s.*, v.reg_number, v.fleet_name, v.sacco_name, 
              r.code as route_code, r.name as route_name,
              c.name as conductor_name, c.phone_number as conductor_phone
       FROM shifts s
       JOIN vehicles v ON s.vehicle_id = v.id
       JOIN routes r ON s.route_id = r.id
       JOIN conductors c ON s.conductor_id = c.id
       WHERE s.id = $1;`,
      [shiftId]
    );

    if (shiftRes.rows.length === 0) {
      return res.status(404).json({ error: 'Shift not found' });
    }

    const shift = shiftRes.rows[0];

    // Fares breakdown
    const faresRes = await pg.query(
      `SELECT f.*, p.mpesa_receipt_number, p.checkout_request_id
       FROM fares f
       LEFT JOIN payments p ON p.fare_id = f.id
       WHERE f.shift_id = $1
       ORDER BY f.id ASC;`,
      [shiftId]
    );

    res.json({
      shift,
      fares: faresRes.rows,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// 4. FARE CHARGING (Cash, M-Pesa STK Push, Dynamic QR)
// ---------------------------------------------------------------------------
apiRouter.post('/fares/charge', requireConductorAuth, async (req: AuthenticatedRequest, res: Response) => {
  const conductorId = req.conductor!.id;
  const { 
    shift_id, 
    amount, 
    fare_type = 'STANDARD', 
    payment_method, // 'CASH', 'MPESA_STK', 'DYNAMIC_QR'
    passenger_phone, 
    idempotency_key,
    stage_name = 'Stage Stop'
  } = req.body;

  if (!shift_id || !amount || !payment_method || !idempotency_key) {
    return res.status(400).json({ 
      error: 'Maelezo hayajakamilika (Shift, Amount, Payment Method, and Idempotency Key required).' 
    });
  }

  try {
    // 1. Idempotency Check: Prevent double charging if conductor double-tapped!
    const existingFare = await pg.query(
      `SELECT f.*, p.checkout_request_id, p.status as payment_status 
       FROM fares f 
       LEFT JOIN payments p ON p.fare_id = f.id 
       WHERE f.idempotency_key = $1;`,
      [idempotency_key]
    );

    if (existingFare.rows.length > 0) {
      console.log(`[Idempotency] Duplicate request prevented for key: ${idempotency_key}`);
      return res.json({
        idempotent_replay: true,
        fare: existingFare.rows[0],
        message: 'Transaction already recorded (Idempotency protection).'
      });
    }

    // 2. Validate shift is ACTIVE
    const shiftRes = await pg.query(
      `SELECT s.*, v.reg_number, r.code as route_code FROM shifts s
       JOIN vehicles v ON s.vehicle_id = v.id
       JOIN routes r ON s.route_id = r.id
       WHERE s.id = $1 AND s.status = 'ACTIVE';`,
      [shift_id]
    );

    if (shiftRes.rows.length === 0) {
      return res.status(400).json({ error: 'Shift hii haiko active (Shift is not active).' });
    }

    const shift = shiftRes.rows[0];

    // =========================================================
    // CASE A: CASH PAYMENT (Instant 1-Tap)
    // =========================================================
    if (payment_method === 'CASH') {
      // Execute atomic transaction for Fare + Payment + Shift update
      let createdFare: any;
      await pg.transaction(async (tx) => {
        const fareRes = await tx.query(
          `INSERT INTO fares (
             shift_id, conductor_id, vehicle_id, route_id, amount,
             fare_type, stage_name, payment_method, status, idempotency_key
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'CASH', 'CONFIRMED', $8)
           RETURNING *;`,
          [shift_id, conductorId, shift.vehicle_id, shift.route_id, amount, fare_type, stage_name, idempotency_key]
        );
        createdFare = fareRes.rows[0];

        // Insert payment log
        await tx.query(
          `INSERT INTO payments (
             fare_id, shift_id, amount, method, status, provider
           ) VALUES ($1, $2, $3, 'CASH', 'SUCCESS', 'CASH');`,
          [createdFare.id, shift_id, amount]
        );

        // Increment shift running tallies
        await tx.query(
          `UPDATE shifts SET 
             total_collected = total_collected + $1,
             cash_total = cash_total + $1,
             passenger_count = passenger_count + 1
           WHERE id = $2;`,
          [amount, shift_id]
        );
      });

      return res.json({
        success: true,
        fare: createdFare,
        message: `Pesa mkononi KSh ${amount} imerekodiwa!`,
      });
    }

    // =========================================================
    // CASE B: M-PESA STK PUSH (Daraja API)
    // =========================================================
    if (payment_method === 'MPESA_STK') {
      if (!passenger_phone) {
        return res.status(400).json({ error: 'Weka nambari ya simu ya abiria (Passenger phone required).' });
      }

      const formattedPhone = formatKenyanPhone(passenger_phone);

      // 1. Create Pending Fare record
      const fareRes = await pg.query(
        `INSERT INTO fares (
           shift_id, conductor_id, vehicle_id, route_id, amount,
           fare_type, stage_name, payment_method, status, idempotency_key, passenger_phone
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'MPESA_STK', 'PENDING', $8, $9)
         RETURNING *;`,
        [shift_id, conductorId, shift.vehicle_id, shift.route_id, amount, fare_type, stage_name, idempotency_key, formattedPhone]
      );
      const fare = fareRes.rows[0];

      // 2. Call Daraja API
      const stkResult = await initiateSTKPush({
        phone: formattedPhone,
        amount,
        accountReference: `${shift.route_code}-${shift.reg_number.replace(/\s+/g, '')}`,
        transactionDesc: `Fare ${amount}`,
        callbackUrl: `${process.env.APP_URL || ''}/api/mpesa/callback`,
      });

      // 3. Record Payment attempt with CheckoutRequestID
      const paymentRes = await pg.query(
        `INSERT INTO payments (
           fare_id, shift_id, amount, method, status, provider,
           checkout_request_id, merchant_request_id, phone_number
         ) VALUES ($1, $2, $3, 'MPESA_STK', 'INITIATED', 'DARAJA_MPESA', $4, $5, $6)
         RETURNING *;`,
        [fare.id, shift_id, amount, stkResult.CheckoutRequestID, stkResult.MerchantRequestID, formattedPhone]
      );

      // In simulated mode, schedule an automatic confirmation after 2.5 seconds
      // so the conductor sees the realistic "Confirmed" state seamlessly!
      if (stkResult.isSimulated) {
        setTimeout(async () => {
          try {
            await simulateMpesaSuccess(stkResult.CheckoutRequestID, amount, formattedPhone);
          } catch (simErr) {
            console.error('[Simulated Auto-Callback Error]', simErr);
          }
        }, 2600);
      }

      return res.json({
        success: true,
        fare,
        payment: paymentRes.rows[0],
        checkout_request_id: stkResult.CheckoutRequestID,
        customer_message: stkResult.CustomerMessage,
        is_simulated: stkResult.isSimulated,
      });
    }

    // =========================================================
    // CASE C: DYNAMIC QR SCAN-TO-PAY
    // =========================================================
    if (payment_method === 'DYNAMIC_QR') {
      const fareRef = `FF-${shift.route_code}-${Date.now().toString().slice(-4)}`;
      
      const fareRes = await pg.query(
        `INSERT INTO fares (
           shift_id, conductor_id, vehicle_id, route_id, amount,
           fare_type, stage_name, payment_method, status, idempotency_key
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'DYNAMIC_QR', 'PENDING', $8)
         RETURNING *;`,
        [shift_id, conductorId, shift.vehicle_id, shift.route_id, amount, fare_type, stage_name, idempotency_key]
      );
      const fare = fareRes.rows[0];

      // Generate dynamic QR Code string with M-Pesa Till / Paybill deep-link instructions
      const qrData = JSON.stringify({
        system: 'FareFlow',
        sacco: shift.sacco_name || 'Matatu SACCO',
        vehicle: shift.reg_number,
        route: shift.route_code,
        fareId: fare.id,
        amount,
        accountRef: fareRef,
        tillNumber: '889900', // Demo SACCO Till / Paybill
        paybill: '174379',
      });

      const qrCodeDataUrl = await QRCode.toDataURL(qrData, {
        errorCorrectionLevel: 'M',
        margin: 2,
        color: {
          dark: '#000000',
          light: '#ffffff',
        },
      });

      const checkoutId = `QR_${fareRef}_${fare.id}`;
      await pg.query(
        `INSERT INTO payments (
           fare_id, shift_id, amount, method, status, provider, checkout_request_id
         ) VALUES ($1, $2, $3, 'DYNAMIC_QR', 'INITIATED', 'QR_C2B', $4);`,
        [fare.id, shift_id, amount, checkoutId]
      );

      return res.json({
        success: true,
        fare,
        qr_code_data_url: qrCodeDataUrl,
        reference: fareRef,
        checkout_request_id: checkoutId,
        till_number: '889900',
        message: 'Scan na M-Pesa to pay KSh ' + amount,
      });
    }

    res.status(400).json({ error: 'Njia ya malipo haitambuliki (Invalid payment method).' });
  } catch (err: any) {
    console.error('[Charge Fare Error]', err);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// 5. M-PESA DARAJA WEBHOOK CALLBACK & STATUS POLLING
// ---------------------------------------------------------------------------

// Helper to simulate successful M-Pesa callback in database
async function simulateMpesaSuccess(checkoutRequestId: string, amount: number, phone: string) {
  const receipt = generateMpesaReceiptNumber();
  
  await pg.transaction(async (tx) => {
    // 1. Find payment
    const pRes = await tx.query(
      `SELECT * FROM payments WHERE checkout_request_id = $1;`,
      [checkoutRequestId]
    );
    if (pRes.rows.length === 0) return;
    const payment = pRes.rows[0];

    if (payment.status === 'SUCCESS') return; // Already processed

    // 2. Update payment
    await tx.query(
      `UPDATE payments SET 
         status = 'SUCCESS',
         mpesa_receipt_number = $1,
         updated_at = CURRENT_TIMESTAMP
       WHERE id = $2;`,
      [receipt, payment.id]
    );

    // 3. Update fare
    await tx.query(
      `UPDATE fares SET 
         status = 'CONFIRMED',
         mpesa_receipt_number = $1,
         updated_at = CURRENT_TIMESTAMP
       WHERE id = $2;`,
      [receipt, payment.fare_id]
    );

    // 4. Update shift tallies
    await tx.query(
      `UPDATE shifts SET 
         total_collected = total_collected + $1,
         digital_total = digital_total + $1,
         passenger_count = passenger_count + 1
       WHERE id = $2;`,
      [amount, payment.shift_id]
    );
  });

  console.log(`[Daraja Callback Simulated] Confirmed Checkout: ${checkoutRequestId} Receipt: ${receipt}`);
}

// Safaricom Daraja STK Push Callback Webhook
apiRouter.post('/mpesa/callback', async (req: Request, res: Response) => {
  try {
    const callbackData = req.body;
    console.log('[Daraja Callback Received]', JSON.stringify(callbackData, null, 2));

    const stkCallback = callbackData?.Body?.stkCallback;
    if (!stkCallback) {
      return res.status(400).json({ error: 'Invalid callback format' });
    }

    const { MerchantRequestID, CheckoutRequestID, ResultCode, ResultDesc, CallbackMetadata } = stkCallback;

    // Look up matching payment
    const paymentRes = await pg.query(
      `SELECT * FROM payments WHERE checkout_request_id = $1 LIMIT 1;`,
      [CheckoutRequestID]
    );

    if (paymentRes.rows.length === 0) {
      console.warn(`[Daraja Callback] No matching payment found for CheckoutRequestID: ${CheckoutRequestID}`);
      return res.json({ ResultCode: 0, ResultDesc: 'Accepted but not matched' });
    }

    const payment = paymentRes.rows[0];

    // Already processed idempotently
    if (payment.status === 'SUCCESS') {
      return res.json({ ResultCode: 0, ResultDesc: 'Already processed' });
    }

    if (ResultCode === 0) {
      // Success! Extract metadata
      let mpesaReceipt = generateMpesaReceiptNumber();
      let amountPaid = payment.amount;
      let phone = payment.phone_number;

      if (CallbackMetadata && CallbackMetadata.Item) {
        for (const item of CallbackMetadata.Item) {
          if (item.Name === 'MpesaReceiptNumber') mpesaReceipt = item.Value;
          if (item.Name === 'Amount') amountPaid = Number(item.Value);
          if (item.Name === 'PhoneNumber') phone = String(item.Value);
        }
      }

      await pg.transaction(async (tx) => {
        await tx.query(
          `UPDATE payments SET 
             status = 'SUCCESS',
             mpesa_receipt_number = $1,
             raw_callback = $2,
             updated_at = CURRENT_TIMESTAMP
           WHERE id = $3;`,
          [mpesaReceipt, JSON.stringify(callbackData), payment.id]
        );

        await tx.query(
          `UPDATE fares SET 
             status = 'CONFIRMED',
             mpesa_receipt_number = $1,
             updated_at = CURRENT_TIMESTAMP
           WHERE id = $2;`,
          [mpesaReceipt, payment.fare_id]
        );

        await tx.query(
          `UPDATE shifts SET 
             total_collected = total_collected + $1,
             digital_total = digital_total + $1,
             passenger_count = passenger_count + 1
           WHERE id = $2;`,
          [amountPaid, payment.shift_id]
        );
      });

      console.log(`[Daraja Callback SUCCESS] Fare ID ${payment.fare_id} confirmed with receipt: ${mpesaReceipt}`);
    } else {
      // Failed / Cancelled (e.g. 1032 user cancelled, 1 insufficient balance)
      let failureReason = ResultDesc || 'M-Pesa transaction cancelled or failed';
      if (ResultCode === 1032) {
        failureReason = 'Abiria amekataa / ame-cancel M-Pesa prompt (Cancelled by passenger).';
      } else if (ResultCode === 1) {
        failureReason = 'Salio haitoshi kwa M-Pesa (Insufficient M-Pesa balance).';
      }

      await pg.transaction(async (tx) => {
        await tx.query(
          `UPDATE payments SET 
             status = 'FAILED',
             failure_reason = $1,
             raw_callback = $2,
             updated_at = CURRENT_TIMESTAMP
           WHERE id = $3;`,
          [failureReason, JSON.stringify(callbackData), payment.id]
        );

        await tx.query(
          `UPDATE fares SET 
             status = 'FAILED',
             failure_reason = $1,
             updated_at = CURRENT_TIMESTAMP
           WHERE id = $2;`,
          [failureReason, payment.fare_id]
        );
      });

      console.log(`[Daraja Callback FAILED] Fare ID ${payment.fare_id} failed: ${failureReason}`);
    }

    res.json({ ResultCode: 0, ResultDesc: 'Callback processed successfully' });
  } catch (err: any) {
    console.error('[Daraja Callback Error]', err);
    res.status(500).json({ error: err.message });
  }
});

// Polling fallback endpoint for the conductor view (near-instant state sync)
apiRouter.get('/mpesa/status/:checkoutRequestId', async (req: Request, res: Response) => {
  const { checkoutRequestId } = req.params;
  try {
    const paymentRes = await pg.query(
      `SELECT p.*, f.status as fare_status, f.amount as fare_amount, f.payment_method, f.idempotency_key
       FROM payments p
       JOIN fares f ON p.fare_id = f.id
       WHERE p.checkout_request_id = $1 LIMIT 1;`,
      [checkoutRequestId]
    );

    if (paymentRes.rows.length === 0) {
      return res.status(404).json({ status: 'NOT_FOUND' });
    }

    const payment = paymentRes.rows[0];
    res.json({
      checkout_request_id: checkoutRequestId,
      payment_status: payment.status, // 'INITIATED', 'SUCCESS', 'FAILED'
      fare_status: payment.fare_status, // 'PENDING', 'CONFIRMED', 'FAILED'
      mpesa_receipt_number: payment.mpesa_receipt_number,
      failure_reason: payment.failure_reason,
      fare_id: payment.fare_id,
      amount: payment.fare_amount,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Manual Simulator Trigger for evaluation / testing
apiRouter.post('/mpesa/simulate-callback', async (req: Request, res: Response) => {
  const { checkout_request_id, result_code = 0, custom_receipt } = req.body;
  if (!checkout_request_id) {
    return res.status(400).json({ error: 'checkout_request_id is required' });
  }

  try {
    const paymentRes = await pg.query(
      `SELECT * FROM payments WHERE checkout_request_id = $1 LIMIT 1;`,
      [checkout_request_id]
    );

    if (paymentRes.rows.length === 0) {
      return res.status(404).json({ error: 'Payment not found' });
    }

    const payment = paymentRes.rows[0];
    if (result_code === 0) {
      const receipt = custom_receipt || generateMpesaReceiptNumber();
      await simulateMpesaSuccess(checkout_request_id, payment.amount, payment.phone_number || '254712345678');
      return res.json({ success: true, status: 'CONFIRMED', receipt });
    } else {
      const reason = result_code === 1032 
        ? 'Abiria ame-cancel prompt kwa simu yake (Passenger cancelled)'
        : 'Network timeout au salio haitoshi (Failed/Timeout)';

      await pg.query(
        `UPDATE payments SET status = 'FAILED', failure_reason = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2;`,
        [reason, payment.id]
      );
      await pg.query(
        `UPDATE fares SET status = 'FAILED', failure_reason = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2;`,
        [reason, payment.fare_id]
      );
      return res.json({ success: true, status: 'FAILED', reason });
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// View & toggle Daraja Configuration
apiRouter.get('/mpesa/config', (req: Request, res: Response) => {
  res.json({
    environment: darajaConfig.environment,
    businessShortCode: darajaConfig.businessShortCode,
    isSimulated: darajaConfig.isSimulated,
    hasLiveKeys: Boolean(darajaConfig.consumerKey && darajaConfig.consumerSecret),
  });
});

apiRouter.post('/mpesa/config', (req: Request, res: Response) => {
  const { isSimulated, consumerKey, consumerSecret, businessShortCode, passkey, environment } = req.body;
  const updated = updateDarajaConfig({
    ...(typeof isSimulated === 'boolean' ? { isSimulated } : {}),
    ...(consumerKey !== undefined ? { consumerKey } : {}),
    ...(consumerSecret !== undefined ? { consumerSecret } : {}),
    ...(businessShortCode !== undefined ? { businessShortCode } : {}),
    ...(passkey !== undefined ? { passkey } : {}),
    ...(environment !== undefined ? { environment } : {}),
  });
  res.json({ success: true, config: updated });
});

// ---------------------------------------------------------------------------
// 6. OFFLINE SYNC ENDPOINT (IndexedDB Queue Reconciler)
// ---------------------------------------------------------------------------
apiRouter.post('/sync', requireConductorAuth, async (req: AuthenticatedRequest, res: Response) => {
  const conductorId = req.conductor!.id;
  const { transactions } = req.body; // Array of offline queued items

  if (!Array.isArray(transactions) || transactions.length === 0) {
    return res.json({ success: true, synced_count: 0, message: 'No items to sync.' });
  }

  console.log(`[Sync Engine] Received ${transactions.length} offline transactions from Conductor ${conductorId}`);

  let processedCount = 0;
  let duplicateCount = 0;
  const processedIds: string[] = [];

  for (const item of transactions) {
    const { 
      client_tx_id, 
      shift_id, 
      amount, 
      payment_method, 
      fare_type = 'STANDARD',
      stage_name = 'Offline Stage',
      passenger_phone,
      created_at 
    } = item;

    if (!client_tx_id) continue;

    try {
      // 1. Check if client_tx_id is already in sync_queue or fares
      const existingQueue = await pg.query(
        `SELECT * FROM sync_queue WHERE client_tx_id = $1;`,
        [client_tx_id]
      );

      if (existingQueue.rows.length > 0) {
        duplicateCount++;
        processedIds.push(client_tx_id);
        continue;
      }

      // 2. Fetch shift details to ensure relational consistency
      const shiftRes = await pg.query(
        `SELECT * FROM shifts WHERE id = $1;`,
        [shift_id]
      );

      if (shiftRes.rows.length === 0) {
        // Shift not found, record conflict
        await pg.query(
          `INSERT INTO sync_queue (client_tx_id, conductor_id, payload, sync_status, error_message)
           VALUES ($1, $2, $3, 'CONFLICT', 'Shift ID does not exist on server.');`,
          [client_tx_id, conductorId, JSON.stringify(item)]
        );
        continue;
      }

      const shift = shiftRes.rows[0];

      // 3. Atomically record fare and payment
      await pg.transaction(async (tx) => {
        // Record in sync queue as PROCESSED
        await tx.query(
          `INSERT INTO sync_queue (client_tx_id, shift_id, conductor_id, payload, sync_status, processed_at)
           VALUES ($1, $2, $3, $4, 'PROCESSED', CURRENT_TIMESTAMP);`,
          [client_tx_id, shift_id, conductorId, JSON.stringify(item)]
        );

        // Insert fare with idempotency key
        const fareRes = await tx.query(
          `INSERT INTO fares (
             shift_id, conductor_id, vehicle_id, route_id, amount,
             fare_type, stage_name, payment_method, status, idempotency_key,
             passenger_phone, is_offline_synced, created_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'CONFIRMED', $9, $10, true, $11)
           RETURNING id;`,
          [
            shift_id, conductorId, shift.vehicle_id, shift.route_id, amount,
            fare_type, stage_name, payment_method, client_tx_id, passenger_phone || null,
            created_at || new Date().toISOString()
          ]
        );
        const fareId = fareRes.rows[0].id;

        // Insert payment record
        await tx.query(
          `INSERT INTO payments (
             fare_id, shift_id, amount, method, status, provider
           ) VALUES ($1, $2, $3, $4, 'SUCCESS', $5);`,
          [fareId, shift_id, amount, payment_method, payment_method === 'CASH' ? 'CASH' : 'OFFLINE_SYNC']
        );

        // Update shift tallies
        const isCash = payment_method === 'CASH';
        await tx.query(
          `UPDATE shifts SET 
             total_collected = total_collected + $1,
             cash_total = cash_total + $2,
             digital_total = digital_total + $3,
             passenger_count = passenger_count + 1
           WHERE id = $4;`,
          [amount, isCash ? amount : 0, isCash ? 0 : amount, shift_id]
        );
      });

      processedCount++;
      processedIds.push(client_tx_id);
    } catch (txErr: any) {
      console.error(`[Sync Error for tx ${client_tx_id}]`, txErr);
    }
  }

  res.json({
    success: true,
    synced_count: processedCount,
    duplicate_count: duplicateCount,
    processed_ids: processedIds,
    message: `Synced ${processedCount} offline transactions successfully (${duplicateCount} already reconciled).`
  });
});

// ---------------------------------------------------------------------------
// 6.5 DARAJA CONFIGURATION & CREDENTIALS
// ---------------------------------------------------------------------------
apiRouter.get('/daraja/config', (req: Request, res: Response) => {
  res.json({
    simulated: darajaConfig.isSimulated,
    consumerKey: darajaConfig.consumerKey ? darajaConfig.consumerKey.substring(0, 4) + '••••' : '',
    consumerSecret: darajaConfig.consumerSecret ? '••••••••••••' : '',
    passkey: darajaConfig.passkey ? '••••••••••••' : '',
    shortcode: darajaConfig.businessShortCode || '174379',
    callbackUrl: darajaConfig.callbackUrl || '',
  });
});

apiRouter.post('/daraja/config', (req: Request, res: Response) => {
  const { simulated, consumerKey, consumerSecret, passkey, shortcode, callbackUrl } = req.body;
  const updates: any = {};
  if (typeof simulated === 'boolean') updates.isSimulated = simulated;
  if (consumerKey && !consumerKey.includes('••••')) updates.consumerKey = consumerKey.trim();
  if (consumerSecret && !consumerSecret.includes('••••')) updates.consumerSecret = consumerSecret.trim();
  if (passkey && !passkey.includes('••••')) updates.passkey = passkey.trim();
  if (shortcode) updates.businessShortCode = shortcode.toString().trim();
  if (callbackUrl) updates.callbackUrl = callbackUrl.trim();

  updateDarajaConfig(updates);
  res.json({
    success: true,
    message: 'Daraja configuration updated and active!',
    config: {
      simulated: darajaConfig.isSimulated,
      shortcode: darajaConfig.businessShortCode,
      hasKey: !!darajaConfig.consumerKey,
    }
  });
});

// ---------------------------------------------------------------------------
// 7. ADMIN / SACCO OWNER VIEW (Scaffolded Analytics)
// ---------------------------------------------------------------------------
apiRouter.get('/admin/overview', async (req: Request, res: Response) => {
  try {
    // 1. Grand totals across fleet today
    const totalsRes = await pg.query(`
      SELECT 
        COUNT(DISTINCT s.id) as total_shifts_today,
        COUNT(DISTINCT s.vehicle_id) as active_vehicles_today,
        COUNT(DISTINCT s.conductor_id) as active_conductors_today,
        COALESCE(SUM(s.total_collected), 0) as grand_revenue,
        COALESCE(SUM(s.cash_total), 0) as total_cash,
        COALESCE(SUM(s.digital_total), 0) as total_digital,
        COALESCE(SUM(s.passenger_count), 0) as total_passengers
      FROM shifts s
      WHERE s.start_time >= CURRENT_DATE;
    `);

    // 2. Per-vehicle performance breakdown
    const vehicleBreakdown = await pg.query(`
      SELECT 
        v.id, v.reg_number, v.fleet_name, v.sacco_name, v.capacity,
        COUNT(DISTINCT s.id) as shifts_count,
        COALESCE(SUM(s.total_collected), 0) as total_takings,
        COALESCE(SUM(s.cash_total), 0) as cash_takings,
        COALESCE(SUM(s.digital_total), 0) as digital_takings,
        COALESCE(SUM(s.passenger_count), 0) as total_pax,
        MAX(s.status) as current_status
      FROM vehicles v
      LEFT JOIN shifts s ON s.vehicle_id = v.id AND s.start_time >= CURRENT_DATE
      GROUP BY v.id, v.reg_number, v.fleet_name, v.sacco_name, v.capacity
      ORDER BY total_takings DESC;
    `);

    // 3. Per-conductor performance
    const conductorBreakdown = await pg.query(`
      SELECT 
        c.id, c.name, c.phone_number, c.sacco,
        COUNT(DISTINCT s.id) as shifts_worked,
        COALESCE(SUM(s.total_collected), 0) as total_collected,
        COALESCE(SUM(s.digital_total), 0) as digital_collected,
        COALESCE(SUM(s.cash_total), 0) as cash_collected,
        COALESCE(SUM(s.passenger_count), 0) as passengers_handled
      FROM conductors c
      LEFT JOIN shifts s ON s.conductor_id = c.id AND s.start_time >= CURRENT_DATE
      GROUP BY c.id, c.name, c.phone_number, c.sacco
      ORDER BY total_collected DESC;
    `);

    // 4. Recent M-Pesa Transactions for Audit
    const auditFares = await pg.query(`
      SELECT 
        f.id, f.amount, f.payment_method, f.status, f.mpesa_receipt_number,
        f.passenger_phone, f.created_at, f.stage_name,
        v.reg_number as vehicle, r.code as route_code, c.name as conductor
      FROM fares f
      JOIN vehicles v ON f.vehicle_id = v.id
      JOIN routes r ON f.route_id = r.id
      JOIN conductors c ON f.conductor_id = c.id
      ORDER BY f.id DESC LIMIT 25;
    `);

    res.json({
      totals: totalsRes.rows[0],
      vehicleBreakdown: vehicleBreakdown.rows,
      conductorBreakdown: conductorBreakdown.rows,
      recentAudit: auditFares.rows,
    });
  } catch (err: any) {
    console.error('[Admin Overview Error]', err);
    res.status(500).json({ error: err.message });
  }
});
