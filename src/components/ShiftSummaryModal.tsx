import React, { useState } from 'react';
import { 
  CheckCircle2, 
  X, 
  Share2, 
  Printer, 
  Copy, 
  Bus, 
  Users, 
  DollarSign, 
  Banknote, 
  Smartphone, 
  AlertTriangle,
  Check
} from 'lucide-react';
import { Shift, Language, ShiftReconciliation } from '../types';
import { getTranslation } from '../lib/translations';
import { soundFx } from '../lib/audio';

interface ShiftSummaryModalProps {
  shift: Shift;
  token: string;
  lang: Language;
  onClose: () => void;
  onShiftEnded: (reconciliation: ShiftReconciliation) => void;
}

export const ShiftSummaryModal: React.FC<ShiftSummaryModalProps> = ({
  shift,
  token,
  lang,
  onClose,
  onShiftEnded,
}) => {
  const t = getTranslation(lang);
  const [closingCash, setClosingCash] = useState<number>(shift.cash_total + (shift.opening_cash || 0));
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [reconciliation, setReconciliation] = useState<ShiftReconciliation | null>(null);
  const [copied, setCopied] = useState(false);

  const handleEndShiftSubmit = async () => {
    soundFx.playTap();
    setIsSubmitting(true);
    try {
      const res = await fetch('/api/shifts/end', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          shift_id: shift.id,
          closing_cash: Number(closingCash) || 0,
          notes,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed to end shift');

      soundFx.playMpesaSuccess();
      setReconciliation(data.reconciliation);
      onShiftEnded(data.reconciliation);
    } catch (err: any) {
      soundFx.playErrorBeep();
      alert('Error: ' + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const generateWhatsAppHandoverText = (rec: ShiftReconciliation) => {
    return `🚌 *FAREFLOW SACCO HANDOVER REPORT*
━━━━━━━━━━━━━━━━━━━━━
📍 *Vehicle:* ${rec.vehicleReg} (${rec.fleetName})
🛣️ *Route:* ${rec.routeName}
👤 *Conductor:* ${rec.conductorName} (${rec.conductorPhone})
⏰ *Shift:* ${new Date(rec.startTime).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})} - ${new Date(rec.endTime).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
━━━━━━━━━━━━━━━━━━━━━
👥 *Total Passengers:* ${rec.passengerCount} Pax
💰 *GRAND TOTAL:* KSh ${rec.totalCollected.toLocaleString()}
📱 *M-Pesa Digital:* KSh ${rec.digitalTotal.toLocaleString()}
💵 *Cash Handed Over:* KSh ${rec.cashTotal.toLocaleString()}
🪙 *Opening Float:* KSh ${rec.openingCash}
💵 *Closing Cash:* KSh ${rec.closingCash}
⚠️ *Failed / Dropped:* ${rec.failedTransactions}
━━━━━━━━━━━━━━━━━━━━━
📝 *Notes:* ${rec.notes || 'Reconciled clean. No pending disputes.'}
✅ Verified by FareFlow PostgreSQL Digital Ledger`;
  };

  const handleCopyReport = () => {
    if (!reconciliation) return;
    const text = generateWhatsAppHandoverText(reconciliation);
    navigator.clipboard.writeText(text);
    setCopied(true);
    soundFx.playTap();
    setTimeout(() => setCopied(false), 3000);
  };

  const handleShareWhatsApp = () => {
    if (!reconciliation) return;
    const text = encodeURIComponent(generateWhatsAppHandoverText(reconciliation));
    window.open(`https://api.whatsapp.com/send?text=${text}`, '_blank');
  };

  const handlePrint = () => {
    soundFx.playTap();
    if (!reconciliation) return;

    try {
      const printWindow = window.open('', '_blank', 'width=450,height=650');
      if (printWindow) {
        printWindow.document.write(`
          <!DOCTYPE html>
          <html>
            <head>
              <meta charset="utf-8">
              <title>FareFlow Receipt - ${reconciliation.vehicleReg}</title>
              <style>
                @page { margin: 5mm; size: 80mm auto; }
                body {
                  font-family: 'Courier New', Courier, monospace;
                  width: 300px;
                  margin: 0 auto;
                  padding: 12px;
                  color: #000;
                  background: #fff;
                  font-size: 12px;
                  line-height: 1.4;
                }
                .text-center { text-align: center; }
                .bold { font-weight: bold; }
                .title { font-size: 16px; font-weight: 900; margin-bottom: 2px; }
                .sacco { font-size: 13px; font-weight: bold; margin-bottom: 2px; }
                .divider { border-bottom: 1px dashed #000; margin: 8px 0; }
                .row { display: flex; justify-content: space-between; margin: 3px 0; }
                .total-row { font-size: 14px; font-weight: 900; margin: 6px 0; }
                .footer { font-size: 10px; text-align: center; margin-top: 12px; }
              </style>
            </head>
            <body>
              <div class="text-center title">FAREFLOW RECEIPT</div>
              <div class="text-center sacco">${reconciliation.saccoName}</div>
              <div class="text-center">${reconciliation.vehicleReg} • ${reconciliation.fleetName}</div>
              <div class="text-center">${reconciliation.routeName}</div>
              <div class="divider"></div>
              <div class="row"><span>Conductor:</span><span class="bold">${reconciliation.conductorName}</span></div>
              <div class="row"><span>Phone:</span><span>${reconciliation.conductorPhone}</span></div>
              <div class="row"><span>Shift ID:</span><span>#${reconciliation.shiftId}</span></div>
              <div class="row"><span>Date:</span><span>${new Date().toLocaleDateString()}</span></div>
              <div class="row"><span>Passengers:</span><span class="bold">${reconciliation.passengerCount} Pax</span></div>
              <div class="divider"></div>
              <div class="row"><span>Opening Float:</span><span>KSh ${reconciliation.openingCash.toLocaleString()}</span></div>
              <div class="row"><span>Cash Takings:</span><span>KSh ${reconciliation.cashTotal.toLocaleString()}</span></div>
              <div class="row"><span>M-Pesa Digital:</span><span>KSh ${reconciliation.digitalTotal.toLocaleString()}</span></div>
              <div class="divider"></div>
              <div class="row total-row"><span>TOTAL TAKINGS:</span><span>KSh ${reconciliation.totalCollected.toLocaleString()}</span></div>
              <div class="row bold"><span>Closing Cash in Hand:</span><span>KSh ${reconciliation.closingCash.toLocaleString()}</span></div>
              <div class="divider"></div>
              ${reconciliation.notes ? `<div style="font-size: 11px; margin: 4px 0;"><strong>Notes:</strong> ${reconciliation.notes}</div><div class="divider"></div>` : ''}
              <div class="footer">
                <div>Printed: ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                <div class="bold" style="margin-top: 4px;">*** AUDIT VERIFIED BY SACCO ***</div>
              </div>
            </body>
          </html>
        `);
        printWindow.document.close();
        printWindow.focus();
        setTimeout(() => {
          printWindow.print();
        }, 300);
        return;
      }
    } catch (e) {
      console.warn('Popup print blocked, falling back to window.print()', e);
    }

    window.print();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
      <div className="bg-neutral-900 border border-neutral-700 rounded-3xl w-full max-w-lg p-5 sm:p-6 shadow-2xl my-auto">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 mb-4 border-b border-neutral-800">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-green-600/20 text-green-400 border border-green-500/30 flex items-center justify-center font-bold">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-lg font-black text-white">
                {reconciliation ? t.handoverReceipt : t.endShiftBtn}
              </h3>
              <p className="text-xs text-neutral-400 font-mono">
                {shift.reg_number} • {shift.route_code}: {shift.route_name}
              </p>
            </div>
          </div>

          <button onClick={onClose} className="p-1.5 text-neutral-400 hover:text-white rounded-lg">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* STEP 1: PRE-SUBMISSION FORM */}
        {!reconciliation ? (
          <div className="space-y-4">
            {/* Summary Metrics Preview */}
            <div className="grid grid-cols-3 gap-2 bg-neutral-950 p-3 rounded-2xl border border-neutral-800 text-center">
              <div>
                <div className="text-[10px] uppercase font-bold text-neutral-400">Total Pax</div>
                <div className="text-xl font-mono font-black text-white">{shift.passenger_count || 0}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase font-bold text-amber-400">Cash Collected</div>
                <div className="text-xl font-mono font-black text-amber-300">KSh {(shift.cash_total || 0).toLocaleString()}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase font-bold text-emerald-400">M-Pesa Digital</div>
                <div className="text-xl font-mono font-black text-emerald-300">KSh {(shift.digital_total || 0).toLocaleString()}</div>
              </div>
            </div>

            {/* Closing Cash Float Input */}
            <div>
              <label className="block text-xs font-bold text-neutral-300 uppercase tracking-wider mb-1">
                {lang === 'sw' ? 'Cash Iliyopo Mkononi ya Kukabidhi (Closing Cash)' : 'Cash in Hand to Handover (Float + Collections)'}
              </label>
              <input
                type="number"
                value={closingCash}
                onChange={(e) => setClosingCash(Number(e.target.value))}
                className="w-full bg-neutral-950 border-2 border-neutral-700 focus:border-green-500 rounded-xl px-4 py-3 text-lg font-mono font-bold text-white outline-none"
              />
            </div>

            {/* Shift Notes */}
            <div>
              <label className="block text-xs font-bold text-neutral-300 uppercase tracking-wider mb-1">
                {lang === 'sw' ? 'Maelezo ya Safari (Notes / Traffic / Fuel / Police)' : 'Shift Handover Notes (Fuel, Traffic, SACCO levy)'}
              </label>
              <textarea
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g. Fuel KSh 2000, Stage Levy KSh 400, All M-Pesa verified."
                className="w-full bg-neutral-950 border-2 border-neutral-700 focus:border-green-500 rounded-xl p-3 text-xs text-white outline-none"
              />
            </div>

            {/* Confirm Button */}
            <button
              onClick={handleEndShiftSubmit}
              disabled={isSubmitting}
              className="w-full h-14 bg-red-600 hover:bg-red-500 active:scale-[0.98] text-white font-black text-base rounded-2xl shadow-xl shadow-red-950/50 flex items-center justify-center gap-2 cursor-pointer transition-all"
            >
              <CheckCircle2 className="w-5 h-5" />
              <span>{isSubmitting ? 'Inafunga Shift...' : t.endShiftBtn}</span>
            </button>
          </div>
        ) : (
          /* STEP 2: RECONCILED HANDOVER REPORT CARD */
          <div className="space-y-4">
            <div className="bg-neutral-950 border border-green-500/40 rounded-2xl p-4 font-mono text-xs space-y-3 shadow-inner">
              <div className="text-center border-b border-neutral-800 pb-2">
                <div className="font-sans font-black text-base text-white">FAREFLOW HANDOVER RECEIPT</div>
                <div className="text-green-400 font-bold">{reconciliation.saccoName}</div>
                <div className="text-neutral-400 text-[10px]">{reconciliation.vehicleReg} • {reconciliation.routeName}</div>
              </div>

              <div className="grid grid-cols-2 gap-2 text-[11px]">
                <div><span className="text-neutral-500">Conductor:</span> <span className="text-white font-bold">{reconciliation.conductorName}</span></div>
                <div><span className="text-neutral-500">Pax Count:</span> <span className="text-white font-bold">{reconciliation.passengerCount}</span></div>
                <div><span className="text-neutral-500">M-Pesa:</span> <span className="text-emerald-400 font-bold">KSh {reconciliation.digitalTotal.toLocaleString()}</span></div>
                <div><span className="text-neutral-500">Cash:</span> <span className="text-amber-400 font-bold">KSh {reconciliation.cashTotal.toLocaleString()}</span></div>
              </div>

              <div className="border-t border-b border-neutral-800 py-2 flex justify-between items-center text-sm font-black">
                <span className="text-white">TOTAL TAKINGS:</span>
                <span className="text-green-400 text-base">KSh {reconciliation.totalCollected.toLocaleString()}</span>
              </div>

              {reconciliation.notes && (
                <div className="text-[10px] text-neutral-400 italic">
                  Note: {reconciliation.notes}
                </div>
              )}
            </div>

            {/* Sharing & Handover Actions */}
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={handleCopyReport}
                className="h-12 bg-neutral-800 hover:bg-neutral-700 text-white text-xs font-bold rounded-xl border border-neutral-700 flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
              >
                {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
                <span>{copied ? 'Copied!' : 'Copy Text'}</span>
              </button>

              <button
                onClick={handleShareWhatsApp}
                className="h-12 bg-green-700 hover:bg-green-600 text-white text-xs font-bold rounded-xl shadow-lg flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
              >
                <Share2 className="w-4 h-4" />
                <span>{t.shareReport}</span>
              </button>
            </div>

            <button
              onClick={handlePrint}
              className="w-full h-12 bg-neutral-950 hover:bg-neutral-800 text-neutral-100 text-xs font-bold rounded-xl border border-neutral-700 flex items-center justify-center gap-2 cursor-pointer transition-colors shadow-md"
            >
              <Printer className="w-4 h-4 text-green-400" />
              <span>{t.printReport} (Thermal Receipt)</span>
            </button>

            {/* Explicit Done & Close Button */}
            <div className="pt-2 border-t border-neutral-800">
              <button
                onClick={onClose}
                className="w-full h-12 bg-green-600 hover:bg-green-500 text-white text-xs font-black rounded-xl shadow-lg flex items-center justify-center gap-2 cursor-pointer transition-all active:scale-[0.98]"
              >
                <Check className="w-4 h-4" />
                <span>{lang === 'sw' ? 'Nimemaliza • Funga Risiti & Anza Safari Mpya' : 'Done • Close Receipt & Start Next Trip'}</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
