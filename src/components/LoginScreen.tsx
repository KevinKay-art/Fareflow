import React, { useState } from 'react';
import { Bus, Smartphone, Lock, ArrowRight, UserCheck, Zap, AlertCircle } from 'lucide-react';
import { Language, Conductor } from '../types';
import { getTranslation } from '../lib/translations';
import { soundFx } from '../lib/audio';

interface LoginScreenProps {
  onLogin: (token: string, conductor: Conductor) => void;
  lang: Language;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({ onLogin, lang }) => {
  const t = getTranslation(lang);
  const [phone, setPhone] = useState('0712345678');
  const [pin, setPin] = useState('1234');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const demoConductors = [
    { name: 'Kiprono "Kevo" (047 Nganya SACCO)', phone: '0712345678', pin: '1234', route: 'Route 105: Rongai' },
    { name: 'Mwangi "Maina" (City Shuttle)', phone: '0722001122', pin: '2540', route: 'Route 44: Kahawa West' },
    { name: 'Amina "Mama Mat" (Forward Trav.)', phone: '0733998877', pin: '0000', route: 'Route 33: Pipeline' },
  ];

  const handleLogin = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!phone || !pin) {
      setErrorMessage(lang === 'sw' ? 'Tafadhali weka nambari na PIN' : 'Please enter Phone & PIN');
      soundFx.playErrorBeep();
      return;
    }

    setIsLoading(true);
    setErrorMessage('');
    soundFx.playTap();

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, pin }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Login failed');
      }

      soundFx.playCashChime();
      onLogin(data.token, data.conductor);
    } catch (err: any) {
      soundFx.playErrorBeep();
      setErrorMessage(err.message || 'Hitilafu ya kuingia');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelectDemo = (demoPhone: string, demoPin: string) => {
    soundFx.playTap();
    setPhone(demoPhone);
    setPin(demoPin);
    setErrorMessage('');
  };

  return (
    <div className="min-h-[calc(100vh-60px)] flex flex-col justify-center px-4 py-8 max-w-md mx-auto">
      {/* Brand Hero */}
      <div className="text-center mb-8">
        <div className="w-16 h-16 bg-gradient-to-br from-green-500 to-green-700 rounded-2xl mx-auto flex items-center justify-center shadow-xl shadow-green-950/50 mb-3 border border-green-400/30">
          <Bus className="w-9 h-9 text-white" />
        </div>
        <h1 className="text-3xl font-black tracking-tight text-white">
          FareFlow
        </h1>
        <p className="text-green-400 font-semibold text-sm mt-1">
          {lang === 'sw' ? 'Mfumo wa Nauli wa Makonda na Nganya' : 'Digital Matatu Fare & Shift Collection'}
        </p>
      </div>

      {/* Main Login Card */}
      <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6 shadow-2xl">
        <div className="flex items-center gap-2 mb-5 pb-3 border-b border-neutral-800">
          <Smartphone className="w-5 h-5 text-green-400" />
          <h2 className="text-lg font-bold text-white tracking-wide">
            {t.loginTitle}
          </h2>
        </div>

        {errorMessage && (
          <div className="mb-4 p-3 bg-red-950/60 border border-red-800 text-red-300 rounded-xl text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-4">
          {/* Phone Field */}
          <div>
            <label className="block text-xs font-bold text-neutral-300 uppercase tracking-wider mb-1.5">
              {t.phoneLabel}
            </label>
            <div className="relative">
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder={t.phonePlaceholder}
                className="w-full bg-neutral-950 border-2 border-neutral-700 focus:border-green-500 rounded-xl px-4 py-3.5 text-lg font-mono font-bold text-white outline-none transition-all placeholder:text-neutral-600"
                required
              />
            </div>
          </div>

          {/* PIN Field */}
          <div>
            <label className="block text-xs font-bold text-neutral-300 uppercase tracking-wider mb-1.5">
              {t.pinLabel}
            </label>
            <div className="relative">
              <input
                type="password"
                maxLength={4}
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                placeholder={t.pinPlaceholder}
                className="w-full bg-neutral-950 border-2 border-neutral-700 focus:border-green-500 rounded-xl px-4 py-3.5 text-2xl font-mono tracking-widest text-white outline-none transition-all text-center"
                required
              />
              <Lock className="w-4 h-4 text-neutral-500 absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
          </div>

          {/* Big Action Button */}
          <button
            type="submit"
            disabled={isLoading}
            className="w-full h-14 bg-green-600 hover:bg-green-500 active:scale-[0.98] text-white font-black text-lg rounded-xl shadow-lg shadow-green-900/40 flex items-center justify-center gap-2 transition-all mt-2 cursor-pointer disabled:opacity-50"
          >
            {isLoading ? (
              <span className="flex items-center gap-2">
                <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                Inathibitisha...
              </span>
            ) : (
              <>
                <span>{t.loginButton}</span>
                <ArrowRight className="w-5 h-5" />
              </>
            )}
          </button>
        </form>

        {/* Demo Conductors Quick Picker */}
        <div className="mt-6 pt-5 border-t border-neutral-800">
          <div className="flex items-center gap-1.5 text-xs font-bold text-neutral-400 mb-3 uppercase tracking-wider">
            <Zap className="w-3.5 h-3.5 text-amber-400" />
            <span>{t.demoAccounts}</span>
          </div>

          <div className="space-y-2">
            {demoConductors.map((c, i) => (
              <button
                key={i}
                type="button"
                onClick={() => handleSelectDemo(c.phone, c.pin)}
                className={`w-full text-left p-2.5 rounded-xl border transition-all flex items-center justify-between text-xs cursor-pointer ${
                  phone === c.phone 
                    ? 'bg-green-950/40 border-green-600 text-white shadow-sm' 
                    : 'bg-neutral-950/60 border-neutral-800 hover:border-neutral-700 text-neutral-300'
                }`}
              >
                <div>
                  <div className="font-bold text-neutral-200">{c.name}</div>
                  <div className="text-[11px] text-neutral-400 font-mono">
                    Tel: {c.phone} • PIN: {c.pin}
                  </div>
                </div>
                <div className="text-right">
                  <span className="text-[10px] bg-neutral-800 text-green-400 px-2 py-0.5 rounded font-bold">
                    {c.route}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
