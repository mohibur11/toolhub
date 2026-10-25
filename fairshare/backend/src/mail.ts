import type { User } from '../../shared/types';
import { optionalProp } from './config';

/**
 * "You were added to a group" email, sent from the owner's Gmail as "FairShare".
 * On by default; set script property SEND_EMAILS=false to turn it off.
 * Replies go to the person who added them. Never blocks or fails the request that triggered it.
 */
export function notifyAdded(to: string, adder: User, groupName: string): void {
  if (optionalProp('SEND_EMAILS') === 'false' || to === adder.email) return;
  try {
    // Consumer Gmail accounts can send ~100 emails/day from Apps Script.
    if (MailApp.getRemainingDailyQuota() < 1) {
      console.warn(`Daily email quota used up; not emailing ${to}`);
      return;
    }
    const appUrl = optionalProp('APP_URL');
    const name = escapeHtml(adder.name);
    const group = escapeHtml(groupName);
    MailApp.sendEmail({
      to,
      replyTo: adder.email,
      name: 'FairShare',
      subject: `${adder.name} added you to "${groupName}" on FairShare`,
      body:
        `${adder.name} (${adder.email}) added you to the group "${groupName}" on FairShare, ` +
        `a free app for splitting shared expenses.\n\n` +
        (appUrl ? `Open it here and sign in with this Google account (${to}):\n${appUrl}\n\n` : '') +
        `You don't need to install anything or create an account.`,
      htmlBody: `
<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#0f172a">
  <div style="font-size:20px;font-weight:700;color:#059669;margin-bottom:16px">FairShare</div>
  <p style="font-size:16px;line-height:1.5;margin:0 0 12px">
    <b>${name}</b> added you to the group <b>${group}</b>.
  </p>
  <p style="font-size:14px;line-height:1.5;color:#475569;margin:0 0 20px">
    FairShare tracks shared expenses for trips and events and shows who owes whom.
    Nothing to install. Sign in with this Google account (${escapeHtml(to)}).
  </p>
  ${
    appUrl
      ? `<a href="${escapeHtml(appUrl)}" style="display:inline-block;background:#059669;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:10px">Open ${group}</a>`
      : ''
  }
  <p style="font-size:12px;color:#94a3b8;margin-top:28px">
    You received this because ${name} (${escapeHtml(adder.email)}) added your email to a FairShare group.
    Reply to this email to reach them.
  </p>
</div>`,
    });
  } catch (e) {
    console.warn(`Email to ${to} failed`, e instanceof Error ? e.message : String(e));
  }
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
