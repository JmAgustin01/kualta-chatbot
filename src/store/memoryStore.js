/** In-memory store: used by tests and local runs without Supabase. Same interface as supabaseStore. */
export function createMemoryStore() {
  const sessions = new Map();
  const leads = [];
  const logs = [];
  return {
    kind: 'memory',
    leads,
    logs,
    async getSession(userKey) {
      return sessions.get(userKey) ?? null;
    },
    async saveSession(userKey, state) {
      sessions.set(userKey, { ...state, updatedAt: Date.now() });
    },
    async saveLead(lead) {
      leads.push({ ...lead, createdAt: new Date().toISOString() });
    },
    async logMessage(entry) {
      logs.push({ ...entry, createdAt: new Date().toISOString() });
    },
    async deleteUserData(userKey) {
      const before = { leads: leads.length, logs: logs.length };
      for (let i = leads.length - 1; i >= 0; i--) if (leads[i].userKey === userKey) leads.splice(i, 1);
      for (let i = logs.length - 1; i >= 0; i--) if (logs[i].userKey === userKey) logs.splice(i, 1);
      sessions.delete(userKey);
      return { leads: before.leads - leads.length, logs: before.logs - logs.length };
    },
  };
}
