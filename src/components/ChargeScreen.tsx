import React, { useState, useEffect, useRef } from 'react';
import { 
  DollarSign, 
  Smartphone, 
  QrCode, 
  Banknote, 
  CheckCircle2, 
  Clock, 
  AlertCircle, 
  RefreshCw, 
  Plus, 
  Minus, 
  Flame, 
  Sun, 
  TrendingUp, 
  Users, 
  Check, 
  X, 
  Send, 
  ArrowUpRight,
  ShieldCheck,
  ChevronDown,
  RotateCcw
} from 'lucide-react';
import { Shift, Fare, LiveTallies, PaymentMethod, FareMode, Language } from '../types';
import { getTranslation } from '../lib/translations';
import { soundFx } from '../lib/audio';
import { queueOfflineFare } from '../lib/offlineQueue';

interface ChargeScreenProps {
  shift: Shift;
  token: string;
  lang: Language;
  isOnline: boolean;
  onRefreshShift: () => void;
  onOpenEndShift: () => void;
  onOfflineFareQueued: () => void;
}

export const ChargeScreen: React.FC<ChargeScreenProps> = ({
  shift,
  token,
  lang,
  isOnline,
  onRefreshShift,
  onOpenEndShift,
  onOfflineFareQueued,
}) => {
  const t = getTranslation(lang);

  // Active Fare State
  const [currentFare, setCurrentFare] = useState<number>(shift.current_fare_amount || 100);
  const [fareMode, setFareMode] = useState<FareMode>(shift.fare_mode || 'STANDARD');
  const [stageName, setStageName] = useState<string>('Standard Stage');

  // Running Tallies (Optimistic + Polled)
  const [tallies, setTallies] = useState<LiveTallies>({
    passengerCount: shift.passenger_count || 0,
    totalCollected: shift.total_collected || 0,
    cashTotal: shift.cash_total || 0,
    digitalTotal: shift.digital_total || 0,
    pendingCount: 0,
    failedCount: 0,
  });

  // Recent Activity Feed
  const [recentFares, setRecentFares] = useState<Fare[]>([]);

  // Charge Modal & Method Selection
  const [isChargingOpen, setIsChargingOpen] = useState(false);
  const [selectedMethod, setSelectedMethod] = useState<PaymentMethod>('MPESA_STK');
  const [passengerPhone, setPassengerPhone] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Active Transaction State (STK Push polling / QR display)
  const [activeTx, setActiveTx] = useState<{
    fareId?: number;
    checkoutRequestId?: string;
    status: 'IDLE' | 'PENDING' | 'CONFIRMED' | 'FAILED';
    method: PaymentMethod;
    amount: number;
    phone?: string;
    receipt?: string;
    errorMessage?: string;
    qrUrl?: string;
    qrRef?: string;
  }>({
    status: 'IDLE',
    method: 'MPESA_STK',
    amount: currentFare,
  });

  // Polling interval ref
  const pollingTimerRef = useRef<any>(null);

  // Fetch initial active shift data and recent fares
  const fetchShiftData = async () => {
    try {
      const res = await fetch('/api/shifts/active', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.activeShift) {
        if (data.liveTallies) setTallies(data.liveTallies);
        if (data.recentFares) setRecentFares(data.recentFares);
      }
    } catch (e) {
      console.warn('[Polling shift error]', e);
    }
  };

  useEffect(() => {
    fetchShiftData();
    const interval = setInterval(fetchShiftData, 5000);
    return () => clearInterval(interval);
  }, [shift.id]);

  // Clean up polling timer on unmount
  useEffect(() => {
    return () => {
      if (pollingTimerRef.current) clearInterval(pollingTimerRef.current);
    };
  }, []);

  // Update shift fare mode on the server
  const handleSwitchFareMode = async (mode: FareMode) => {
    soundFx.playTap();
    setFareMode(mode);
    let newAmount = shift.current_fare_amount;
    if (mode === 'PEAK') newAmount = (shift.current_fare_amount || 100) + 20;
    else if (mode === 'OFF_PEAK') newAmount = Math.max(50, (shift.current_fare_amount || 100) - 20);
    else newAmount = 100;

    setCurrentFare(newAmount);

    try {
      await fetch('/api/shifts/fare-mode', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          shift_id: shift.id,
          fare_mode: mode,
          custom_fare: newAmount,
        }),
      });
    } catch (e) {}
  };

  // Adjust fare by +/- 20
  const adjustFare = (delta: number) => {
    soundFx.playTap();
    setCurrentFare(prev => Math.max(20, prev + delta));
  };

  // 1-Tap Cash Direct Action (Under 2 taps!)
  const handleChargeCashInstant = async (amountToCharge = currentFare) => {
    soundFx.playTap();
    const clientTxId = `TX-CASH-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    
    // If Offline: Queue in IndexedDB and update optimistic tallies immediately!
    if (!isOnline) {
      await queueOfflineFare({
        client_tx_id: clientTxId,
        shift_id: shift.id,
        amount: amountToCharge,
        payment_method: 'CASH',
        fare_type: 'STANDARD',
        stage_name: stageName,
        created_at: new Date().toISOString(),
      });

      soundFx.playCashChime();
      setTallies(prev => ({
        ...prev,
        passengerCount: prev.passengerCount + 1,
        totalCollected: prev.totalCollected + amountToCharge,
        cashTotal: prev.cashTotal + amountToCharge,
      }));

      setRecentFares(prev => [
        {
          id: Date.now(),
          shift_id: shift.id,
          conductor_id: shift.conductor_id,
          vehicle_id: shift.vehicle_id,
          route_id: shift.route_id,
          amount: amountToCharge,
          fare_type: 'STANDARD',
          stage_name: stageName,
          payment_method: 'CASH',
          status: 'CONFIRMED',
          idempotency_key: clientTxId,
          is_offline_synced: false,
          created_at: new Date().toISOString(),
        },
        ...prev,
      ]);

      setActiveTx({
        status: 'CONFIRMED',
        method: 'CASH',
        amount: amountToCharge,
      });

      onOfflineFareQueued();
      setIsChargingOpen(false);
      return;
    }

    // Online Cash Charge
    setIsSubmitting(true);
    try {
      const res = await fetch('/api/fares/charge', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          shift_id: shift.id,
          amount: amountToCharge,
          fare_type: 'STANDARD',
          payment_method: 'CASH',
          idempotency_key: clientTxId,
          stage_name: stageName,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed to record cash');

      soundFx.playCashChime();
      setTallies(prev => ({
        ...prev,
        passengerCount: prev.passengerCount + 1,
        totalCollected: prev.totalCollected + amountToCharge,
        cashTotal: prev.cashTotal + amountToCharge,
      }));

      setRecentFares(prev => [data.fare, ...prev.filter(f => f.id !== data.fare.id)]);
      setActiveTx({
        status: 'CONFIRMED',
        method: 'CASH',
        amount: amountToCharge,
      });

      setIsChargingOpen(false);
    } catch (err: any) {
      soundFx.playErrorBeep();
      alert('Error: ' + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Initiate M-Pesa STK Push
  const handleInitiateSTKPush = async () => {
    if (!passengerPhone) {
      soundFx.playErrorBeep();
      alert(lang === 'sw' ? 'Weka nambari ya simu ya abiria' : 'Please enter passenger phone number');
      return;
    }

    soundFx.playTap();
    setIsSubmitting(true);
    const clientTxId = `TX-STK-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

    setActiveTx({
      status: 'PENDING',
      method: 'MPESA_STK',
      amount: currentFare,
      phone: passengerPhone,
    });

    try {
      const res = await fetch('/api/fares/charge', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          shift_id: shift.id,
          amount: currentFare,
          fare_type: 'STANDARD',
          payment_method: 'MPESA_STK',
          passenger_phone: passengerPhone,
          idempotency_key: clientTxId,
          stage_name: stageName,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed to initiate STK Push');

      setActiveTx(prev => ({
        ...prev,
        fareId: data.fare.id,
        checkoutRequestId: data.checkout_request_id,
        status: 'PENDING',
      }));

      // Start Polling for Confirmation (Fallback mechanism)
      startSTKPolling(data.checkout_request_id, currentFare);
    } catch (err: any) {
      soundFx.playErrorBeep();
      setActiveTx(prev => ({
        ...prev,
        status: 'FAILED',
        errorMessage: err.message,
      }));
    } finally {
      setIsSubmitting(false);
    }
  };

  // Poll STK status every 1.2s until confirmed or timeout
  const startSTKPolling = (checkoutId: string, amount: number) => {
    if (pollingTimerRef.current) clearInterval(pollingTimerRef.current);

    let attempts = 0;
    pollingTimerRef.current = setInterval(async () => {
      attempts++;
      try {
        const res = await fetch(`/api/mpesa/status/${checkoutId}`);
        const data = await res.json();

        if (data.fare_status === 'CONFIRMED' || data.payment_status === 'SUCCESS') {
          clearInterval(pollingTimerRef.current);
          soundFx.playMpesaSuccess();
          setActiveTx(prev => ({
            ...prev,
            status: 'CONFIRMED',
            receipt: data.mpesa_receipt_number,
          }));

          setTallies(prev => ({
            ...prev,
            passengerCount: prev.passengerCount + 1,
            totalCollected: prev.totalCollected + amount,
            digitalTotal: prev.digitalTotal + amount,
          }));

          fetchShiftData();
        } else if (data.fare_status === 'FAILED' || data.payment_status === 'FAILED') {
          clearInterval(pollingTimerRef.current);
          soundFx.playErrorBeep();
          setActiveTx(prev => ({
            ...prev,
            status: 'FAILED',
            errorMessage: data.failure_reason || 'Payment cancelled by passenger',
          }));
        } else if (attempts > 35) {
          // ~42s timeout
          clearInterval(pollingTimerRef.current);
          setActiveTx(prev => ({
            ...prev,
            status: 'FAILED',
            errorMessage: 'Network timeout (Safaricom Daraja taking too long). Tap retry.',
          }));
        }
      } catch (e) {
        // network dropped
      }
    }, 1300);
  };

  // Generate Dynamic QR Code Scan
  const handleInitiateDynamicQR = async () => {
    soundFx.playTap();
    setIsSubmitting(true);
    const clientTxId = `TX-QR-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

    try {
      const res = await fetch('/api/fares/charge', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          shift_id: shift.id,
          amount: currentFare,
          fare_type: 'STANDARD',
          payment_method: 'DYNAMIC_QR',
          idempotency_key: clientTxId,
          stage_name: stageName,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed to generate QR');

      setActiveTx({
        fareId: data.fare.id,
        checkoutRequestId: data.checkout_request_id,
        status: 'PENDING',
        method: 'DYNAMIC_QR',
        amount: currentFare,
        qrUrl: data.qr_code_data_url,
        qrRef: data.reference,
      });

      // Start polling status
      startSTKPolling(data.checkout_request_id, currentFare);
    } catch (err: any) {
      soundFx.playErrorBeep();
      alert('Error: ' + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Instant Manual Simulation Button for fast testing
  const handleSimulatePassengerAction = async (resultCode: number) => {
    if (!activeTx.checkoutRequestId) return;
    soundFx.playTap();

    try {
      const res = await fetch('/api/mpesa/simulate-callback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          checkout_request_id: activeTx.checkoutRequestId,
          result_code: resultCode,
        }),
      });
      const data = await res.json();
      if (resultCode === 0) {
        soundFx.playMpesaSuccess();
        setActiveTx(prev => ({
          ...prev,
          status: 'CONFIRMED',
          receipt: data.receipt,
        }));
      } else {
        soundFx.playErrorBeep();
        setActiveTx(prev => ({
          ...prev,
          status: 'FAILED',
          errorMessage: data.reason || 'Passenger Cancelled',
        }));
      }
      fetchShiftData();
    } catch (e) {}
  };

  return (
    <div className="max-w-md mx-auto px-3 py-4 space-y-4">
      {/* 1. RUNNING STATS HEADER (Always Visible Counter) */}
      <div className="bg-neutral-900 border-2 border-neutral-800 rounded-2xl p-3.5 shadow-xl">
        <div className="grid grid-cols-4 gap-2 text-center divide-x divide-neutral-800">
          {/* Pax Counter */}
          <div className="px-1">
            <div className="text-[10px] uppercase font-bold text-neutral-400 tracking-wider flex items-center justify-center gap-1">
              <Users className="w-3 h-3 text-blue-400" />
              <span>Pax</span>
            </div>
            <div className="text-2xl font-black font-mono text-white mt-0.5">
              {tallies.passengerCount}
            </div>
            <div className="text-[10px] text-neutral-500 font-bold">
              {shift.capacity ? `/${shift.capacity}` : 'Trip'}
            </div>
          </div>

          {/* Total Collected */}
          <div className="px-1">
            <div className="text-[10px] uppercase font-bold text-green-400 tracking-wider">
              {t.runningTallies.total}
            </div>
            <div className="text-2xl font-black font-mono text-green-400 mt-0.5">
              <span className="text-xs font-normal mr-0.5">KSh</span>
              {tallies.totalCollected.toLocaleString()}
            </div>
            <div className="text-[10px] text-green-500/80 font-bold">
              {tallies.pendingCount > 0 ? `${tallies.pendingCount} in flight` : 'Reconciled'}
            </div>
          </div>

          {/* Cash Split */}
          <div className="px-1">
            <div className="text-[10px] uppercase font-bold text-amber-300 tracking-wider">
              Cash
            </div>
            <div className="text-lg font-black font-mono text-amber-200 mt-1">
              {tallies.cashTotal.toLocaleString()}
            </div>
            <div className="text-[10px] text-neutral-400">
              {tallies.totalCollected > 0 
                ? `${Math.round((tallies.cashTotal / tallies.totalCollected) * 100)}%` 
                : '0%'}
            </div>
          </div>

          {/* Digital M-Pesa Split */}
          <div className="px-1">
            <div className="text-[10px] uppercase font-bold text-emerald-400 tracking-wider">
              M-Pesa
            </div>
            <div className="text-lg font-black font-mono text-emerald-300 mt-1">
              {tallies.digitalTotal.toLocaleString()}
            </div>
            <div className="text-[10px] text-neutral-400">
              {tallies.totalCollected > 0 
                ? `${Math.round((tallies.digitalTotal / tallies.totalCollected) * 100)}%` 
                : '0%'}
            </div>
          </div>
        </div>
      </div>

      {/* 2. FARE CONTROLS (Peak / Standard / Off-Peak + Quick Adjuster) */}
      <div className="bg-neutral-900/90 border border-neutral-800 rounded-2xl p-4 shadow-lg space-y-3">
        {/* Peak vs Off-Peak Mode Selector */}
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs font-bold text-neutral-300 flex items-center gap-1.5">
            <TrendingUp className="w-4 h-4 text-green-400" />
            <span>{shift.route_code}: {shift.route_name || 'Matatu Route'}</span>
          </div>

          <div className="flex items-center bg-neutral-950 p-1 rounded-xl border border-neutral-800">
            <button
              onClick={() => handleSwitchFareMode('STANDARD')}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                fareMode === 'STANDARD' ? 'bg-green-600 text-white shadow' : 'text-neutral-400 hover:text-white'
              }`}
            >
              Std
            </button>
            <button
              onClick={() => handleSwitchFareMode('PEAK')}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold flex items-center gap-1 transition-all cursor-pointer ${
                fareMode === 'PEAK' ? 'bg-amber-600 text-white shadow' : 'text-neutral-400 hover:text-white'
              }`}
            >
              <Flame className="w-3 h-3 text-amber-300" />
              <span>Peak</span>
            </button>
            <button
              onClick={() => handleSwitchFareMode('OFF_PEAK')}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold flex items-center gap-1 transition-all cursor-pointer ${
                fareMode === 'OFF_PEAK' ? 'bg-blue-600 text-white shadow' : 'text-neutral-400 hover:text-white'
              }`}
            >
              <Sun className="w-3 h-3 text-blue-300" />
              <span>Off-Peak</span>
            </button>
          </div>
        </div>

        {/* Current Amount Display with Big Tactile Adjusters */}
        <div className="flex items-center justify-between bg-neutral-950 border-2 border-neutral-800 rounded-xl p-3">
          <button
            onClick={() => adjustFare(-20)}
            className="w-13 h-13 rounded-xl bg-neutral-800 hover:bg-neutral-700 active:scale-95 text-white font-black text-2xl flex items-center justify-center border border-neutral-700 shadow-md cursor-pointer transition-transform"
            title="Minus KSh 20 (Student/Short stage)"
          >
            <Minus className="w-6 h-6 text-red-400" />
          </button>

          <div className="text-center">
            <span className="text-[11px] font-bold uppercase tracking-wider text-neutral-400 block">
              {lang === 'sw' ? 'Nauli Sasa' : 'Current Fare'}
            </span>
            <span className="text-4xl font-black font-mono tracking-tight text-white">
              <span className="text-xl text-green-500 mr-1 font-sans">KSh</span>
              {currentFare}
            </span>
          </div>

          <button
            onClick={() => adjustFare(20)}
            className="w-13 h-13 rounded-xl bg-neutral-800 hover:bg-neutral-700 active:scale-95 text-white font-black text-2xl flex items-center justify-center border border-neutral-700 shadow-md cursor-pointer transition-transform"
            title="Plus KSh 20"
          >
            <Plus className="w-6 h-6 text-green-400" />
          </button>
        </div>

        {/* Quick Stage / Fare Presets */}
        <div className="grid grid-cols-5 gap-1.5 pt-1">
          {[50, 70, 80, 100, 120].map((amt) => (
            <button
              key={amt}
              onClick={() => {
                soundFx.playTap();
                setCurrentFare(amt);
              }}
              className={`py-1.5 rounded-lg text-xs font-mono font-bold border transition-all cursor-pointer ${
                currentFare === amt
                  ? 'bg-green-600 text-white border-green-400 shadow-sm'
                  : 'bg-neutral-950 text-neutral-300 border-neutral-800 hover:border-neutral-700'
              }`}
            >
              {amt}
            </button>
          ))}
        </div>
      </div>

      {/* 3. PRIMARY ACTION: CHARGE FARE (Huge Touch Target, 3-Tap Target) */}
      <div className="space-y-2">
        <button
          onClick={() => {
            soundFx.playTap();
            setIsChargingOpen(true);
            setActiveTx({ status: 'IDLE', method: 'MPESA_STK', amount: currentFare });
          }}
          className="w-full h-20 bg-gradient-to-r from-green-600 via-green-500 to-emerald-600 hover:from-green-500 hover:to-emerald-500 active:scale-[0.98] text-white rounded-2xl shadow-2xl shadow-green-950/60 flex items-center justify-between px-6 border-2 border-green-400/40 cursor-pointer transition-all"
        >
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-black/25 flex items-center justify-center font-black">
              <DollarSign className="w-7 h-7 text-white" />
            </div>
            <div className="text-left">
              <span className="text-xs font-extrabold uppercase tracking-wider text-green-100 block">
                {lang === 'sw' ? 'Toza Abiria' : 'Tap to Charge'}
              </span>
              <span className="text-2xl font-black tracking-tight text-white">
                {t.chargeFare}
              </span>
            </div>
          </div>

          <div className="text-right">
            <span className="text-3xl font-black font-mono text-white tracking-tight">
              KSh {currentFare}
            </span>
            <div className="text-[10px] text-green-200 font-bold flex items-center justify-end gap-1">
              <span>M-Pesa / Cash / QR</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </div>
          </div>
        </button>

        {/* 1-Tap Cash Direct Shortcut (For instant cash speed in crowded rush) */}
        <button
          onClick={() => handleChargeCashInstant()}
          disabled={isSubmitting}
          className="w-full h-12 bg-neutral-900 hover:bg-neutral-800 active:scale-[0.98] text-amber-300 font-black text-sm rounded-xl border border-amber-600/40 flex items-center justify-center gap-2 shadow-md cursor-pointer transition-all"
        >
          <Banknote className="w-4 h-4 text-amber-400" />
          <span>{lang === 'sw' ? `Toza Cash KSh ${currentFare} (1-Tap Mara Moja)` : `1-Tap Cash Log (KSh ${currentFare})`}</span>
        </button>
      </div>

      {/* 4. ACTIVE / LAST TRANSACTION FEEDBACK CARD */}
      {activeTx.status !== 'IDLE' && (
        <div className={`p-4 rounded-2xl border-2 shadow-xl transition-all ${
          activeTx.status === 'CONFIRMED'
            ? 'bg-green-950/80 border-green-500 text-green-100'
            : activeTx.status === 'PENDING'
            ? 'bg-amber-950/70 border-amber-500 text-amber-100'
            : 'bg-red-950/80 border-red-500 text-red-100'
        }`}>
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2.5">
              {activeTx.status === 'CONFIRMED' && (
                <div className="w-9 h-9 rounded-xl bg-green-500 text-white flex items-center justify-center shadow-lg">
                  <Check className="w-5 h-5 stroke-[3]" />
                </div>
              )}
              {activeTx.status === 'PENDING' && (
                <div className="w-9 h-9 rounded-xl bg-amber-500 text-white flex items-center justify-center animate-pulse">
                  <Clock className="w-5 h-5 animate-spin" />
                </div>
              )}
              {activeTx.status === 'FAILED' && (
                <div className="w-9 h-9 rounded-xl bg-red-500 text-white flex items-center justify-center">
                  <X className="w-5 h-5 stroke-[3]" />
                </div>
              )}

              <div>
                <div className="font-extrabold text-base flex items-center gap-2">
                  <span>
                    {activeTx.status === 'CONFIRMED'
                      ? t.status.confirmed
                      : activeTx.status === 'PENDING'
                      ? t.status.pending
                      : t.status.failed}
                  </span>
                  <span className="font-mono text-sm bg-black/40 px-2 py-0.5 rounded font-bold">
                    KSh {activeTx.amount}
                  </span>
                </div>
                <p className="text-xs opacity-90 mt-0.5 font-mono">
                  {activeTx.receipt ? `M-Pesa Code: ${activeTx.receipt}` : activeTx.phone ? `Phone: ${activeTx.phone}` : activeTx.method}
                </p>
              </div>
            </div>

            <button
              onClick={() => setActiveTx({ status: 'IDLE', method: 'MPESA_STK', amount: currentFare })}
              className="p-1 text-neutral-400 hover:text-white rounded-lg"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Quick Simulation testing helper in PENDING state */}
          {activeTx.status === 'PENDING' && (
            <div className="mt-3 pt-3 border-t border-amber-500/30 flex items-center justify-between gap-2">
              <span className="text-[11px] font-bold text-amber-200">
                {t.simulatePinTitle}
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => handleSimulatePassengerAction(0)}
                  className="bg-green-600 hover:bg-green-500 text-white text-[11px] font-bold px-2.5 py-1 rounded-lg shadow cursor-pointer transition-all"
                >
                  {t.simulateSuccessBtn}
                </button>
                <button
                  onClick={() => handleSimulatePassengerAction(1032)}
                  className="bg-red-800 hover:bg-red-700 text-white text-[11px] font-bold px-2 py-1 rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Retry Button in FAILED state */}
          {activeTx.status === 'FAILED' && (
            <div className="mt-3 pt-2 border-t border-red-500/30 flex items-center justify-between">
              <span className="text-xs text-red-200 truncate max-w-[200px]">
                {activeTx.errorMessage || 'Transaction dropped'}
              </span>
              <button
                onClick={() => {
                  soundFx.playTap();
                  setIsChargingOpen(true);
                }}
                className="flex items-center gap-1 text-xs font-bold bg-white text-red-950 px-3 py-1.5 rounded-lg shadow hover:bg-neutral-100 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>{t.retryStk}</span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* 5. RECENT ACTIVITY LIST (Last 10 collections) */}
      <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4 shadow-lg">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-300 flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 text-green-400" />
            <span>{t.recentFares}</span>
          </h3>
          <button
            onClick={fetchShiftData}
            className="text-[11px] font-bold text-neutral-400 hover:text-green-400 flex items-center gap-1"
          >
            <RefreshCw className="w-3 h-3" />
            <span>Refresh</span>
          </button>
        </div>

        {recentFares.length === 0 ? (
          <div className="text-center py-6 text-neutral-500 text-xs font-medium">
            {t.noFaresYet}
          </div>
        ) : (
          <div className="divide-y divide-neutral-800/80 max-h-56 overflow-y-auto pr-1">
            {recentFares.slice(0, 8).map((fare) => (
              <div key={fare.id} className="py-2.5 flex items-center justify-between text-xs">
                <div className="flex items-center gap-2 min-w-0">
                  <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                    fare.payment_method === 'CASH' 
                      ? 'bg-amber-950 text-amber-400 border border-amber-700/50' 
                      : fare.payment_method === 'DYNAMIC_QR'
                      ? 'bg-blue-950 text-blue-400 border border-blue-700/50'
                      : 'bg-green-950 text-green-400 border border-green-700/50'
                  }`}>
                    {fare.payment_method === 'CASH' ? (
                      <Banknote className="w-4 h-4" />
                    ) : fare.payment_method === 'DYNAMIC_QR' ? (
                      <QrCode className="w-4 h-4" />
                    ) : (
                      <Smartphone className="w-4 h-4" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="font-bold text-neutral-200 flex items-center gap-1.5 truncate">
                      <span>{fare.payment_method === 'CASH' ? 'Cash' : fare.payment_method === 'DYNAMIC_QR' ? 'QR Pay' : 'M-Pesa'}</span>
                      {fare.mpesa_receipt_number && (
                        <span className="font-mono text-[10px] text-green-400 bg-green-950/60 px-1 rounded">
                          {fare.mpesa_receipt_number}
                        </span>
                      )}
                      {!fare.is_offline_synced && fare.payment_method === 'CASH' && !isOnline && (
                        <span className="text-[10px] text-amber-400">Offline</span>
                      )}
                    </div>
                    <div className="text-[10px] text-neutral-400 truncate">
                      {new Date(fare.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} • {fare.stage_name || 'Stage'}
                    </div>
                  </div>
                </div>

                <div className="text-right shrink-0">
                  <div className="font-mono font-bold text-sm text-white">
                    KSh {fare.amount}
                  </div>
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                    fare.status === 'CONFIRMED'
                      ? 'text-green-400 bg-green-950/40'
                      : fare.status === 'PENDING'
                      ? 'text-amber-400 bg-amber-950/40'
                      : 'text-red-400 bg-red-950/40'
                  }`}>
                    {fare.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 6. END SHIFT FOOTER BUTTON */}
      <div className="pt-2">
        <button
          onClick={onOpenEndShift}
          className="w-full h-12 bg-neutral-900 hover:bg-neutral-800 active:scale-[0.98] text-neutral-300 hover:text-white font-bold text-xs rounded-xl border border-neutral-700 flex items-center justify-center gap-2 cursor-pointer transition-colors"
        >
          <CheckCircle2 className="w-4 h-4 text-green-400" />
          <span>{t.endShiftBtn}</span>
        </button>
      </div>

      {/* 7. CHARGE MODAL (Payment Method Drawer) */}
      {isChargingOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-neutral-900 border-t sm:border border-neutral-700 rounded-t-3xl sm:rounded-2xl w-full max-w-md p-5 shadow-2xl animate-in slide-in-from-bottom duration-200">
            {/* Modal Header */}
            <div className="flex items-center justify-between mb-4 pb-3 border-b border-neutral-800">
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 rounded-xl bg-green-600/20 text-green-400 flex items-center justify-center font-black">
                  <DollarSign className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-black text-white text-base">
                    {lang === 'sw' ? 'Pokea Nauli' : 'Collect Fare'}
                  </h3>
                  <p className="text-xs text-neutral-400 font-mono">
                    Amount: <strong className="text-green-400 font-bold">KSh {currentFare}</strong>
                  </p>
                </div>
              </div>

              <button
                onClick={() => setIsChargingOpen(false)}
                className="p-1.5 text-neutral-400 hover:text-white rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Payment Method Tabs */}
            <div className="grid grid-cols-3 gap-2 mb-4">
              <button
                type="button"
                onClick={() => {
                  soundFx.playTap();
                  setSelectedMethod('MPESA_STK');
                }}
                className={`py-3 px-2 rounded-xl text-xs font-bold border transition-all flex flex-col items-center gap-1 cursor-pointer ${
                  selectedMethod === 'MPESA_STK'
                    ? 'bg-green-600 border-green-400 text-white shadow-lg'
                    : 'bg-neutral-950 border-neutral-800 text-neutral-400 hover:text-white'
                }`}
              >
                <Smartphone className="w-5 h-5" />
                <span>M-Pesa STK</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  soundFx.playTap();
                  setSelectedMethod('CASH');
                }}
                className={`py-3 px-2 rounded-xl text-xs font-bold border transition-all flex flex-col items-center gap-1 cursor-pointer ${
                  selectedMethod === 'CASH'
                    ? 'bg-amber-600 border-amber-400 text-white shadow-lg'
                    : 'bg-neutral-950 border-neutral-800 text-neutral-400 hover:text-white'
                }`}
              >
                <Banknote className="w-5 h-5" />
                <span>Cash Mkononi</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  soundFx.playTap();
                  setSelectedMethod('DYNAMIC_QR');
                }}
                className={`py-3 px-2 rounded-xl text-xs font-bold border transition-all flex flex-col items-center gap-1 cursor-pointer ${
                  selectedMethod === 'DYNAMIC_QR'
                    ? 'bg-blue-600 border-blue-400 text-white shadow-lg'
                    : 'bg-neutral-950 border-neutral-800 text-neutral-400 hover:text-white'
                }`}
              >
                <QrCode className="w-5 h-5" />
                <span>Dynamic QR</span>
              </button>
            </div>

            {/* METHOD CONTENT: M-PESA STK PUSH */}
            {selectedMethod === 'MPESA_STK' && (
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-neutral-300 uppercase tracking-wider mb-1.5">
                    {t.enterPhone}
                  </label>
                  <input
                    type="tel"
                    value={passengerPhone}
                    onChange={(e) => setPassengerPhone(e.target.value)}
                    placeholder="0712 345 678"
                    className="w-full bg-neutral-950 border-2 border-neutral-700 focus:border-green-500 rounded-xl px-4 py-3.5 text-xl font-mono font-bold text-white outline-none"
                    autoFocus
                  />
                </div>

                {/* Quick Phone Demo Presets */}
                <div className="flex gap-2">
                  <span className="text-[10px] text-neutral-400 self-center">Demo:</span>
                  {['0712889900', '0724112233', '0799445566'].map(p => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => {
                        soundFx.playTap();
                        setPassengerPhone(p);
                      }}
                      className="text-[11px] font-mono bg-neutral-950 hover:bg-neutral-800 border border-neutral-700 text-neutral-300 px-2 py-1 rounded-lg cursor-pointer"
                    >
                      {p}
                    </button>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={handleInitiateSTKPush}
                  disabled={isSubmitting || !passengerPhone}
                  className="w-full h-14 bg-green-600 hover:bg-green-500 active:scale-[0.98] text-white font-black text-base rounded-xl shadow-lg shadow-green-900/40 flex items-center justify-center gap-2 cursor-pointer transition-all disabled:opacity-50"
                >
                  {isSubmitting ? (
                    <span>Inatuma Prompt kwa Simu...</span>
                  ) : (
                    <>
                      <Send className="w-5 h-5" />
                      <span>{t.sendPrompt} (KSh {currentFare})</span>
                    </>
                  )}
                </button>
              </div>
            )}

            {/* METHOD CONTENT: CASH */}
            {selectedMethod === 'CASH' && (
              <div className="space-y-4 text-center py-2">
                <div className="w-14 h-14 rounded-2xl bg-amber-600/20 text-amber-400 border border-amber-500/30 flex items-center justify-center mx-auto">
                  <Banknote className="w-8 h-8" />
                </div>
                <div>
                  <h4 className="font-extrabold text-white text-lg">
                    {lang === 'sw' ? `Pokea KSh ${currentFare} Pesa Mkononi` : `Collect KSh ${currentFare} Cash`}
                  </h4>
                  <p className="text-xs text-neutral-400 mt-1">
                    {lang === 'sw' ? 'Bofya hapa chini kurekodi papo hapo.' : 'Instant 1-tap logging without waiting.'}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => handleChargeCashInstant()}
                  disabled={isSubmitting}
                  className="w-full h-14 bg-amber-600 hover:bg-amber-500 active:scale-[0.98] text-white font-black text-base rounded-xl shadow-lg shadow-amber-950/40 flex items-center justify-center gap-2 cursor-pointer transition-all"
                >
                  <Check className="w-5 h-5 stroke-[3]" />
                  <span>{t.quickCharge}</span>
                </button>
              </div>
            )}

            {/* METHOD CONTENT: DYNAMIC QR */}
            {selectedMethod === 'DYNAMIC_QR' && (
              <div className="space-y-4 text-center py-2">
                {activeTx.qrUrl ? (
                  <div className="space-y-3">
                    <div className="bg-white p-3 rounded-2xl inline-block shadow-xl">
                      <img src={activeTx.qrUrl} alt="M-Pesa Dynamic QR" className="w-48 h-48 mx-auto" />
                    </div>
                    <div className="text-xs text-neutral-300">
                      <div>Buy Goods Till: <strong className="text-green-400 font-mono text-sm">889900</strong></div>
                      <div>Ref: <span className="font-mono text-neutral-400">{activeTx.qrRef}</span></div>
                    </div>
                    <div className="flex gap-2 justify-center">
                      <button
                        onClick={() => handleSimulatePassengerAction(0)}
                        className="bg-green-600 hover:bg-green-500 text-white text-xs font-bold px-3 py-1.5 rounded-lg cursor-pointer"
                      >
                        Simulate QR Paid
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="w-14 h-14 rounded-2xl bg-blue-600/20 text-blue-400 border border-blue-500/30 flex items-center justify-center mx-auto">
                      <QrCode className="w-8 h-8" />
                    </div>
                    <p className="text-xs text-neutral-300">
                      {t.qrInstruction}
                    </p>
                    <button
                      type="button"
                      onClick={handleInitiateDynamicQR}
                      disabled={isSubmitting}
                      className="w-full h-14 bg-blue-600 hover:bg-blue-500 active:scale-[0.98] text-white font-black text-base rounded-xl shadow-lg shadow-blue-950/40 flex items-center justify-center gap-2 cursor-pointer transition-all"
                    >
                      <QrCode className="w-5 h-5" />
                      <span>{lang === 'sw' ? `Tengeneza QR (KSh ${currentFare})` : `Generate QR (KSh ${currentFare})`}</span>
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
