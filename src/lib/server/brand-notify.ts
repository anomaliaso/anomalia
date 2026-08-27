import type { SupabaseClient } from '@supabase/supabase-js';
import type { Locale } from '$lib/i18n/locale';
import { emailLocale } from './email-i18n';
import { sendEmail } from './email';
import { sendPushToUser } from './web-push';

/** Owner + collaborators as returned by `brandContacts`. */
export type BrandNotifyContact = {
	userId: string;
	email: string;
	locale: string | null;
};

export type BrandPushOpts = {
	title?: string;
	/** Static string, or per-locale. */
	body: string | ((locale: Locale) => string);
	url: string;
	tag: string;
};

type EmailBuild = (
	locale: Locale,
	to: string
) => {
	to: string;
	subject: string;
	html: string;
	text?: string;
	headers?: Record<string, string>;
};

/**
 * Fan-out Web Push to brand contacts. **Never throws** — push must never break email
 * (or any other caller). Soft-noops when VAPID is unset or the user has no subscription.
 *
 * Returns what actually went out: `sent` are the single device notifications, `reached` the
 * contacts that had at least one live subscription. Every existing caller ignores it — it exists
 * for the ones that have to tell a human "and I pinged your phone", which must not be said when
 * nobody had push enabled.
 */
export async function pushToBrandContacts(
	supabase: SupabaseClient,
	contacts: BrandNotifyContact[],
	push: BrandPushOpts
): Promise<{ sent: number; reached: number }> {
	let sent = 0;
	let reached = 0;
	try {
		await Promise.all(
			contacts.map(async (c) => {
				if (!c.userId) return;
				try {
					const locale = emailLocale(c.locale);
					const body = typeof push.body === 'function' ? push.body(locale) : push.body;
					const res = await sendPushToUser(supabase, c.userId, {
						title: push.title || 'Anomalia',
						body,
						url: push.url,
						tag: push.tag
					});
					if (res?.sent) {
						sent += res.sent;
						reached += 1;
					}
				} catch (e) {
					console.warn(
						'[brand-notify] push failed:',
						e instanceof Error ? e.message : e
					);
				}
			})
		);
	} catch (e) {
		console.warn(
			'[brand-notify] push fan-out failed:',
			e instanceof Error ? e.message : e
		);
	}
	return { sent, reached };
}

/**
 * Email brand contacts, then mirror with Web Push (best-effort).
 * Push runs **after** email and never affects the returned email count / never throws.
 */
export async function notifyBrandContacts(
	supabase: SupabaseClient,
	contacts: BrandNotifyContact[],
	opts: {
		buildEmail: EmailBuild;
		/**
		 * When set, each contact also gets a push after email.
		 * If `body` is omitted, the push body is that contact's email subject.
		 */
		push?: {
			title?: string;
			body?: string | ((locale: Locale) => string);
			url: string;
			tag: string;
		};
		logPrefix?: string;
	}
): Promise<number> {
	let emailed = 0;
	const subjects = new Map<string, string>();

	for (const c of contacts) {
		try {
			const locale = emailLocale(c.locale);
			const payload = opts.buildEmail(locale, c.email);
			await sendEmail(payload);
			emailed += 1;
			if (c.userId) subjects.set(c.userId, payload.subject);
		} catch (e) {
			console.error(
				`${opts.logPrefix ?? '[brand-notify]'} email to ${c.email} failed:`,
				e instanceof Error ? e.message : e
			);
		}
	}

	const push = opts.push;
	if (push?.url) {
		try {
			if (push.body) {
				await pushToBrandContacts(supabase, contacts, {
					title: push.title,
					body: push.body,
					url: push.url,
					tag: push.tag
				});
			} else {
				// One push per contact using the subject we just emailed them.
				await Promise.all(
					contacts.map(async (c) => {
						const subject = subjects.get(c.userId);
						if (!subject || !c.userId) return;
						try {
							await sendPushToUser(supabase, c.userId, {
								title: push.title || 'Anomalia',
								body: subject,
								url: push.url,
								tag: push.tag
							});
						} catch (e) {
							console.warn(
								'[brand-notify] push failed:',
								e instanceof Error ? e.message : e
							);
						}
					})
				);
			}
		} catch (e) {
			console.warn(
				'[brand-notify] push after email failed:',
				e instanceof Error ? e.message : e
			);
		}
	}

	return emailed;
}
