import React, { useState, useEffect, useCallback } from 'react';
import { Header } from './components/Header';
import { LoginScreen } from './components/LoginScreen';
import { StartShiftModal } from './components/StartShiftModal';
import { ChargeScreen } from './components/ChargeScreen';
import { ShiftSummaryModal } from './components/ShiftSummaryModal';
import { AdminDashboard } from './components/AdminDashboard';
import { DarajaSettingsModal } from './components/DarajaSettingsModal';
import { Conductor, Shift, Language, ShiftReconciliation } from './types';
import { getTranslation } from './lib/translations';
import { soundFx } from './lib/audio';
import { getQueuedFares, syncOfflineQueueToServer } from './lib/offlineQueue';
import { PlayCircle, Bus, PlusCircle, ShieldAlert } from 'lucide-react';

export default function App() {
  // Authentication & Conductor State
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('fareflow_token'));
  const [conductor, setConductor] = useState<Conductor | null>(() => {
    const saved = localStorage.getItem('fareflow_conductor');
    return saved ? JSON.parse(saved) : null;
  });

  // Active Shift State
  const [activeShift, setActiveShift] = useState<Shift | null>(null);
  const [isLoadingShift, setIsLoadingShift] = useState<boolean>(false);

  // Connectivity & Offline Queue State
  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);
  const [simulatedOffline, setSimulatedOffline] = useState<boolean>(false);
  const [queuedCount, setQueuedCount] = useState<number>(0);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);

  // UI Navigation & Preferences
  const [lang, setLang] = useState<Language>(() => {
    return (localStorage.getItem('fareflow_lang') as Language) || 'sw';
  });
  const [viewMode, setViewMode] = useState<'conductor' | 'admin'>('conductor');

  // Modals
  const [isStartShiftOpen, setIsStartShiftOpen] = useState<boolean>(false);
  const [isEndShiftOpen, setIsEndShiftOpen] = useState<boolean>(false);
  const [shiftToEnd, setShiftToEnd] = useState<Shift | null>(null);
  const [isDarajaConfigOpen, setIsDarajaConfigOpen] = useState<boolean>(false);
  const [isSimulatedGateway, setIsSimulatedGateway] = useState<boolean>(true);

  // Sync queued fares counter
  const refreshQueueCount = useCallback(async () => {
    try {
      const queued = await getQueuedFares();
      setQueuedCount(queued.length);
    } catch (e) {
      console.warn(e);
    }
  }, []);

  // Fetch active shift from API
  const fetchActiveShift = useCallback(async (authToken = token) => {
    if (!authToken) return;
    setIsLoadingShift(true);
    try {
      const res = await fetch('/api/shifts/active', {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      const data = await res.json();
      if (res.ok && data.activeShift) {
        setActiveShift(data.activeShift);
      } else {
        setActiveShift(null);
      }
    } catch (err) {
      console.warn('[Fetch Shift Error]', err);
    } finally {
      setIsLoadingShift(false);
    }
  }, [token]);

  // Check Daraja Gateway status
  useEffect(() => {
    fetch('/api/daraja/config')
      .then(r => r.json())
      .then(d => setIsSimulatedGateway(d.simulated ?? true))
      .catch(() => {});
  }, []);

  // Monitor real browser network events + periodic queue count
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      refreshQueueCount();
      // Auto sync when network returns
      if (token && !simulatedOffline) {
        handleManualSync();
      }
    };
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    refreshQueueCount();
    const interval = setInterval(refreshQueueCount, 6000);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      clearInterval(interval);
    };
  }, [token, simulatedOffline]);

  // Load shift on token update
  useEffect(() => {
    if (token) {
      fetchActiveShift();
    }
  }, [token, fetchActiveShift]);

  // Handle Login
  const handleLogin = (newToken: string, newConductor: Conductor) => {
    setToken(newToken);
    setConductor(newConductor);
    localStorage.setItem('fareflow_token', newToken);
    localStorage.setItem('fareflow_conductor', JSON.stringify(newConductor));
    fetchActiveShift(newToken);
  };

  // Handle Logout
  const handleLogout = () => {
    soundFx.playTap();
    setToken(null);
    setConductor(null);
    setActiveShift(null);
    localStorage.removeItem('fareflow_token');
    localStorage.removeItem('fareflow_conductor');
  };

  // Toggle Language
  const handleToggleLang = () => {
    soundFx.playTap();
    const nextLang: Language = lang === 'sw' ? 'en' : 'sw';
    setLang(nextLang);
    localStorage.setItem('fareflow_lang', nextLang);
  };

  // Toggle Simulated Offline (for manual evaluation of offline resilience)
  const handleToggleSimulatedOffline = () => {
    soundFx.playTap();
    setSimulatedOffline(prev => !prev);
  };

  // Trigger manual offline queue sync
  const handleManualSync = async () => {
    if (!token) return;
    setIsSyncing(true);
    soundFx.playTap();

    try {
      const result = await syncOfflineQueueToServer(token);
      if (result.success && result.syncedCount > 0) {
        soundFx.playMpesaSuccess();
        fetchActiveShift();
      }
      await refreshQueueCount();
    } catch (e) {
      soundFx.playErrorBeep();
    } finally {
      setIsSyncing(false);
    }
  };

  const t = getTranslation(lang);
  const effectiveOnline = isOnline && !simulatedOffline;

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 flex flex-col font-sans selection:bg-green-600 selection:text-white">
      {/* Top App Header */}
      <Header
        conductor={conductor}
        activeShift={activeShift}
        isOnline={isOnline}
        simulatedOffline={simulatedOffline}
        queuedCount={queuedCount}
        isSyncing={isSyncing}
        onSync={handleManualSync}
        lang={lang}
        onToggleLang={handleToggleLang}
        viewMode={viewMode}
        onChangeViewMode={(mode) => {
          soundFx.playTap();
          setViewMode(mode);
        }}
        onLogout={handleLogout}
        onOpenDarajaConfig={() => setIsDarajaConfigOpen(true)}
        isSimulated={isSimulatedGateway}
        onToggleSimulatedNetwork={handleToggleSimulatedOffline}
      />

      {/* Offline Alert Banner if Simulated / Real Offline */}
      {!effectiveOnline && (
        <div className="bg-amber-950/90 border-b border-amber-700/60 text-amber-200 px-4 py-2 text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping"></span>
            <span>
              {lang === 'sw' 
                ? 'Hali ya Offline: Fares zote za Cash zitawekwa kwenye hifadhi ya simu (IndexedDB) na kusawazishwa mtandao ukirudi.'
                : 'Offline Mode: All cash fares are stored in local IndexedDB and reconciled automatically when reconnected.'}
            </span>
          </div>
          <button
            onClick={handleToggleSimulatedOffline}
            className="text-[11px] underline font-bold hover:text-white cursor-pointer ml-2"
          >
            {simulatedOffline ? 'Resume Online' : 'Dismiss'}
          </button>
        </div>
      )}

      {/* Main Content Area */}
      <main className="flex-1 pb-8">
        {/* VIEW 1: SACCO / VEHICLE OWNER PORTAL */}
        {viewMode === 'admin' ? (
          <AdminDashboard
            lang={lang}
            onBackToConductor={() => setViewMode('conductor')}
          />
        ) : !token ? (
          /* VIEW 2: LOGIN SCREEN */
          <LoginScreen
            onLogin={handleLogin}
            lang={lang}
          />
        ) : !activeShift && !isLoadingShift ? (
          /* VIEW 3: NO ACTIVE SHIFT (PROMPT TO START SHIFT) */
          <div className="min-h-[calc(100vh-140px)] flex items-center justify-center p-4">
            <div className="bg-neutral-900 border border-neutral-800 rounded-3xl p-6 sm:p-8 max-w-md w-full text-center shadow-2xl space-y-5">
              <div className="w-16 h-16 bg-green-600/20 text-green-400 border border-green-500/30 rounded-2xl mx-auto flex items-center justify-center">
                <Bus className="w-9 h-9" />
              </div>
              <div>
                <h2 className="text-2xl font-black text-white">
                  {lang === 'sw' ? `Hujambo, ${conductor?.name || 'Konda'}!` : `Welcome, ${conductor?.name || 'Conductor'}!`}
                </h2>
                <p className="text-xs text-neutral-400 mt-1">
                  {lang === 'sw' 
                    ? 'Bado hujaanza shift ya leo. Chagua gari na route kuanza kutoza nauli.'
                    : 'You have no active shift. Choose your vehicle and route to begin fare collection.'}
                </p>
              </div>

              <button
                onClick={() => {
                  soundFx.playTap();
                  setIsStartShiftOpen(true);
                }}
                className="w-full h-14 bg-green-600 hover:bg-green-500 active:scale-[0.98] text-white font-black text-base rounded-2xl shadow-xl shadow-green-900/40 flex items-center justify-center gap-2 cursor-pointer transition-all"
              >
                <PlusCircle className="w-5 h-5" />
                <span>{t.startShiftBtn}</span>
              </button>
            </div>
          </div>
        ) : activeShift ? (
          /* VIEW 4: ACTIVE CONDUCTOR CHARGE INTERFACE */
          <ChargeScreen
            shift={activeShift}
            token={token}
            lang={lang}
            isOnline={effectiveOnline}
            onRefreshShift={() => fetchActiveShift()}
            onOpenEndShift={() => {
              setShiftToEnd(activeShift);
              setIsEndShiftOpen(true);
            }}
            onOfflineFareQueued={refreshQueueCount}
          />
        ) : (
          <div className="p-8 text-center text-neutral-400 font-mono text-xs">
            Loading active shift...
          </div>
        )}
      </main>

      {/* MODALS */}
      {/* 1. Start Shift Modal */}
      {isStartShiftOpen && token && (
        <StartShiftModal
          token={token}
          lang={lang}
          onShiftStarted={(newShift) => {
            setActiveShift(newShift);
            setIsStartShiftOpen(false);
          }}
        />
      )}

      {/* 2. End Shift & Reconciliation Modal */}
      {isEndShiftOpen && shiftToEnd && token && (
        <ShiftSummaryModal
          shift={shiftToEnd}
          token={token}
          lang={lang}
          onClose={() => {
            setIsEndShiftOpen(false);
            setShiftToEnd(null);
            fetchActiveShift();
          }}
          onShiftEnded={() => {
            // Keep shiftToEnd preserved for receipt viewing/printing, but clear running background shift
            setActiveShift(null);
          }}
        />
      )}

      {/* 3. Daraja / Simulation Configuration Modal */}
      {isDarajaConfigOpen && (
        <DarajaSettingsModal
          onClose={() => setIsDarajaConfigOpen(false)}
          onConfigSaved={(isSim) => setIsSimulatedGateway(isSim)}
        />
      )}
    </div>
  );
}
