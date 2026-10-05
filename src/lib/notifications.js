// Helpers for the notification preferences stored on profiles.

export function notificationValues(profile = {}) {
  return {
    notify_email: profile.notify_email || '',
    notify_whatsapp: profile.notify_whatsapp || '',
    notify_new_inquiry: profile.notify_new_inquiry ?? true,
    notify_overdue: profile.notify_overdue ?? true,
    daily_digest: profile.daily_digest ?? true,
    digest_hour: profile.digest_hour ?? 8,
    time_zone: profile.time_zone || 'Asia/Karachi',
  };
}

// Blank contact fields are saved as null so no alerts go to that channel.
export function notificationPayload(values) {
  return {
    ...values,
    notify_email: values.notify_email.trim() || null,
    notify_whatsapp: values.notify_whatsapp.trim() || null,
    digest_hour: Number(values.digest_hour),
  };
}
