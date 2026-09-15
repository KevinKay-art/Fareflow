import React, { useState, useEffect } from 'react';
import { 
  ShieldCheck, 
  Bus, 
  Users, 
  DollarSign, 
  Smartphone, 
  Banknote, 
  Search, 
  RefreshCw, 
  ArrowLeft,
  CheckCircle,
  FileSpreadsheet,
  Car
} from 'lucide-react';
import { Language } from '../types';
import { getTranslation } from '../lib/translations';

interface AdminDashboardProps {
  lang: Language;
  onBackToConductor: () => void;
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({ lang, onBackToConductor }) => {
  const t = getTranslation(lang);
  const [data, setData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  const fetchOverview = async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/admin/overview');
      const json = await res.json();
      setData(json);
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchOverview();
  }, []);

  const totals = data?.totals || {};
  const vehicles = data?.vehicleBreakdown || [];
  const conductors = data?.conductorBreakdown || [];
  const auditFares = (data?.recentAudit || []).filter((f: any) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      (f.mpesa_receipt_number && f.mpesa_receipt_number.toLowerCase().includes(q)) ||
      (f.passenger_phone && f.passenger_phone.includes(q)) ||
      (f.vehicle && f.vehicle.toLowerCase().includes(q)) ||
      (f.conductor && f.conductor.toLowerCase().includes(q))
    );
  });

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-neutral-800">
        <div className="flex items-center gap-3">
          <button
            onClick={onBackToConductor}
            className="p-2 bg-neutral-900 hover:bg-neutral-800 text-neutral-300 rounded-xl border border-neutral-700 cursor-pointer"
            title="Back to Conductor Mobile View"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-green-400" />
              <h1 className="text-xl font-black text-white">SACCO & Vehicle Owner Portal</h1>
            </div>
            <p className="text-xs text-neutral-400">
              Daily revenue monitoring, digital fare reconciliation, and fleet audit ledger
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={fetchOverview}
            disabled={isLoading}
            className="px-3 py-2 bg-neutral-900 hover:bg-neutral-800 text-neutral-200 text-xs font-bold rounded-xl border border-neutral-700 flex items-center gap-1.5 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            <span>Refresh Data</span>
          </button>
        </div>
      </div>

      {/* 1. Fleet Overview KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {/* Total Revenue */}
        <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4 shadow-lg">
          <div className="text-[11px] font-bold uppercase tracking-wider text-green-400 flex items-center justify-between">
            <span>Daily Takings</span>
            <DollarSign className="w-4 h-4" />
          </div>
          <div className="text-2xl font-black font-mono text-white mt-1">
            <span className="text-sm font-sans text-green-500 mr-1">KSh</span>
            {Number(totals.grand_revenue || 0).toLocaleString()}
          </div>
          <div className="text-[10px] text-neutral-400 mt-1">
            Across {totals.active_vehicles_today || 0} matatus on road
          </div>
        </div>

        {/* Digital M-Pesa */}
        <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4 shadow-lg">
          <div className="text-[11px] font-bold uppercase tracking-wider text-emerald-400 flex items-center justify-between">
            <span>M-Pesa Digital</span>
            <Smartphone className="w-4 h-4" />
          </div>
          <div className="text-2xl font-black font-mono text-emerald-300 mt-1">
            <span className="text-sm font-sans text-emerald-400 mr-1">KSh</span>
            {Number(totals.total_digital || 0).toLocaleString()}
          </div>
          <div className="text-[10px] text-emerald-500/80 font-bold mt-1">
            {totals.grand_revenue > 0 
              ? `${Math.round((totals.total_digital / totals.grand_revenue) * 100)}% Digital Compliance` 
              : 'Direct to Bank'}
          </div>
        </div>

        {/* Cash Total */}
        <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4 shadow-lg">
          <div className="text-[11px] font-bold uppercase tracking-wider text-amber-300 flex items-center justify-between">
            <span>Cash Collected</span>
            <Banknote className="w-4 h-4" />
          </div>
          <div className="text-2xl font-black font-mono text-amber-200 mt-1">
            <span className="text-sm font-sans text-amber-400 mr-1">KSh</span>
            {Number(totals.total_cash || 0).toLocaleString()}
          </div>
          <div className="text-[10px] text-neutral-400 mt-1">
            Handover cash float
          </div>
        </div>

        {/* Total Passengers */}
        <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4 shadow-lg">
          <div className="text-[11px] font-bold uppercase tracking-wider text-blue-400 flex items-center justify-between">
            <span>Passengers</span>
            <Users className="w-4 h-4" />
          </div>
          <div className="text-2xl font-black font-mono text-white mt-1">
            {Number(totals.total_passengers || 0).toLocaleString()}
          </div>
          <div className="text-[10px] text-neutral-400 mt-1">
            {totals.total_shifts_today || 0} completed shifts
          </div>
        </div>
      </div>

      {/* 2. Matatu Fleet Takings Table */}
      <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5 shadow-xl space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bus className="w-4 h-4 text-green-400" />
            <h2 className="font-extrabold text-white text-sm">Vehicle Fleet Performance Today</h2>
          </div>
          <span className="text-xs text-neutral-400 font-mono">
            {vehicles.length} Matatus Registered
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-neutral-950 text-neutral-400 border-b border-neutral-800 uppercase font-mono">
              <tr>
                <th className="p-3">Vehicle</th>
                <th className="p-3">Fleet / Sacco</th>
                <th className="p-3 text-right">Capacity</th>
                <th className="p-3 text-right">M-Pesa</th>
                <th className="p-3 text-right">Cash</th>
                <th className="p-3 text-right">Total Takings</th>
                <th className="p-3 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-800">
              {vehicles.map((v: any) => (
                <tr key={v.id} className="hover:bg-neutral-800/50 transition-colors">
                  <td className="p-3 font-bold font-mono text-white flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-green-500"></span>
                    {v.reg_number}
                  </td>
                  <td className="p-3 text-neutral-300">
                    <div className="font-semibold">{v.fleet_name}</div>
                    <div className="text-[10px] text-neutral-500">{v.sacco_name}</div>
                  </td>
                  <td className="p-3 text-right font-mono text-neutral-400">{v.capacity} Pax</td>
                  <td className="p-3 text-right font-mono text-emerald-400 font-bold">
                    KSh {Number(v.digital_takings || 0).toLocaleString()}
                  </td>
                  <td className="p-3 text-right font-mono text-amber-300 font-bold">
                    KSh {Number(v.cash_takings || 0).toLocaleString()}
                  </td>
                  <td className="p-3 text-right font-mono text-green-400 font-black text-sm">
                    KSh {Number(v.total_takings || 0).toLocaleString()}
                  </td>
                  <td className="p-3 text-center">
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-green-950 text-green-400 border border-green-800">
                      Active
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 3. Transaction Audit Ledger with Receipt Search */}
      <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5 shadow-xl space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-green-400" />
            <h2 className="font-extrabold text-white text-sm">Real-Time Transaction Audit Trail</h2>
          </div>

          {/* Search Box */}
          <div className="relative">
            <Search className="w-4 h-4 text-neutral-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search M-Pesa Code (QFT7...) or Phone..."
              className="bg-neutral-950 border border-neutral-700 rounded-xl pl-9 pr-3 py-1.5 text-xs text-white outline-none w-full sm:w-64"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-neutral-950 text-neutral-400 border-b border-neutral-800 uppercase font-mono">
              <tr>
                <th className="p-2.5">Time</th>
                <th className="p-2.5">Receipt / Method</th>
                <th className="p-2.5">Vehicle / Route</th>
                <th className="p-2.5">Passenger</th>
                <th className="p-2.5 text-right">Amount</th>
                <th className="p-2.5 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-800">
              {auditFares.map((f: any) => (
                <tr key={f.id} className="hover:bg-neutral-800/40">
                  <td className="p-2.5 text-neutral-400 font-mono">
                    {new Date(f.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </td>
                  <td className="p-2.5">
                    {f.mpesa_receipt_number ? (
                      <span className="font-mono font-bold text-green-400 bg-green-950/60 px-1.5 py-0.5 rounded border border-green-800/50">
                        {f.mpesa_receipt_number}
                      </span>
                    ) : (
                      <span className="text-neutral-400">{f.payment_method}</span>
                    )}
                  </td>
                  <td className="p-2.5 text-neutral-300">
                    <span className="font-bold text-white">{f.vehicle}</span> ({f.route_code})
                  </td>
                  <td className="p-2.5 text-neutral-400 font-mono">
                    {f.passenger_phone || 'Cash Passenger'}
                  </td>
                  <td className="p-2.5 text-right font-mono font-bold text-white">
                    KSh {f.amount}
                  </td>
                  <td className="p-2.5 text-center">
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                      f.status === 'CONFIRMED'
                        ? 'text-green-400 bg-green-950'
                        : f.status === 'PENDING'
                        ? 'text-amber-400 bg-amber-950'
                        : 'text-red-400 bg-red-950'
                    }`}>
                      {f.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
