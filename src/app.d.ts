import type { SupabaseClient, Session, User } from '@supabase/supabase-js';
import type { Locale } from '$lib/i18n/locale';

declare global {
  namespace App {
    interface Locals {
      supabase: SupabaseClient;
      safeGetSession: () => Promise<{ session: Session | null; user: User | null }>;
      session: Session | null;
      user: User | null;
      locale: Locale;
    }
    interface PageData {
      session: Session | null;
      locale?: Locale;
    }
    // interface Error {}
    // interface Platform {}
  }
}

export {};
