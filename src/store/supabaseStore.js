import { getSupabase } from '../rag/vectorStore.js';

/** Supabase-backed store for sessions, leads and message logs (CB-08, CB-09, CB-19, CB-20). */
export function createSupabaseStore(supabase = getSupabase()) {
  const check = (res, what) => {
    if (res.error) throw new Error(`${what} failed: ${res.error.message}`);
    return res.data;
  };
  return {
    kind: 'supabase',
    async getSession(userKey) {
      const data = check(
        await supabase.from('chat_sessions').select('state, updated_at').eq('user_key', userKey).maybeSingle(),
        'getSession',
      );
      return data ? { ...data.state, updatedAt: Date.parse(data.updated_at) } : null;
    },
    async saveSession(userKey, state) {
      const { updatedAt, ...rest } = state;
      check(
        await supabase.from('chat_sessions').upsert({ user_key: userKey, state: rest, updated_at: new Date().toISOString() }),
        'saveSession',
      );
    },
    async saveLead(lead) {
      check(
        await supabase.from('leads').insert({
          user_key: lead.userKey,
          channel: lead.channel,
          name: lead.name,
          email: lead.email,
          phone: lead.phone,
          business_name: lead.businessName,
          service: lead.service,
          consent_at: lead.consentAt,
          privacy_notice: lead.privacyNotice,
          after_hours: lead.afterHours,
        }),
        'saveLead',
      );
    },
    async logMessage(e) {
      check(
        await supabase.from('message_logs').insert({
          user_key: e.userKey,
          channel: e.channel,
          text_redacted: e.text,
          intent: e.intent,
          rule_id: e.ruleId,
          route: e.route,
          sources: e.sources ?? [],
          escalated: Boolean(e.escalated),
          top_similarity: e.topSimilarity,
          flagged: e.flagged ?? null,
        }),
        'logMessage',
      );
    },
    async deleteUserData(userKey) {
      const data = check(await supabase.rpc('delete_user_data', { p_user_key: userKey }), 'deleteUserData');
      return data ?? {};
    },
  };
}
