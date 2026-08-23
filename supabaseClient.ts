
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { WhatsAppConfig, BillingSchedule } from './types';

// URL fornecida pelo usuário
export const SUPABASE_URL = 'https://udtjrhyblktpnbaynchw.supabase.co';
// Chave (Anon Public Key) fornecida pelo usuário
export const DEFAULT_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVkdGpyaHlibGt0cG5iYXluY2h3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ5MzEwMTEsImV4cCI6MjA4MDUwNzAxMX0.QgHFP-qaD_cZ_euwV41nxXsAwUpxjvg0QsWj43d0Qt8';

let supabaseInstance: SupabaseClient | null = null;

export const getSupabase = (): SupabaseClient | null => {
  if (supabaseInstance) return supabaseInstance;

  // Safe environment & storage extraction (evita ReferenceError: process is not defined em deploys estáticos como Netlify)
  let envKey: string | undefined;
  try {
    if (typeof import.meta !== 'undefined' && (import.meta as any).env) {
      envKey = (import.meta as any).env.VITE_SUPABASE_KEY;
    }
  } catch (e) {}

  if (!envKey) {
    try {
      if (typeof process !== 'undefined' && process.env) {
        envKey = process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
      }
    } catch (e) {}
  }

  let localKey: string | null = null;
  try {
    if (typeof localStorage !== 'undefined') {
      localKey = localStorage.getItem('sb_api_key');
    }
  } catch (e) {}

  const key = envKey || localKey || DEFAULT_KEY;

  if (key) {
    try {
      supabaseInstance = createClient(SUPABASE_URL, key, {
        realtime: {
          params: {
            eventsPerSecond: 10,
          },
        },
      });
      return supabaseInstance;
    } catch (error) {
      console.error("Erro ao inicializar Supabase:", error);
      return null;
    }
  }
  return null;
};

export const saveSupabaseKey = (key: string) => {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem('sb_api_key', key);
  }
  supabaseInstance = null;
  window.location.reload(); 
};

export const clearSupabaseKey = () => {
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem('sb_api_key');
  }
  supabaseInstance = null;
  window.location.reload();
};

