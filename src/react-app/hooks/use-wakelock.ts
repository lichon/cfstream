import { useEffect, useRef } from 'react';

export function useWakeLock() {
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const wakeLockAcquired = useRef<boolean>(false);

  const request = async () => {
    if (!('wakeLock' in navigator)) return;
    
    try {
      if (wakeLockRef.current) wakeLockRef.current.release();
      // Reset the wake lock reference
      wakeLockRef.current = await navigator.wakeLock.request('screen');
      wakeLockAcquired.current = true;
      console.log('Wake Lock acquired');
    } catch (err) {
      console.error('Failed to acquire wake lock:', err);
    }
  };

  const release = async (byUser: boolean = true) => {
    if (byUser) wakeLockAcquired.current = false;
    if (!wakeLockRef.current) return;
    await wakeLockRef.current.release();
    wakeLockRef.current = null;
    console.log('Wake Lock released');
  };

  useEffect(() => {
    const handleVisibilityChange = async () => {
      if (document.visibilityState === 'visible' && wakeLockAcquired.current) {
        await request();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      release(false);
    };
  }, []);

  return { request, release };
}
