import { optionalProp } from './config';

/** Optional "you were added" email. Enabled with script property SEND_EMAILS=true. */
export function notifyAdded(to: string, adderName: string, groupName: string): void {
  if (optionalProp('SEND_EMAILS') !== 'true') return;
  const appUrl = optionalProp('APP_URL');
  try {
    MailApp.sendEmail({
      to,
      subject: `${adderName} added you to "${groupName}" on FairShare`,
      htmlBody:
        `<p>${escapeHtml(adderName)} added you to the group <b>${escapeHtml(groupName)}</b> on FairShare.</p>` +
        (appUrl ? `<p><a href="${appUrl}">Open FairShare</a> and sign in with this Google account.</p>` : ''),
      name: 'FairShare',
    });
  } catch (e) {
    console.warn('Email failed', e);
  }
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
