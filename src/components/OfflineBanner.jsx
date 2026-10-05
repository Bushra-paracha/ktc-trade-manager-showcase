import { useEffect, useState } from 'react';
import { WifiOff } from 'lucide-react';

// Shown while the device has no connection. Pages keep showing the last data
// they loaded (saved by the service worker); saving changes needs a connection.
export default function OfflineBanner() {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));

  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);

  if (online) return null;
  return (
    <div className="offline-banner" role="status">
      <WifiOff size={16} aria-hidden="true" />
      <span>You're offline. Showing the last saved information; changes will need a connection.</span>
    </div>
  );
}
