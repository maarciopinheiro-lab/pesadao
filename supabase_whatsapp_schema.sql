-- ==========================================================
-- SCHEMA SUPABASE: AUTOMAÇÃO WHATSAPP APP PESADÃO
-- Execute este script no SQL Editor do seu painel Supabase
-- ==========================================================

-- 1. TABELA DE CONFIGURAÇÃO DO WHATSAPP
CREATE TABLE IF NOT EXISTS public.whatsapp_config (
    id BIGINT PRIMARY KEY DEFAULT 1,
    is_active BOOLEAN NOT NULL DEFAULT FALSE,
    group_id TEXT DEFAULT '',
    group_name TEXT DEFAULT '',
    day_of_week INT NOT NULL DEFAULT 1, -- 0: Domingo, 1: Segunda, 2: Terça, 3: Quarta, 4: Quinta, 5: Sexta, 6: Sábado
    send_time TEXT NOT NULL DEFAULT '09:00',
    message_template TEXT NOT NULL DEFAULT '💰 *COBRANÇA SEMANAL - {nome_grupo}*

Fala, guerreiros! Passando para lembrar da contribuição da semana ({semana}).

💵 *Valor:* R$ {valor}
🔑 *Chave PIX ({pix_tipo}):* {pix}

📊 *Resumo do Mês ({data}):*
• Confirmados/Pagos: {total_pago}
• Pendentes: {total_pendentes}

Quem já realizou o pagamento via PIX, favor enviar o comprovante ou desconsiderar esta mensagem. Valeu! ⚽🔥',
    billing_type TEXT NOT NULL DEFAULT 'general', -- 'general' ou 'detailed'
    pix_key TEXT DEFAULT '',
    pix_type TEXT DEFAULT 'chave',
    default_fee NUMERIC DEFAULT 40.00,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT single_config_row CHECK (id = 1)
);

-- Inserir configuração padrão inicial caso não exista
INSERT INTO public.whatsapp_config (id, is_active, group_id, group_name, day_of_week, send_time, message_template, billing_type, pix_key, pix_type, default_fee)
VALUES (1, false, '', '', 1, '09:00', '💰 *COBRANÇA SEMANAL - {nome_grupo}*

Fala, guerreiros! Passando para lembrar da contribuição da semana ({semana}).

💵 *Valor:* R$ {valor}
🔑 *Chave PIX ({pix_tipo}):* {pix}

📊 *Resumo do Mês ({data}):*
• Confirmados/Pagos: {total_pago}
• Pendentes: {total_pendentes}

Quem já realizou o pagamento via PIX, favor enviar o comprovante ou desconsiderar esta mensagem. Valeu! ⚽🔥', 'general', '', 'chave', 40.00)
ON CONFLICT (id) DO NOTHING;

-- 2. TABELA DE SESSÃO DO WHATSAPP
CREATE TABLE IF NOT EXISTS public.whatsapp_sessions (
    id TEXT PRIMARY KEY DEFAULT 'default',
    status TEXT NOT NULL DEFAULT 'disconnected', -- 'disconnected', 'connecting', 'qr_ready', 'connected', 'error'
    phone_number TEXT,
    qr_code TEXT,
    last_error TEXT,
    last_connected_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO public.whatsapp_sessions (id, status)
VALUES ('default', 'disconnected')
ON CONFLICT (id) DO NOTHING;

-- 3. TABELA DE HISTÓRICO DE MENSAGENS / ENVIOS
CREATE TABLE IF NOT EXISTS public.whatsapp_messages (
    id BIGSERIAL PRIMARY KEY,
    group_id TEXT NOT NULL,
    group_name TEXT,
    type TEXT NOT NULL DEFAULT 'auto', -- 'auto', 'test', 'manual'
    status TEXT NOT NULL DEFAULT 'sent', -- 'sent', 'processing', 'error', 'skipped_duplicate'
    reference_week TEXT NOT NULL, -- Ex: '2026-W34'
    message TEXT NOT NULL,
    error TEXT,
    sent_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_ref_week ON public.whatsapp_messages (reference_week, group_id, status);
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_sent_at ON public.whatsapp_messages (sent_at DESC);

-- 4. TABELA DE LOGS DE AUTOMAÇÃO E DIAGNÓSTICO
CREATE TABLE IF NOT EXISTS public.whatsapp_logs (
    id BIGSERIAL PRIMARY KEY,
    level TEXT NOT NULL DEFAULT 'info', -- 'info', 'warn', 'error'
    event TEXT NOT NULL,
    description TEXT NOT NULL,
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_logs_created_at ON public.whatsapp_logs (created_at DESC);

-- 5. TABELA DE AUTENTICAÇÃO E CHAVES DO BAILEYS
CREATE TABLE IF NOT EXISTS public.whatsapp_auth (
    id TEXT PRIMARY KEY,
    data JSONB NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. TABELA DE FILA DE MENSAGENS (whatsapp_queue)
CREATE TABLE IF NOT EXISTS public.whatsapp_queue (
    id BIGSERIAL PRIMARY KEY,
    tipo TEXT NOT NULL DEFAULT 'billing', -- 'billing', 'match_report', 'test'
    destino TEXT NOT NULL, -- ID do grupo ou número
    mensagem TEXT NOT NULL,
    scheduled_at TIMESTAMPTZ NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'processing', 'sent', 'failed'
    attempts INT NOT NULL DEFAULT 0,
    max_attempts INT NOT NULL DEFAULT 3,
    last_attempt_at TIMESTAMPTZ,
    sent_at TIMESTAMPTZ,
    error TEXT,
    execution_key TEXT UNIQUE, -- Chave única para evitar duplicados
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_queue_status_sched ON public.whatsapp_queue (status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_whatsapp_queue_exec_key ON public.whatsapp_queue (execution_key);

-- HABILITAR RLS (Row Level Security) e permitir acesso para autenticados e chave anônima da aplicação
ALTER TABLE public.whatsapp_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_auth ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_queue ENABLE ROW LEVEL SECURITY;

-- Políticas de acesso aberto para o app (anônimo e autenticado)
DROP POLICY IF EXISTS "Permitir leitura total whatsapp_config" ON public.whatsapp_config;
CREATE POLICY "Permitir leitura total whatsapp_config" ON public.whatsapp_config FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Permitir leitura total whatsapp_sessions" ON public.whatsapp_sessions;
CREATE POLICY "Permitir leitura total whatsapp_sessions" ON public.whatsapp_sessions FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Permitir leitura total whatsapp_messages" ON public.whatsapp_messages;
CREATE POLICY "Permitir leitura total whatsapp_messages" ON public.whatsapp_messages FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Permitir leitura total whatsapp_logs" ON public.whatsapp_logs;
CREATE POLICY "Permitir leitura total whatsapp_logs" ON public.whatsapp_logs FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Permitir acesso total whatsapp_auth" ON public.whatsapp_auth;
CREATE POLICY "Permitir acesso total whatsapp_auth" ON public.whatsapp_auth FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Permitir acesso total whatsapp_queue" ON public.whatsapp_queue;
CREATE POLICY "Permitir acesso total whatsapp_queue" ON public.whatsapp_queue FOR ALL USING (true) WITH CHECK (true);
