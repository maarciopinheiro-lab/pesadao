import { initAuthCreds, BufferJSON, proto, AuthenticationState, AuthenticationCreds, SignalDataTypeMap } from '@whiskeysockets/baileys';
import { SupabaseClient } from '@supabase/supabase-js';

const KEY_MAP: { [T in keyof SignalDataTypeMap]: string } = {
  'pre-key': 'preKeys',
  'session': 'sessions',
  'sender-key': 'senderKeys',
  'app-state-sync-key': 'appStateSyncKeys',
  'app-state-sync-version': 'appStateVersions',
  'sender-key-memory': 'senderKeyMemory'
};

// Global mem cache to prevent race conditions during rapid Baileys restarts
export const memCache = new Map<string, any>();

export const useSupabaseAuthState = async (
  supabase: SupabaseClient
): Promise<{ state: AuthenticationState; saveCreds: () => Promise<void>; clearState: () => Promise<void> }> => {
  
  const writeData = async (data: any, id: string) => {
    try {
      memCache.set(id, data);
      const informationToStore = JSON.parse(JSON.stringify(data, BufferJSON.replacer));
      await supabase
        .from('whatsapp_auth')
        .upsert({ id, data: informationToStore, updated_at: new Date().toISOString() });
    } catch (error) {
      console.error('Error writing auth state to Supabase:', error);
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
        .single();
      if (error || !data) return null;
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
      console.error('Error removing auth state from Supabase:', error);
    }
  };
  
  const clearState = async () => {
    try {
      memCache.clear();
      const { data } = await supabase.from('whatsapp_auth').select('id');
      if (data) {
        for (const row of data) {
           await removeData(row.id);
        }
      }
    } catch (error) {}
  };

  const credsData = await readData('creds');
  const creds: AuthenticationCreds = credsData || initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data: { [id: string]: any } = {};
          await Promise.all(
            ids.map(async (id) => {
              let value = await readData(`${KEY_MAP[type]}-${id}`);
              if (type === 'app-state-sync-key' && value) {
                value = proto.Message.AppStateSyncKeyData.fromObject(value);
              }
              data[id] = value;
            })
          );
          return data;
        },
        set: async (data) => {
          const tasks: Promise<void>[] = [];
          for (const category in data) {
            for (const id in data[category as keyof SignalDataTypeMap]) {
              const value = data[category as keyof SignalDataTypeMap]?.[id];
              const key = `${KEY_MAP[category as keyof SignalDataTypeMap]}-${id}`;
              if (value) {
                tasks.push(writeData(value, key));
              } else {
                tasks.push(removeData(key));
              }
            }
          }
          await Promise.all(tasks);
        }
      }
    },
    saveCreds: () => writeData(creds, 'creds'),
    clearState
  };
};
