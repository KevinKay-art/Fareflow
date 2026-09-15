import React from 'react';
import { 
  Bus, 
  Wifi, 
  WifiOff, 
  RefreshCw, 
  Globe, 
  ShieldCheck, 
  LogOut, 
  Sliders, 
  Radio 
} from 'lucide-react';
import { Conductor, Shift, Language } from '../types';
import { getTranslation } from '../lib/translations';

interface HeaderProps {
  conductor: Conductor | null;
  activeShift: Shift | null;
  isOnline: boolean;
  queuedCount: number;
  isSyncing: boolean;
  onSync: () => void;
  lang: Language;
  onToggleLang: () => void;
  viewMode: 'conductor' | 'admin';
  onChangeViewMode: (mode: 'conductor' | 'admin') => void;
  onLogout: () => void;
  onOpenDarajaConfig: () => void;
  isSimulated: boolean;
  onToggleSimulatedNetwork: () => void;
  simulatedOffline: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  conductor,
  activeShift,
  isOnline,
  queuedCount,
  isSyncing,
  onSync,
  lang,
  onToggleLang,
  viewMode,
  onChangeViewMode,
  onLogout,
  onOpenDarajaConfig,
  isSimulated,
  onToggleSimulatedNetwork,
  simulatedOffline,
}) => {
  const t = getTranslation(lang);
  const effectiveOnline = isOnline && !simulatedOffline;

  return (
    <header className="sticky top-0 z-30 bg-neutral-950/95 backdrop-blur border-b border-neutral-800 text-white px-3 py-2.5 shadow-md">
      <div className="max-w-4xl mx-auto flex items-center justify-between gap-2">
        {/* Brand & Vehicle Badge */}
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-green-600 flex items-center justify-center shrink-0 shadow-lg shadow-green-900/30 text-white font-black text-xl tracking-wider">
            <Bus className="w-5 h-5 text-white" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="font-extrabold text-base tracking-tight text-white">
                FareFlow
              </span>
              {activeShift && (
                <span className="bg-green-500/20 text-green-400 border border-green-500/30 text-xs font-mono font-bold px-1.5 py-0.5 rounded">
                  {activeShift.reg_number || 'MATATU'}
                </span>
              )}
            </div>
            <p className="text-[11px] text-neutral-400 truncate max-w-[170px] sm:max-w-xs font-medium">
              {activeShift 
                ? `${activeShift.route_code}: ${activeShift.route_name || 'Active Route'}` 
                : conductor ? `${conductor.sacco}` : t.tagline}
            </p>
          </div>
        </div>

        {/* Right Controls */}
        <div className="flex items-center gap-1.5 shrink-0">
          {/* Offline / Online Network Pill with Simulator */}
          <div className="flex items-center">
            {effectiveOnline ? (
              <button
                onClick={onToggleSimulatedNetwork}
                title="Click to simulate weak signal/tunnel offline mode"
                className="flex items-center gap-1 text-[11px] font-bold bg-neutral-900 hover:bg-neutral-800 text-green-400 border border-neutral-700 px-2 py-1 rounded-lg transition-colors cursor-pointer"
              >
                <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
                <Wifi className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Online</span>
              </button>
            ) : (
              <button
                onClick={onToggleSimulatedNetwork}
                title="Click to restore online network"
                className="flex items-center gap-1 text-[11px] font-bold bg-amber-950/80 text-amber-300 border border-amber-600/50 px-2 py-1 rounded-lg transition-colors cursor-pointer"
              >
                <WifiOff className="w-3.5 h-3.5 text-amber-400" />
                <span>{queuedCount > 0 ? `${queuedCount} Q` : 'Offline'}</span>
              </button>
            )}
          </div>

          {/* Sync Button (if queued offline items) */}
          {queuedCount > 0 && (
            <button
              onClick={onSync}
              disabled={isSyncing || !effectiveOnline}
              className={`flex items-center gap-1 text-[11px] font-bold px-2 py-1 rounded-lg border transition-all ${
                effectiveOnline 
                  ? 'bg-green-600 hover:bg-green-500 text-white border-green-500 animate-bounce' 
                  : 'bg-neutral-800 text-neutral-400 border-neutral-700 cursor-not-allowed'
              }`}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
              <span>Sync</span>
            </button>
          )}

          {/* Daraja Config / Simulation Badge */}
          <button
            onClick={onOpenDarajaConfig}
            title="Daraja M-Pesa Settings"
            className={`flex items-center gap-1 text-[11px] font-bold px-2 py-1 rounded-lg border transition-colors ${
              isSimulated 
                ? 'bg-neutral-900 hover:bg-neutral-800 text-emerald-400 border-neutral-700' 
                : 'bg-green-950/60 text-green-300 border-green-700'
            }`}
          >
            <Radio className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{isSimulated ? 'M-Pesa Sim' : 'Daraja Live'}</span>
          </button>

          {/* View Switcher: Conductor vs SACCO Owner */}
          <button
            onClick={() => onChangeViewMode(viewMode === 'conductor' ? 'admin' : 'conductor')}
            title="Switch between Conductor and SACCO Owner View"
            className="flex items-center gap-1 text-[11px] font-bold bg-neutral-800 hover:bg-neutral-700 text-neutral-200 border border-neutral-700 px-2 py-1 rounded-lg transition-colors"
          >
            <ShieldCheck className="w-3.5 h-3.5 text-green-400" />
            <span className="hidden md:inline">{viewMode === 'conductor' ? 'Owner Portal' : 'Konda Screen'}</span>
          </button>

          {/* Language Toggle */}
          <button
            onClick={onToggleLang}
            className="flex items-center gap-1 text-[11px] font-bold bg-neutral-900 hover:bg-neutral-800 text-neutral-300 border border-neutral-700 px-2 py-1 rounded-lg transition-colors"
          >
            <Globe className="w-3.5 h-3.5 text-neutral-400" />
            <span>{lang === 'sw' ? '🇰🇪 SWA' : '🇬🇧 ENG'}</span>
          </button>

          {/* Logout */}
          {conductor && (
            <button
              onClick={onLogout}
              title={t.logout}
              className="p-1.5 text-neutral-400 hover:text-red-400 hover:bg-neutral-900 rounded-lg transition-colors"
            >
              <LogOut className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </header>
  );
};
