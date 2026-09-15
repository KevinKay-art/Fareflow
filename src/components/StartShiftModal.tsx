import React, { useState, useEffect } from 'react';
import { Bus, MapPin, DollarSign, PlayCircle, AlertCircle } from 'lucide-react';
import { Vehicle, Route, FareMode, Shift, Language } from '../types';
import { getTranslation } from '../lib/translations';
import { soundFx } from '../lib/audio';

interface StartShiftModalProps {
  token: string;
  lang: Language;
  onShiftStarted: (shift: Shift) => void;
}

export const StartShiftModal: React.FC<StartShiftModalProps> = ({
  token,
  lang,
  onShiftStarted,
}) => {
  const t = getTranslation(lang);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [routes, setRoutes] = useState<Route[]>([]);
  const [selectedVehicleId, setSelectedVehicleId] = useState<number | ''>('');
  const [selectedRouteId, setSelectedRouteId] = useState<number | ''>('');
  const [fareMode, setFareMode] = useState<FareMode>('STANDARD');
  const [openingCash, setOpeningCash] = useState<number>(500);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    async function loadMetadata() {
      try {
        const [vRes, rRes] = await Promise.all([
          fetch('/api/vehicles'),
          fetch('/api/routes')
        ]);
        const vData = await vRes.json();
        const rData = await rRes.json();
        setVehicles(vData);
        setRoutes(rData);
        if (vData.length > 0) setSelectedVehicleId(vData[0].id);
        if (rData.length > 0) setSelectedRouteId(rData[0].id);
      } catch (err: any) {
        setError('Failed to load fleet metadata: ' + err.message);
      }
    }
    loadMetadata();
  }, []);

  const handleStartShift = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedVehicleId || !selectedRouteId) {
      setError(lang === 'sw' ? 'Chagua Gari na Route' : 'Please select Vehicle and Route');
      return;
    }

    setIsLoading(true);
    setError('');
    soundFx.playTap();

    try {
      const res = await fetch('/api/shifts/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          vehicle_id: selectedVehicleId,
          route_id: selectedRouteId,
          fare_mode: fareMode,
          opening_cash: Number(openingCash) || 0,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to start shift');
      }

      soundFx.playCashChime();
      onShiftStarted(data.shift);
    } catch (err: any) {
      soundFx.playErrorBeep();
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const selectedRoute = routes.find(r => r.id === selectedRouteId);
  const currentEstFare = selectedRoute
    ? fareMode === 'PEAK' ? selectedRoute.peak_fare : fareMode === 'OFF_PEAK' ? selectedRoute.off_peak_fare : selectedRoute.base_fare
    : 100;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-neutral-900 border border-neutral-800 rounded-2xl w-full max-w-md p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-200">
        <div className="flex items-center gap-3 mb-5 pb-3 border-b border-neutral-800">
          <div className="w-10 h-10 rounded-xl bg-green-600/20 text-green-400 border border-green-500/30 flex items-center justify-center font-bold">
            <PlayCircle className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-xl font-black text-white">{t.startShiftTitle}</h2>
            <p className="text-xs text-neutral-400">
              {lang === 'sw' ? 'Tayarisha gari lako kabla ya kuanza safari' : 'Setup your matatu and fare mode before departure'}
            </p>
          </div>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-950/60 border border-red-800 text-red-300 rounded-xl text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleStartShift} className="space-y-4">
          {/* Vehicle Selector */}
          <div>
            <label className="block text-xs font-bold text-neutral-300 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
              <Bus className="w-3.5 h-3.5 text-green-400" />
              <span>{t.selectVehicle}</span>
            </label>
            <select
              value={selectedVehicleId}
              onChange={(e) => setSelectedVehicleId(Number(e.target.value))}
              className="w-full bg-neutral-950 border-2 border-neutral-700 focus:border-green-500 rounded-xl px-3.5 py-3 text-sm font-bold text-white outline-none cursor-pointer"
            >
              {vehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.reg_number} — {v.fleet_name} ({v.capacity} Pax)
                </option>
              ))}
            </select>
          </div>

          {/* Route Selector */}
          <div>
            <label className="block text-xs font-bold text-neutral-300 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5 text-blue-400" />
              <span>{t.selectRoute}</span>
            </label>
            <select
              value={selectedRouteId}
              onChange={(e) => setSelectedRouteId(Number(e.target.value))}
              className="w-full bg-neutral-950 border-2 border-neutral-700 focus:border-green-500 rounded-xl px-3.5 py-3 text-sm font-bold text-white outline-none cursor-pointer"
            >
              {routes.map((r) => (
                <option key={r.id} value={r.id}>
                  Route {r.code}: {r.name} (KSh {r.base_fare})
                </option>
              ))}
            </select>
          </div>

          {/* Fare Mode Selector */}
          <div>
            <label className="block text-xs font-bold text-neutral-300 uppercase tracking-wider mb-1.5">
              {lang === 'sw' ? 'Muda wa Safari (Fare Mode)' : 'Initial Fare Setting'}
            </label>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setFareMode('STANDARD')}
                className={`py-2.5 px-2 rounded-xl text-xs font-bold border transition-all text-center cursor-pointer ${
                  fareMode === 'STANDARD'
                    ? 'bg-green-600 border-green-400 text-white shadow'
                    : 'bg-neutral-950 border-neutral-800 text-neutral-300 hover:border-neutral-700'
                }`}
              >
                <div>{t.standard}</div>
                <div className="text-[11px] opacity-80">KSh {selectedRoute?.base_fare || 100}</div>
              </button>

              <button
                type="button"
                onClick={() => setFareMode('PEAK')}
                className={`py-2.5 px-2 rounded-xl text-xs font-bold border transition-all text-center cursor-pointer ${
                  fareMode === 'PEAK'
                    ? 'bg-amber-600 border-amber-400 text-white shadow'
                    : 'bg-neutral-950 border-neutral-800 text-neutral-300 hover:border-neutral-700'
                }`}
              >
                <div>{t.peak}</div>
                <div className="text-[11px] opacity-80">KSh {selectedRoute?.peak_fare || 120}</div>
              </button>

              <button
                type="button"
                onClick={() => setFareMode('OFF_PEAK')}
                className={`py-2.5 px-2 rounded-xl text-xs font-bold border transition-all text-center cursor-pointer ${
                  fareMode === 'OFF_PEAK'
                    ? 'bg-blue-600 border-blue-400 text-white shadow'
                    : 'bg-neutral-950 border-neutral-800 text-neutral-300 hover:border-neutral-700'
                }`}
              >
                <div>{t.offPeak}</div>
                <div className="text-[11px] opacity-80">KSh {selectedRoute?.off_peak_fare || 80}</div>
              </button>
            </div>
          </div>

          {/* Opening Cash Float */}
          <div>
            <label className="block text-xs font-bold text-neutral-300 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
              <DollarSign className="w-3.5 h-3.5 text-emerald-400" />
              <span>{t.openingFloat}</span>
            </label>
            <input
              type="number"
              min={0}
              step={50}
              value={openingCash}
              onChange={(e) => setOpeningCash(Number(e.target.value))}
              className="w-full bg-neutral-950 border-2 border-neutral-700 focus:border-green-500 rounded-xl px-4 py-3 text-base font-mono font-bold text-white outline-none"
              placeholder="e.g. 500"
            />
          </div>

          {/* Start Shift Button */}
          <button
            type="submit"
            disabled={isLoading}
            className="w-full h-14 bg-green-600 hover:bg-green-500 active:scale-[0.98] text-white font-black text-lg rounded-xl shadow-lg shadow-green-900/40 flex items-center justify-center gap-2 transition-all mt-4 cursor-pointer"
          >
            {isLoading ? (
              <span>Inaanza...</span>
            ) : (
              <>
                <PlayCircle className="w-5 h-5" />
                <span>{t.startShiftBtn} (KSh {currentEstFare})</span>
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
};
