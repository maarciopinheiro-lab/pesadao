import { initAuthCreds, BufferJSON, proto, AuthenticationState, AuthenticationCreds, SignalDataTypeMap } from '@whiskeysockets/baileys';
import { SupabaseClient } from '@supabase/supabase-js';

// Global in-memory cache to prevent race conditions during rapid Baileys handshakes
export const memCache = new Map<string, any>();

// Sanitize key IDs similarly to Baileys multi-file-auth-state to prevent SQL/JSON string mismatch
export const sanitizeKey = (type: string, id: string | number): string => {
  const cleanId = String(id).replace(/\//g, '__').replace(/:/g, '-');
  return `${type}-${cleanId}`;
};

export const useSupabaseAuthState = async (
  supabase: SupabaseClient
): Promise<{ 
  state: AuthenticationState; 
  saveCreds: () => Promise<void>; 
  clearState: () => Promise<void>;
  hasSavedAuth: () => Promise<boolean>;
}> => {
  
  const writeData = async (data: any, id: string) => {
    try {
      memCache.set(id, data);
      const informationToStore = JSON.parse(JSON.stringify(data, BufferJSON.replacer));
      await supabase
        .from('whatsapp_auth')
        .upsert({ id, data: informationToStore, updated_at: new Date().toISOString() });
    } catch (error) {
      console.error(`[WhatsAppAuth] Erro gravando chave ${id} no Supabase:`, error);
    }
  };

  const readData = async (id: string) => {
    try {
      if (memCache.has(id)) {
        return memCache.get(id);
      }
      const { data, error } = await supabase
        .from('whatsapp_auth')
        .select('data')
        .eq('id', id)
        .maybeSingle();

      if (error || !data || !data.data) return null;

      const parsed = JSON.parse(JSON.stringify(data.data), BufferJSON.reviver);
      memCache.set(id, parsed);
      return parsed;
    } catch (error) {
      return null;
    }
  };

  const clearState = async () => {
    try {
      memCache.clear();
      const { data } = await supabase.from('whatsapp_auth').select('id');
      if (data && data.length > 0) {
        const ids = data.map((r: any) => r.id);
        for (let i = 0; i < ids.length; i += 50) {
          const chunk = ids.slice(i, i + 50);
          await supabase.from('whatsapp_auth').delete().in('id', chunk);
        }
      }
      console.log('[WhatsAppAuth] Estado de autenticação limpo do Supabase e memória.');
    } catch (error) {
      console.error('[WhatsAppAuth] Erro ao limpar estado de autenticação:', error);
    }
  };

  let creds: AuthenticationCreds;
  const savedCreds = await readData('creds');
  if (savedCreds && savedCreds.noiseKey) {
    creds = savedCreds;
  } else {
    creds = initAuthCreds();
    await writeData(creds, 'creds');
  }

  const hasSavedAuth = async (): Promise<boolean> => {
    const currentCreds = await readData('creds');
    return Boolean(currentCreds && currentCreds.me && currentCreds.me.id);
  };

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data: { [id: string]: any } = {};
          const missingKeys: { rawId: string; sanitizedKey: string }[] = [];

          // 1. Verificar cache em memória primeiro (Instantâneo)
          for (const rawId of ids) {
            const sanitizedKey = sanitizeKey(type, rawId);
            if (memCache.has(sanitizedKey)) {
              let value = memCache.get(sanitizedKey);
              if (type === 'app-state-sync-key' && value) {
                value = proto.Message.AppStateSyncKeyData.fromObject(value);
              }
              data[rawId] = value;
            } else {
              missingKeys.push({ rawId, sanitizedKey });
            }
          }

          // 2. Para chaves não encontradas na memória, buscar em lote no Supabase
          if (missingKeys.length > 0) {
            try {
              const keysToQuery = missingKeys.map(k => k.sanitizedKey);
              const { data: dbRows, error } = await supabase
                .from('whatsapp_auth')
                .select('id, data')
                .in('id', keysToQuery);

              if (!error && dbRows) {
                const dbMap = new Map<string, any>();
                for (const row of dbRows) {
                  if (row.data) {
                    const parsed = JSON.parse(JSON.stringify(row.data), BufferJSON.reviver);
                    dbMap.set(row.id, parsed);
                    memCache.set(row.id, parsed);
                  }
                }

                for (const missing of missingKeys) {
                  let value = dbMap.get(missing.sanitizedKey) || null;
                  if (type === 'app-state-sync-key' && value) {
                    value = proto.Message.AppStateSyncKeyData.fromObject(value);
                  }
                  data[missing.rawId] = value;
                }
              }
            } catch (err) {
              console.error(`[WhatsAppAuth] Erro ao carregar chaves em lote (${type}):`, err);
            }
          }

          return data;
        },
        set: async (data) => {
          const toUpsert: { id: string; data: any; updated_at: string }[] = [];
          const toDelete: string[] = [];

          for (const category in data) {
            for (const id in data[category as keyof SignalDataTypeMap]) {
              const value = data[category as keyof SignalDataTypeMap]?.[id];
              const sanitizedKey = sanitizeKey(category, id);
              if (value) {
                memCache.set(sanitizedKey, value);
                const informationToStore = JSON.parse(JSON.stringify(value, BufferJSON.replacer));
                toUpsert.push({
                  id: sanitizedKey,
                  data: informationToStore,
                  updated_at: new Date().toISOString()
                });
              } else {
                memCache.delete(sanitizedKey);
                toDelete.push(sanitizedKey);
              }
            }
          }

          if (toUpsert.length > 0) {
            for (let i = 0; i < toUpsert.length; i += 50) {
              const chunk = toUpsert.slice(i, i + 50);
              try {
                const { error } = await supabase.from('whatsapp_auth').upsert(chunk);
                if (error) {
                  console.error('[WhatsAppAuth] Erro em batch upsert de chaves:', error.message);
                }
              } catch (err) {
                console.error('[WhatsAppAuth] Exceção em batch upsert de chaves:', err);
              }
            }
          }

          if (toDelete.length > 0) {
            for (let i = 0; i < toDelete.length; i += 50) {
              const chunk = toDelete.slice(i, i + 50);
              try {
                const { error } = await supabase.from('whatsapp_auth').delete().in('id', chunk);
                if (error) {
                  console.error('[WhatsAppAuth] Erro em batch delete de chaves:', error.message);
                }
              } catch (err) {
                console.error('[WhatsAppAuth] Exceção em batch delete de chaves:', err);
              }
            }
          }
        }
      }
    },
    saveCreds: async () => {
      await writeData(creds, 'creds');
    },
    clearState,
    hasSavedAuth
  };
};
