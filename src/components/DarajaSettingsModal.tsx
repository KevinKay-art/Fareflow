import React, { useState, useEffect } from 'react';
import { Radio, X, Check, Key, Shield, HelpCircle, Save } from 'lucide-react';
import { soundFx } from '../lib/audio';

interface DarajaSettingsModalProps {
  onClose: () => void;
  onConfigSaved?: (isSimulated: boolean) => void;
}

export const DarajaSettingsModal: React.FC<DarajaSettingsModalProps> = ({ onClose, onConfigSaved }) => {
  const [config, setConfig] = useState({
    simulated: true,
    consumerKey: '',
    consumerSecret: '',
    passkey: '',
    shortcode: '174379',
    callbackUrl: '',
  });
  const [isSaved, setIsSaved] = useState(false);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    fetch('/api/daraja/config')
      .then((r) => r.json())
      .then((data) => {
        if (data) {
          setConfig({
            simulated: data.simulated ?? true,
            consumerKey: data.consumerKey || '',
            consumerSecret: data.consumerSecret || '',
            passkey: data.passkey || '',
            shortcode: data.shortcode || '174379',
            callbackUrl: data.callbackUrl || '',
          });
        }
      })
      .catch((e) => console.warn(e));
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    soundFx.playTap();
    setIsSaving(true);
    setFeedbackMessage(null);
    setErrorMessage(null);

    try {
      const res = await fetch('/api/daraja/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        soundFx.playCashChime();
        setIsSaved(true);
        const modeLabel = config.simulated 
          ? 'Simulation Mode (Mock STK & test PIN)' 
          : `Live/Sandbox Daraja (Shortcode ${config.shortcode || '174379'})`;
        setFeedbackMessage(`✓ Configuration saved! Now active in: ${modeLabel}`);
        if (onConfigSaved) {
          onConfigSaved(config.simulated);
        }
        setTimeout(() => setIsSaved(false), 3500);
      } else {
        throw new Error(data.error || 'Server rejected settings');
      }
    } catch (e: any) {
      soundFx.playErrorBeep();
      setErrorMessage(e.message || 'Failed to reach server to save settings.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
      <div className="bg-neutral-900 border border-neutral-700 rounded-3xl w-full max-w-md p-6 shadow-2xl my-auto">
        <div className="flex items-center justify-between pb-3 mb-4 border-b border-neutral-800">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-green-600/20 text-green-400 border border-green-500/30 flex items-center justify-center font-bold">
              <Radio className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-black text-white">Safaricom Daraja Settings</h3>
              <p className="text-xs text-neutral-400">M-Pesa STK Push Gateway Integration</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 text-neutral-400 hover:text-white rounded-lg">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Success Banner */}
        {feedbackMessage && (
          <div className="mb-4 p-3 bg-green-950/90 border border-green-500 text-green-200 rounded-xl text-xs flex items-center gap-2 font-bold shadow-lg animate-in fade-in">
            <Check className="w-4 h-4 text-green-400 shrink-0" />
            <span>{feedbackMessage}</span>
          </div>
        )}

        {/* Error Banner */}
        {errorMessage && (
          <div className="mb-4 p-3 bg-red-950/90 border border-red-500 text-red-200 rounded-xl text-xs flex items-center gap-2 font-bold shadow-lg animate-in fade-in">
            <X className="w-4 h-4 text-red-400 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        <form onSubmit={handleSave} className="space-y-4 text-xs">
          {/* Simulation Mode Toggle */}
          <div className="bg-neutral-950 p-3.5 rounded-2xl border border-neutral-800 space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-bold text-white text-sm">Simulation Mode</div>
                <div className="text-[11px] text-neutral-400">
                  Enables instantaneous simulated M-Pesa STK push & test PIN buttons without requiring live Safaricom credentials.
                </div>
              </div>
              <input
                type="checkbox"
                checked={config.simulated}
                onChange={(e) => setConfig({ ...config, simulated: e.target.checked })}
                className="w-5 h-5 accent-green-500 cursor-pointer"
              />
            </div>
            {config.simulated && (
              <div className="text-[10px] text-green-400 font-mono bg-green-950/60 p-2 rounded-xl border border-green-800/40">
                ✓ Active: Mock STK Pushes with simulated customer PIN confirmation.
              </div>
            )}
          </div>

          {/* Live Daraja Credentials */}
          <div className={`space-y-3 transition-opacity ${config.simulated ? 'opacity-60' : 'opacity-100'}`}>
            <div className="text-[11px] font-bold text-neutral-300 uppercase tracking-wider">
              Safaricom Daraja API Keys (Optional)
            </div>

            <div>
              <label className="block text-[11px] text-neutral-400 font-bold mb-1">Business Shortcode (Paybill / Till)</label>
              <input
                type="text"
                value={config.shortcode}
                onChange={(e) => setConfig({ ...config, shortcode: e.target.value })}
                placeholder="174379"
                className="w-full bg-neutral-950 border border-neutral-700 rounded-xl px-3 py-2 text-white font-mono"
              />
            </div>

            <div>
              <label className="block text-[11px] text-neutral-400 font-bold mb-1">Consumer Key</label>
              <input
                type="text"
                value={config.consumerKey}
                onChange={(e) => setConfig({ ...config, consumerKey: e.target.value })}
                placeholder="Daraja App Consumer Key"
                className="w-full bg-neutral-950 border border-neutral-700 rounded-xl px-3 py-2 text-white font-mono"
              />
            </div>

            <div>
              <label className="block text-[11px] text-neutral-400 font-bold mb-1">Consumer Secret</label>
              <input
                type="password"
                value={config.consumerSecret}
                onChange={(e) => setConfig({ ...config, consumerSecret: e.target.value })}
                placeholder="Daraja App Consumer Secret"
                className="w-full bg-neutral-950 border border-neutral-700 rounded-xl px-3 py-2 text-white font-mono"
              />
            </div>

            <div>
              <label className="block text-[11px] text-neutral-400 font-bold mb-1">Passkey (Lipa na M-Pesa)</label>
              <input
                type="password"
                value={config.passkey}
                onChange={(e) => setConfig({ ...config, passkey: e.target.value })}
                placeholder="Online Passkey"
                className="w-full bg-neutral-950 border border-neutral-700 rounded-xl px-3 py-2 text-white font-mono"
              />
            </div>
          </div>

          <div className="flex gap-2 pt-2">
            <button
              type="submit"
              className="flex-1 h-11 bg-green-600 hover:bg-green-500 text-white font-bold rounded-xl flex items-center justify-center gap-1.5 cursor-pointer shadow-lg"
            >
              {isSaved ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
              <span>{isSaved ? 'Settings Saved!' : 'Save Configuration'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
