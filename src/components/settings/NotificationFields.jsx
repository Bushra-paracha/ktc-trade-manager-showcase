// Notification preferences on profiles (sent by the staff-notifier Edge Function).
const TIME_ZONES = [
  ['Asia/Karachi', 'Pakistan (Karachi)'],
  ['Asia/Dubai', 'UAE (Dubai)'],
  ['Asia/Riyadh', 'Saudi Arabia (Riyadh)'],
  ['Asia/Kuala_Lumpur', 'Malaysia (Kuala Lumpur)'],
  ['Asia/Manila', 'Philippines (Manila)'],
  ['Asia/Shanghai', 'China (Shanghai)'],
  ['Europe/London', 'UK (London)'],
  ['America/Toronto', 'Canada (Toronto / Waterloo)'],
  ['America/New_York', 'US East (New York)'],
];

function hourLabel(hour) {
  const suffix = hour < 12 ? 'AM' : 'PM';
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h}:00 ${suffix}`;
}

const labelStyle = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12.5, color: 'var(--color-ink-soft)', fontWeight: 600 };
const checkStyle = { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, color: 'var(--color-ink)' };

export default function NotificationFields({ values, onChange }) {
  const set = (field, value) => onChange({ ...values, [field]: value });
  const deviceZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const zones = TIME_ZONES.some(([zone]) => zone === values.time_zone) ? TIME_ZONES : [...TIME_ZONES, [values.time_zone, values.time_zone]];
  const zoneOptions = zones.some(([zone]) => zone === deviceZone) ? zones : [...zones, [deviceZone, `${deviceZone} (this device)`]];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <label style={labelStyle}>
        Email for alerts
        <input className="select-input" type="email" placeholder="name@example.com" value={values.notify_email}
          onChange={(e) => set('notify_email', e.target.value)} />
      </label>
      <label style={labelStyle}>
        WhatsApp for alerts (with country code)
        <input className="select-input" type="tel" placeholder="+92 300 0000000" value={values.notify_whatsapp}
          onChange={(e) => set('notify_whatsapp', e.target.value)} />
      </label>
      <label style={checkStyle}>
        <input type="checkbox" checked={values.notify_new_inquiry} onChange={(e) => set('notify_new_inquiry', e.target.checked)} />
        New inquiries and buyer messages, as they arrive
      </label>
      <label style={checkStyle}>
        <input type="checkbox" checked={values.notify_overdue} onChange={(e) => set('notify_overdue', e.target.checked)} />
        A reply to a buyer is overdue
      </label>
      <label style={checkStyle}>
        <input type="checkbox" checked={values.daily_digest} onChange={(e) => set('daily_digest', e.target.checked)} />
        Morning summary of what needs attention
      </label>
      {values.daily_digest && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
          <label style={labelStyle}>
            Send the summary at
            <select className="select-input" value={values.digest_hour} onChange={(e) => set('digest_hour', Number(e.target.value))}>
              {Array.from({ length: 24 }, (_, hour) => <option key={hour} value={hour}>{hourLabel(hour)}</option>)}
            </select>
          </label>
          <label style={labelStyle}>
            Time zone
            <select className="select-input" value={values.time_zone} onChange={(e) => set('time_zone', e.target.value)}>
              {zoneOptions.map(([zone, label]) => <option key={zone} value={zone}>{label}</option>)}
            </select>
          </label>
        </div>
      )}
    </div>
  );
}
