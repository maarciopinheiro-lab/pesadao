
export interface Player {
  id: string;
  name: string;
  photoUrl: string;
  isPaid: boolean;
  paymentDate?: string;
  value: number;
  jerseyNumber: number;
  status: 'active' | 'injured';
  paymentHistory: Record<string, string>; // Stores { "MM-YYYY": "DD/MM/YYYY" }
  
  // Novos campos de Estatísticas
  position: string;
  goals: number;
  matchesPlayed: number;
  lastPlayedDate?: string; // Data da última partida que jogou (YYYY-MM-DD)
  overall: number; // Para o card FIFA
}

export interface DbPlayer {
  id: number;
  name: string;
  photo_url: string;
  is_paid: boolean;
  payment_date: string | null;
  value: number;
  jersey_number: number;
  status: string;
  
  // Colunas DB
  position?: string;
  goals?: number;
  matches_played?: number;
  last_played_date?: string;
  overall?: number;
}

export interface Match {
  id: string;
  opponent: string;
  locationImg: string | null;
  location?: string; // Campo novo para nome do local
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
  homeScore: number;
  awayScore: number;
  result: 'win' | 'loss' | 'draw' | 'pending';
  isFinished: boolean;
  lineup?: any;
  comments?: string;
}

export interface DbMatch {
  id: number;
  opponent: string;
  location_img: string | null;
  location?: string;
  date: string;
  time: string;
  home_score: number;
  away_score: number;
  result: string;
  is_finished: boolean;
  lineup?: any;
  comments?: string;
}

export interface DashboardStats {
  totalCollected: number;
  totalPending: number;
  currentDate: string;
  dueDate: string;
}

export type WhatsAppStatus = 'disconnected' | 'connecting' | 'qr_ready' | 'connected' | 'error';

export interface WhatsAppGroup {
  id: string;
  name: string;
  participantsCount?: number;
  desc?: string;
}

export interface BillingSchedule {
  id: string; // '1', '2', '3'
  title: string; // Ex: '1º Disparo (Lembrete)', '2º Disparo (Reforço)', '3º Disparo (Fechamento)'
  enabled: boolean;
  dayOfWeek: number; // 0=Domingo, 1=Segunda, 2=Terça, 3=Quarta, 4=Quinta, 5=Sexta, 6=Sábado
  sendTime: string; // HH:MM (ex: "09:00")
  messageTemplate: string;
}

export interface WhatsAppConfig {
  id?: number | string;
  isActive: boolean;
  groupId: string;
  groupName: string;
  dayOfWeek: number; // 0=Domingo, 1=Segunda, 2=Terça, 3=Quarta, 4=Quinta, 5=Sexta, 6=Sábado
  sendTime: string; // HH:MM (ex: "09:00")
  messageTemplate: string;
  billingType: 'general' | 'detailed';
  pixKey: string;
  pixType: 'cpf' | 'cnpj' | 'phone' | 'email' | 'random';
  defaultFee: number;
  
  // Múltiplos Disparos Semanais (Até 3 dias e copies personalizadas)
  schedules?: BillingSchedule[];

  // Configuração do Pós-Jogo / Partida (Grupo separado)
  matchGroupId?: string;
  matchGroupName?: string;
  matchMessageTemplate?: string;
  matchAutoSend?: boolean;

  updatedAt?: string;
}

export interface WhatsAppMessageLog {
  id: string | number;
  sentAt: string;
  groupId: string;
  groupName: string;
  type: 'auto' | 'test' | 'manual' | 'match_report' | 'match_test';
  status: 'sent' | 'processing' | 'error' | 'skipped_duplicate';
  referenceWeek: string;
  message: string;
  error?: string;
}

export interface WhatsAppSystemLog {
  id: string | number;
  timestamp: string;
  event: string;
  description: string;
  level: 'info' | 'warn' | 'error';
}

export interface WhatsAppSessionInfo {
  status: WhatsAppStatus;
  phoneNumber?: string | null;
  qrCode?: string | null;
  error?: string | null;
  lastConnected?: string | null;
}
