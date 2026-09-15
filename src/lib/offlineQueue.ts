import { OfflineQueuedFare } from '../types';

const DB_NAME = 'FareFlowOfflineDB';
const DB_VERSION = 1;
const STORE_NAME = 'offline_fares';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      return reject(new Error('IndexedDB not supported in this browser.'));
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'client_tx_id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function queueOfflineFare(fare: OfflineQueuedFare): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.put(fare);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function getQueuedFares(): Promise<OfflineQueuedFare[]> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn('[OfflineQueue] Could not read IndexedDB:', err);
    return [];
  }
}

export async function removeSyncedFares(clientTxIds: string[]): Promise<void> {
  if (clientTxIds.length === 0) return;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    clientTxIds.forEach((id) => store.delete(id));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function syncOfflineQueueToServer(
  token: string
): Promise<{ success: boolean; syncedCount: number; message: string }> {
  const queued = await getQueuedFares();
  if (queued.length === 0) {
    return { success: true, syncedCount: 0, message: 'No offline items to sync.' };
  }

  try {
    const res = await fetch('/api/sync', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ transactions: queued }),
    });

    const data = await res.json();
    if (data.success) {
      if (Array.isArray(data.processed_ids) && data.processed_ids.length > 0) {
        await removeSyncedFares(data.processed_ids);
      }
      return {
        success: true,
        syncedCount: data.synced_count || 0,
        message: data.message || `Successfully synced ${data.synced_count} fares!`,
      };
    } else {
      throw new Error(data.error || 'Server error during sync.');
    }
  } catch (err: any) {
    console.error('[Offline Sync Error]', err);
    return {
      success: false,
      syncedCount: 0,
      message: err.message || 'Could not connect to server to sync.',
    };
  }
}
