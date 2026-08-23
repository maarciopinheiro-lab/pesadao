import { initAuthCreds, BufferJSON, proto, AuthenticationState, AuthenticationCreds, SignalDataTypeMap } from '@whiskeysockets/baileys';
import { SupabaseClient } from '@supabase/supabase-js';

// Global in-memory cache to prevent race conditions during rapid Baileys handshakes
export const memCache = new Map<string, any>();

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

  const removeData = async (id: string) => {
    try {
      memCache.delete(id);
      await supabase.from('whatsapp_auth').delete().eq('id', id);
    } catch (error) {
      console.error(`[WhatsAppAuth] Erro removendo chave ${id} do Supabase:`, error);
    }
  };
  
  const clearState = async () => {
    try {
      memCache.clear();
      const { data } = await supabase.from('whatsapp_auth').select('id');
      if (data && data.length > 0) {
        const ids = data.map(r => r.id);
        // Batch delete in chunks of 50
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

  const credsData = await readData('creds');
  const creds: AuthenticationCreds = credsData || initAuthCreds();

  const hasSavedAuth = async (): Promise<boolean> => {
    const currentCreds = await readData('creds');
    return Boolean(currentCreds && (currentCreds.me || currentCreds.registered));
  };

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data: { [id: string]: any } = {};
          await Promise.all(
            ids.map(async (id) => {
              const key = `${type}-${id}`;
              let value = await readData(key);
              if (type === 'app-state-sync-key' && value) {
                value = proto.Message.AppStateSyncKeyData.fromObject(value);
              }
              data[id] = value;
            })
          );
          return data;
        },
        set: async (data) => {
          const toUpsert: { id: string; data: any; updated_at: string }[] = [];
          const toDelete: string[] = [];

          for (const category in data) {
            for (const id in data[category as keyof SignalDataTypeMap]) {
              const value = data[category as keyof SignalDataTypeMap]?.[id];
              const key = `${category}-${id}`;
              if (value) {
                memCache.set(key, value);
                const informationToStore = JSON.parse(JSON.stringify(value, BufferJSON.replacer));
                toUpsert.push({
                  id: key,
                  data: informationToStore,
                  updated_at: new Date().toISOString()
                });
              } else {
                memCache.delete(key);
                toDelete.push(key);
              }
            }
          }

          // Gravar em lotes de 50 para máxima velocidade e sem timeouts
          if (toUpsert.length > 0) {
            for (let i = 0; i < toUpsert.length; i += 50) {
              const chunk = toUpsert.slice(i, i + 50);
              await supabase.from('whatsapp_auth').upsert(chunk).catch(err => {
                console.error('[WhatsAppAuth] Erro em batch upsert de chaves:', err);
              });
            }
          }

          if (toDelete.length > 0) {
            for (let i = 0; i < toDelete.length; i += 50) {
              const chunk = toDelete.slice(i, i + 50);
              await supabase.from('whatsapp_auth').delete().in('id', chunk).catch(err => {
                console.error('[WhatsAppAuth] Erro em batch delete de chaves:', err);
              });
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

