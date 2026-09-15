export type Language = 'sw' | 'en';
export type FareMode = 'STANDARD' | 'PEAK' | 'OFF_PEAK';
export type PaymentMethod = 'MPESA_STK' | 'CASH' | 'DYNAMIC_QR';
export type FareStatus = 'PENDING' | 'CONFIRMED' | 'FAILED' | 'DISPUTED';

export interface Conductor {
  id: number;
  name: string;
  phone_number: string;
  sacco: string;
  national_id?: string;
  is_active?: boolean;
}

export interface Vehicle {
  id: number;
  reg_number: string;
  fleet_name: string;
  sacco_name: string;
  capacity: number;
}

export interface Route {
  id: number;
  code: string;
  name: string;
  base_fare: number;
  peak_fare: number;
  off_peak_fare: number;
}

export interface Shift {
  id: number;
  conductor_id: number;
  vehicle_id: number;
  route_id: number;
  fare_mode: FareMode;
  current_fare_amount: number;
  status: 'ACTIVE' | 'COMPLETED';
  start_time: string;
  end_time?: string;
  opening_cash: number;
  closing_cash?: number;
  total_collected: number;
  cash_total: number;
  digital_total: number;
  passenger_count: number;
  notes?: string;
  reg_number?: string;
  fleet_name?: string;
  sacco_name?: string;
  route_code?: string;
  route_name?: string;
}

export interface Fare {
  id: number;
  shift_id: number;
  conductor_id: number;
  vehicle_id: number;
  route_id: number;
  amount: number;
  fare_type: 'STANDARD' | 'STUDENT' | 'SHORT_STAGE' | 'CUSTOM';
  stage_name: string;
  payment_method: PaymentMethod;
  status: FareStatus;
  idempotency_key: string;
  passenger_phone?: string;
  mpesa_receipt_number?: string;
  failure_reason?: string;
  is_offline_synced?: boolean;
  checkout_request_id?: string;
  created_at: string;
}

export interface LiveTallies {
  passengerCount: number;
  totalCollected: number;
  cashTotal: number;
  digitalTotal: number;
  pendingCount: number;
  failedCount: number;
}

export interface OfflineQueuedFare {
  client_tx_id: string;
  shift_id: number;
  amount: number;
  payment_method: PaymentMethod;
  fare_type: 'STANDARD' | 'STUDENT' | 'SHORT_STAGE' | 'CUSTOM';
  stage_name: string;
  passenger_phone?: string;
  created_at: string;
}

export interface ShiftReconciliation {
  shiftId: number;
  vehicleReg: string;
  fleetName: string;
  saccoName: string;
  routeName: string;
  conductorName: string;
  conductorPhone: string;
  startTime: string;
  endTime: string;
  passengerCount: number;
  totalCollected: number;
  cashTotal: number;
  digitalTotal: number;
  openingCash: number;
  closingCash: number;
  failedTransactions: number;
  notes: string;
}
