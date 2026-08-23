import React, { useState, useEffect, useMemo, ChangeEvent } from 'react';
import { Player, DbPlayer, Match, DbMatch } from './types';
import { getSupabase, saveSupabaseKey, SUPABASE_URL } from './supabaseClient';
import { WhatsAppTab } from './WhatsAppTab';
import { previewMatchWhatsAppMessage, sendMatchWhatsAppReport, getWhatsAppConfig } from './whatsappClient';

const DEFAULT_FEE = 40;
const TEAM_LOGO_URL = 'https://i.imgur.com/GSj0ZPy.png'; // Ícone transparente (Interno)
const PWA_LOGO_URL = 'https://i.imgur.com/CxbCPR5.png';   // Ícone PWA (Sólido/Download)

// Posições fixas para o campo de 7 (Society)
const FIELD_POSITIONS = [
  { id: 0, label: 'GOL', top: '85%', left: '50%' },
  { id: 1, label: 'FIX', top: '65%', left: '25%' },
  { id: 2, label: 'FIX', top: '65%', left: '75%' },
  { id: 3, label: 'ALA', top: '40%', left: '20%' },
  { id: 4, label: 'ALA', top: '40%', left: '80%' },
  { id: 5, label: 'ATA', top: '15%', left: '30%' },
  { id: 6, label: 'ATA', top: '15%', left: '70%' },
];

const App: React.FC = () => {
  // --- PWA INSTALL LOGIC ---
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [showInstallPrompt, setShowInstallPrompt] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      const isMobileSize = window.innerWidth < 1024;
      const isMobileUA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
      return isMobileSize || isMobileUA;
    };
    
    const mobileStatus = checkMobile();
    setIsMobile(mobileStatus);

    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
    setIsIOS(ios);

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
      if (mobileStatus && !window.matchMedia('(display-mode: standalone)').matches) {
        setShowInstallPrompt(true);
      }
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    if (window.matchMedia('(display-mode: standalone)').matches || (window.navigator as any).standalone) {
      setShowInstallPrompt(false);
    }

    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
  }, []);

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setDeferredPrompt(deferredPrompt);
      setShowInstallPrompt(false);
    }
  };

  // --- STATE ---
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');
  const [currentTab, setCurrentTab] = useState<'financial' | 'matches' | 'stats' | 'whatsapp'>('matches'); 
  
  const [players, setPlayers] = useState<Player[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [paymentFilter, setPaymentFilter] = useState<'all' | 'paid' | 'pending'>('all');
  
  const [apiKeyModalOpen, setApiKeyModalOpen] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [addMode, setAddMode] = useState<'player' | 'match'>('player');
  
  const [isEditPlayerModalOpen, setIsEditPlayerModalOpen] = useState(false);
  const [editingPlayer, setEditingPlayer] = useState<Player | null>(null);
  const [editPlayerName, setEditPlayerName] = useState('');
  const [editPlayerNumber, setEditPlayerNumber] = useState('');
  const [editPlayerPosition, setEditPlayerPosition] = useState('');
  const [editPlayerPhoto, setEditPlayerPhoto] = useState<string | null>(null);
  const [editPlayerValue, setEditPlayerValue] = useState<string>('');

  const [isMatchResultModalOpen, setIsMatchResultModalOpen] = useState(false);
  const [selectedMatch, setSelectedMatch] = useState<Match | null>(null);
  const [manualHomeScore, setManualHomeScore] = useState<number | string>(0);
  const [manualAwayScore, setManualAwayScore] = useState<number | string>(0);
  const [matchComments, setMatchComments] = useState('');
  const [matchPlayerStats, setMatchPlayerStats] = useState<Record<string, {goals: number, present: boolean, starterPos?: number}>>({});
  const [activeSlot, setActiveSlot] = useState<number | null>(null);

  const [matchViewMode, setMatchViewMode] = useState<'upcoming' | 'history'>('upcoming');
  const [searchQuery, setSearchQuery] = useState('');
  const [gkStats, setGkStats] = useState<Record<string, {golsSofridos: number, jogosSemSofrerGols: number}>>(() => {
    const saved = localStorage.getItem('gkStats');
    return saved ? JSON.parse(saved) : {};
  });

  useEffect(() => {
    localStorage.setItem('gkStats', JSON.stringify(gkStats));
  }, [gkStats]);

  const [newPlayerName, setNewPlayerName] = useState('');
  const [newPlayerNumber, setNewPlayerNumber] = useState('');
  const [newPlayerPhoto, setNewPlayerPhoto] = useState<string | null>(null);
  const [newPlayerPosition, setNewPlayerPosition] = useState('MEI');
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  const [newMatchOpponent, setNewMatchOpponent] = useState('');
  const [newMatchLocation, setNewMatchLocation] = useState('');
  // Inicializa com o próximo domingo
  const [newMatchDate, setNewMatchDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + (d.getDay() === 0 ? 0 : 7 - d.getDay()));
    return d.toISOString().split('T')[0];
  });
  const [newMatchTime, setNewMatchTime] = useState('');
  const [newMatchLocationImg, setNewMatchLocationImg] = useState<string | null>(null);

  const [isPlayerDetailModalOpen, setIsPlayerDetailModalOpen] = useState(false);
  const [selectedPlayerForDetail, setSelectedPlayerForDetail] = useState<Player | null>(null);
  const [isRankingModalOpen, setIsRankingModalOpen] = useState(false);
  const [rankingType, setRankingType] = useState<'goals' | 'matches'>('goals');

  // WhatsApp Match Share Modal
  const [isMatchShareModalOpen, setIsMatchShareModalOpen] = useState(false);
  const [matchToShare, setMatchToShare] = useState<any>(null);
  const [matchShareText, setMatchShareText] = useState<string>('');
  const [matchShareTargetGroup, setMatchShareTargetGroup] = useState<string>('');
  const [sendingMatchReport, setSendingMatchReport] = useState(false);
  const [matchShareFeedback, setMatchShareFeedback] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Ajustes de saldo manual por mês
  const [monthlyAdjustments, setMonthlyAdjustments] = useState<Record<string, number>>(() => {
    const saved = localStorage.getItem('team_monthly_adjustments');
    return saved ? JSON.parse(saved) : {};
  });
  const [isEditingExtra, setIsEditingExtra] = useState(false);
  const [tempExtraValue, setTempExtraValue] = useState<string>('');

  useEffect(() => {
    localStorage.setItem('team_monthly_adjustments', JSON.stringify(monthlyAdjustments));
  }, [monthlyAdjustments]);

  // --- INITIALIZATION ---
  useEffect(() => {
    if (theme === 'dark') document.documentElement.classList.add('dark');
    else document.documentElement.classList.remove('dark');
  }, [theme]);

  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase) {
      setApiKeyModalOpen(true);
      setLoading(false);
      return;
    }
    setIsConnected(true);
    fetchData();

    const channelPlayers = supabase.channel('realtime-players')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'players' }, () => fetchData())
      .subscribe();

    const channelMatches = supabase.channel('realtime-matches')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches' }, () => fetchData())
      .subscribe();

    return () => {
      supabase.removeChannel(channelPlayers);
      supabase.removeChannel(channelMatches);
    };
  }, []);

  const fetchData = async () => {
    const supabase = getSupabase();
    if (!supabase) return;

    try {
      const { data: dataPlayers, error: pError } = await supabase.from('players').select('*').order('name', { ascending: true });
      if (pError) throw pError;

      if (dataPlayers) {
        setPlayers(dataPlayers.map((p: any) => {
          const history = parsePaymentHistory(p.payment_date);
          return {
            id: p.id.toString(),
            name: p.name,
            photoUrl: p.photo_url || 'https://via.placeholder.com/150',
            isPaid: !!history[getMonthKey(selectedDate)], 
            paymentDate: undefined,
            value: p.value,
            jerseyNumber: p.jersey_number,
            status: (p.status === 'injured' ? 'injured' : 'active') as 'active' | 'injured',
            paymentHistory: history,
            position: p.position || 'MEI',
            goals: p.goals || 0,
            matchesPlayed: p.matches_played || 0,
            lastPlayedDate: p.last_played_date,
            overall: p.overall || 75
          };
        }));
      }

      const { data: dataMatches, error: mError } = await supabase.from('matches').select('*').order('date', { ascending: true });
      if (mError) throw mError;

      if (dataMatches) {
        setMatches(dataMatches.map((m: DbMatch) => ({
          id: m.id.toString(),
          opponent: m.opponent,
          locationImg: m.location_img,
          location: m.location || '',
          date: m.date,
          time: m.time,
          homeScore: m.home_score,
          awayScore: m.away_score,
          result: m.result as any,
          isFinished: m.is_finished,
          lineup: m.lineup || undefined,
          comments: m.comments || ''
        })));
      }
    } catch (error) {
      console.error("Erro ao buscar dados:", error);
    } finally {
      setLoading(false);
    }
  };

  const parsePaymentHistory = (dateStr: string | null): Record<string, string> => {
    if (!dateStr) return {};
    try {
        const parsed = JSON.parse(dateStr);
        return (typeof parsed === 'object' && parsed !== null) ? parsed : {};
    } catch (e) { return {}; }
  };

  const getMonthKey = (date: Date) => {
    const m = (date.getMonth() + 1).toString().padStart(2, '0');
    const y = date.getFullYear();
    return `${m}-${y}`;
  };

  const toggleTheme = () => setTheme(prev => prev === 'dark' ? 'light' : 'dark');
  const changeMonth = (increment: number) => {
    const newDate = new Date(selectedDate);
    newDate.setMonth(newDate.getMonth() + increment);
    setSelectedDate(newDate);
  };

  // Calcula o saldo acumulado (do ano corrente até o mês selecionado)
  const getAccumulatedOwed = (player: Player, date: Date) => {
    if (player.position === 'GOL') return 0;
    const currentMonthKey = getMonthKey(date);
    
    // Se já pagou o mês atual, mostramos apenas o valor base no card,
    // mas a dívida acumulada foca em quem ainda não pagou.
    if (player.paymentHistory[currentMonthKey]) return player.value;

    const registrationMonth = player.paymentHistory['_registered'];
    let startMonth = 0;
    
    if (registrationMonth) {
        try {
          const [regM, regY] = registrationMonth.split('-').map(Number);
          const year = date.getFullYear();
          if (regY === year) {
              startMonth = regM - 1;
          } else if (regY > year) {
              return 0; // Ainda não era nascido no app
          }
        } catch (e) { startMonth = 0; }
    }

    let unpaidMonths = 0;
    const year = date.getFullYear();
    const month = date.getMonth();
    
    for (let m = startMonth; m <= month; m++) {
      const key = `${(m + 1).toString().padStart(2, '0')}-${year}`;
      if (!player.paymentHistory[key]) {
        unpaidMonths++;
      }
    }
    return unpaidMonths * player.value;
  };

  const financialStats = useMemo(() => {
    const currentMonthKey = getMonthKey(selectedDate);
    const playersView = players.map(p => ({ ...p, isPaid: !!p.paymentHistory[currentMonthKey] }));
    
    // Filtra apenas jogadores pagantes (exclue goleiros das metas financeiras)
    // Oculta afastados que não pagaram da contagem de potencial
    const activePayers = playersView.filter(p => p.position !== 'GOL' && (p.status === 'active' || p.isPaid));
    
    let collected = playersView.reduce((acc, p) => acc + (p.isPaid && p.position !== 'GOL' ? p.value : 0), 0);
    collected += (monthlyAdjustments[currentMonthKey] || 0);

    const potential = activePayers.reduce((acc, p) => acc + p.value, 0);
    const paidCount = playersView.filter(p => p.isPaid && p.position !== 'GOL').length;
    
    return { 
      collected, 
      potential, 
      paid: paidCount, 
      count: activePayers.length, 
      progress: activePayers.length > 0 ? (paidCount / activePayers.length) * 100 : 0 
    };
  }, [players, selectedDate, monthlyAdjustments]);

  const debtorStats = useMemo(() => {
    return players
      .filter(p => p.position !== 'GOL' && p.status === 'active')
      .map(p => ({
        ...p,
        totalOwed: getAccumulatedOwed(p, selectedDate)
      }))
      .filter(p => p.totalOwed > p.value) // Mais de um mês deve
      .sort((a, b) => b.totalOwed - a.totalOwed)
      .slice(0, 3);
  }, [players, selectedDate]);

  const matchStats = useMemo(() => {
    const finished = matches.filter(m => m.isFinished);
    const wins = finished.filter(m => m.result === 'win').length;
    const draws = finished.filter(m => m.result === 'draw').length;
    const losses = finished.filter(m => m.result === 'loss').length;
    const goalsFor = finished.reduce((acc, m) => acc + m.homeScore, 0);
    const goalsAgainst = finished.reduce((acc, m) => acc + m.awayScore, 0);
    return { wins, draws, losses, total: finished.length, winRate: finished.length > 0 ? Math.round((wins / finished.length) * 100) : 0, goalsFor, goalsAgainst, goalDiff: goalsFor - goalsAgainst };
  }, [matches]);

  const topScorers = useMemo(() => [...players].sort((a, b) => b.goals - a.goals).slice(0, 5), [players]);
  const topAppearances = useMemo(() => [...players].sort((a, b) => b.matchesPlayed - a.matchesPlayed).slice(0, 5), [players]);

  const nextSundays = useMemo(() => {
    const dates = [];
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    
    // Inicia no primeiro dia do mês atual
    const d = new Date(now.getFullYear(), now.getMonth(), 1);
    
    // Encontra o primeiro domingo do mês atual
    while (d.getDay() !== 0) {
      d.setDate(d.getDate() + 1);
    }
    
    // Coleta todos os domingos do mês atual
    const currentMonth = now.getMonth();
    while (d.getMonth() === currentMonth) {
      dates.push(new Date(d));
      d.setDate(d.getDate() + 7);
    }

    // Coleta os domingos do próximo mês para planejamento futuro
    const nextMonth = (currentMonth + 1) % 12;
    while (d.getMonth() === nextMonth) {
      dates.push(new Date(d));
      d.setDate(d.getDate() + 7);
    }
    
    return dates;
  }, []);

  const togglePayment = async (id: string) => {
    const supabase = getSupabase();
    if (!supabase) return;
    const player = players.find(p => p.id === id);
    if (!player || player.position === 'GOL') return;
    const currentMonthKey = getMonthKey(selectedDate);
    const newHistory = { ...player.paymentHistory };
    const isPaidNow = !!newHistory[currentMonthKey];
    if (isPaidNow) delete newHistory[currentMonthKey];
    else newHistory[currentMonthKey] = new Date().toLocaleDateString('pt-BR');
    setPlayers(prev => prev.map(p => p.id === id ? { ...p, paymentHistory: newHistory } : p));
    await supabase.from('players').update({ payment_date: JSON.stringify(newHistory) }).eq('id', id);
  };

  const handlePhotoUpload = (e: ChangeEvent<HTMLInputElement>, setter: (val: string) => void) => {
    if (e.target.files && e.target.files[0]) {
      const reader = new FileReader();
      reader.onloadend = () => setter(reader.result as string);
      reader.readAsDataURL(e.target.files[0]);
    }
  };

  const deletePlayer = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (window.confirm("Remover jogador?")) {
      const supabase = getSupabase();
      if(supabase) await supabase.from('players').delete().eq('id', id);
      setPlayers(prev => prev.filter(p => p.id !== id));
    }
  };

  const togglePlayerStatus = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const player = players.find(p => p.id === id);
    if(!player) return;
    const newStatus = player.status === 'active' ? 'injured' : 'active';
    const supabase = getSupabase();
    if(supabase) await supabase.from('players').update({ status: newStatus }).eq('id', id);
    setPlayers(prev => prev.map(p => p.id === id ? { ...p, status: newStatus } : p));
  };

  const openEditPlayerModal = (player: Player, e: React.MouseEvent) => {
      e.stopPropagation();
      setEditingPlayer(player);
      setEditPlayerName(player.name);
      setEditPlayerNumber(player.jerseyNumber.toString());
      setEditPlayerPosition(player.position);
      setEditPlayerPhoto(player.photoUrl);
      setEditPlayerValue(player.value.toString());
      setIsEditPlayerModalOpen(true);
  };

  const handleUpdatePlayer = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!editingPlayer || !editPlayerName.trim()) return;
      setIsSubmitting(true);
      const supabase = getSupabase();
      if (supabase) {
          const { error } = await supabase.from('players').update({ 
            name: editPlayerName, 
            jersey_number: parseInt(editPlayerNumber) || 0, 
            position: editPlayerPosition, 
            photo_url: editPlayerPhoto,
            value: parseFloat(editPlayerValue) || DEFAULT_FEE
          }).eq('id', editingPlayer.id);
          
          if (!error) {
              setPlayers(prev => prev.map(p => p.id === editingPlayer.id ? { 
                ...p, 
                name: editPlayerName, 
                jerseyNumber: parseInt(editPlayerNumber) || 0, 
                position: editPlayerPosition, 
                photoUrl: editPlayerPhoto || p.photoUrl,
                value: parseFloat(editPlayerValue) || DEFAULT_FEE
              } : p));
              setIsEditPlayerModalOpen(false);
          }
      }
      setIsSubmitting(false);
  };

  const saveExtraBox = () => {
    const val = parseFloat(tempExtraValue) || 0;
    const key = getMonthKey(selectedDate);
    setMonthlyAdjustments(prev => ({ ...prev, [key]: val }));
    setIsEditingExtra(false);
  };

  const handleAddPlayer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPlayerName.trim() || isSubmitting) return;
    
    const supabase = getSupabase();
    if (!supabase) {
        alert("Erro: Conexão com o banco de dados não disponível.");
        return;
    }

    setIsSubmitting(true);
    try {
      const fullPayload = { 
        name: newPlayerName, 
        photo_url: newPlayerPhoto || 'https://via.placeholder.com/150', 
        is_paid: false, 
        value: DEFAULT_FEE, 
        jersey_number: parseInt(newPlayerNumber) || 0, 
        status: 'active', 
        payment_date: JSON.stringify({ _registered: getMonthKey(new Date()) }), 
        position: newPlayerPosition || 'MEI', 
        goals: 0, 
        matches_played: 0, 
        overall: 70 
      };

      const { error } = await supabase.from('players').insert([fullPayload]);
      
      if (error) {
        console.error("Erro Supabase:", error);
        alert(`Erro ao salvar no banco: ${error.message}`);
      } else {
        // Sucesso total
        await fetchData(); // Recarregar lista
        // Limpar estados
        setNewPlayerName(''); 
        setNewPlayerNumber(''); 
        setNewPlayerPhoto(null);
        setNewPlayerPosition('MEI');
        setIsAddModalOpen(false);
      }
    } catch (err: any) {
      console.error("Erro Inesperado no Cadastro:", err);
      alert("Ocorreu um erro inesperado ao processar o cadastro.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAddMatch = async (e: React.FormEvent) => {
    e.preventDefault();
    if(isSubmitting) return;
    setIsSubmitting(true);
    const supabase = getSupabase();
    if(supabase) {
        const { error } = await supabase.from('matches').insert([{ opponent: newMatchOpponent, location: newMatchLocation, date: newMatchDate, time: newMatchTime, location_img: newMatchLocationImg, result: 'pending', is_finished: false }]);
        if (!error) await fetchData();
    }
    setNewMatchOpponent(''); setNewMatchLocation(''); 
    // Reset date to next Sunday
    const d = new Date();
    d.setDate(d.getDate() + (d.getDay() === 0 ? 0 : 7 - d.getDay()));
    setNewMatchDate(d.toISOString().split('T')[0]);
    setNewMatchTime(''); setNewMatchLocationImg(null); setIsAddModalOpen(false); setIsSubmitting(false);
  };

  const deleteMatch = async (id: string, e: React.MouseEvent) => {
      e.preventDefault(); e.stopPropagation();
      if (!window.confirm("Remover esta partida? As estatísticas dos jogadores serão estornadas.")) return;
      const supabase = getSupabase();
      if(supabase) {
          const matchToRemove = matches.find(m => m.id === id);
          if (matchToRemove && matchToRemove.isFinished && matchToRemove.lineup) {
              const lineup = typeof matchToRemove.lineup === 'string' ? JSON.parse(matchToRemove.lineup) : matchToRemove.lineup;
              
              const { data: currentPlayers } = await supabase.from('players').select('*');
              const updates = [];
              for (const pid in lineup) {
                  const stat = lineup[pid];
                  const player = currentPlayers?.find(p => p.id.toString() === pid);
                  if (player && stat.present) {
                      updates.push(supabase.from('players').update({ 
                          goals: Math.max(0, (player.goals || 0) - stat.goals), 
                          matches_played: Math.max(0, (player.matches_played || 0) - 1) 
                      }).eq('id', parseInt(pid)));
                  }
              }
              if (updates.length) await Promise.all(updates);
          }

          const { error } = await supabase.from('matches').delete().eq('id', parseInt(id));
          if (!error) await fetchData();
      }
  };
  
  const toggleMatchPresence = (playerId: string) => {
      setMatchPlayerStats(prev => {
          const current = prev[playerId] || { goals: 0, present: false };
          return { ...prev, [playerId]: { ...current, present: !current.present, goals: !current.present ? 0 : current.goals } };
      });
  };

  const updateMatchStat = (playerId: string, delta: number, e: React.MouseEvent) => {
      e.stopPropagation();
      setMatchPlayerStats(prev => {
          const current = prev[playerId];
          if (!current || !current.present) return prev;
          return { ...prev, [playerId]: { ...current, goals: Math.max(0, current.goals + delta) } };
      });
  };

  const setPlayerToFieldSlot = (playerId: string, slotId: number) => {
      setMatchPlayerStats(prev => {
          const newStats = { ...prev };
          // Remove quem já estava nesse slot
          Object.keys(newStats).forEach(pid => {
              if (newStats[pid].starterPos === slotId) {
                  delete newStats[pid].starterPos;
              }
          });
          // Remove este jogador de qualquer outro slot
          Object.keys(newStats).forEach(pid => {
              if (pid === playerId) {
                  newStats[pid] = { ...newStats[pid], starterPos: slotId, present: true };
              }
          });
          return newStats;
      });
      setActiveSlot(null);
  };

  const openMatchResultModal = (match: Match) => {
      setSelectedMatch(match);
      setManualHomeScore(match.isFinished ? match.homeScore : '');
      setManualAwayScore(match.isFinished ? match.awayScore : '');
      setMatchComments(match.comments || '');
      const statsMap: Record<string, {goals: number, present: boolean, starterPos?: number}> = {};
      
      if (match.lineup) {
          try {
            const loaded = typeof match.lineup === 'string' ? JSON.parse(match.lineup) : match.lineup;
            if (loaded) Object.assign(statsMap, loaded);
          } catch(e) { console.error("Erro lineup", e); }
      }

      players.forEach(p => {
          if (p.status === 'active' && !statsMap[p.id]) {
              statsMap[p.id] = { goals: 0, present: false };
          }
      });

      setMatchPlayerStats(statsMap);
      setIsMatchResultModalOpen(true);
  };

  const confirmMatchResult = async () => {
      if (!selectedMatch) return;
      const supabase = getSupabase();
      if (!supabase) return;
      setIsSubmitting(true);
      
      const homeVal = parseInt(manualHomeScore.toString()) || 0;
      const awayVal = parseInt(manualAwayScore.toString()) || 0;

      let result = 'draw';
      if (homeVal > awayVal) result = 'win';
      else if (homeVal < awayVal) result = 'loss';

      // 1. Reverter estatísticas antigas sincronizadamente
      if (selectedMatch.isFinished && selectedMatch.lineup) {
          const oldLineup = typeof selectedMatch.lineup === 'string' ? JSON.parse(selectedMatch.lineup) : selectedMatch.lineup;
          const { data: playersToRevert } = await supabase.from('players').select('id, goals, matches_played');
          
          const revertUpdates = [];
          for (const pid in oldLineup) {
              const stat = oldLineup[pid];
              const player = playersToRevert?.find(p => p.id.toString() === pid);
              if (player && stat.present) {
                  revertUpdates.push(supabase.from('players').update({ 
                      goals: Math.max(0, (player.goals || 0) - stat.goals), 
                      matches_played: Math.max(0, (player.matches_played || 0) - 1) 
                  }).eq('id', parseInt(pid)));
              }
          }
          if (revertUpdates.length) await Promise.all(revertUpdates);
          await new Promise(r => setTimeout(r, 100));
      }

      // 2. Salvar o novo relatório da partida
      const { error: mError } = await supabase.from('matches').update({ 
          home_score: homeVal, 
          away_score: awayVal, 
          result, 
          is_finished: true, 
          lineup: matchPlayerStats, 
          comments: matchComments 
      }).eq('id', parseInt(selectedMatch.id));
      
      if (mError) {
          alert("Erro: " + mError.message);
          setIsSubmitting(false);
          return;
      }

      // 3. Aplicar novas estatísticas baseadas no estado mais recente
      const { data: freshPlayers } = await supabase.from('players').select('id, goals, matches_played');
      const applyUpdates = [];
      
      for (const pid in matchPlayerStats) {
          const stat = matchPlayerStats[pid];
          const player = freshPlayers?.find(p => p.id.toString() === pid);
          if (player && stat.present) {
              applyUpdates.push(supabase.from('players').update({ 
                  goals: (player.goals || 0) + stat.goals, 
                  matches_played: (player.matches_played || 0) + 1 
              }).eq('id', parseInt(pid)));
          }
      }
      if (applyUpdates.length) await Promise.all(applyUpdates);
      
      await fetchData();
      setIsMatchResultModalOpen(false); 
      setIsSubmitting(false);

      // Abrir modal com opção de compartilhar no WhatsApp
      const savedMatchObj = {
        id: selectedMatch.id,
        opponent: selectedMatch.opponent,
        homeScore: homeVal,
        awayScore: awayVal,
        result,
        date: selectedMatch.date,
        time: selectedMatch.time,
        location: selectedMatch.location,
        isFinished: true,
        lineup: matchPlayerStats,
        comments: matchComments,
        matchPlayerStats,
      };
      openMatchShareModal(savedMatchObj);
  };

  const openMatchShareModal = async (matchObj: any) => {
    setMatchToShare(matchObj);
    setIsMatchShareModalOpen(true);
    setMatchShareFeedback(null);
    try {
      const [c, prev] = await Promise.all([
        getWhatsAppConfig().catch(() => null),
        previewMatchWhatsAppMessage(matchObj).catch(() => ({ preview: '' })),
      ]);
      if (c) {
        setMatchShareTargetGroup(c.matchGroupName || c.groupName || '');
      }
      setMatchShareText(prev.preview || '');
    } catch (e) {
      console.warn('Erro ao carregar prévia da mensagem:', e);
    }
  };

  const handleSendMatchToWhatsAppGroup = async () => {
    if (!matchToShare) return;
    setSendingMatchReport(true);
    setMatchShareFeedback(null);
    try {
      const res = await sendMatchWhatsAppReport(matchToShare, matchShareText);
      setMatchShareFeedback({ text: res.message || 'Relatório enviado com sucesso!', type: 'success' });
      setTimeout(() => {
        setIsMatchShareModalOpen(false);
      }, 2500);
    } catch (err: any) {
      setMatchShareFeedback({ text: err.message || 'Falha ao enviar relatório no WhatsApp.', type: 'error' });
    } finally {
      setSendingMatchReport(false);
    }
  };

  const resetAllStats = async () => {
    if(!window.confirm("Zerar estatísticas de todo o elenco?")) return;
    const supabase = getSupabase();
    if (supabase) {
      await supabase.from('players').update({ goals: 0, matches_played: 0 }).neq('id', -1);
      await fetchData();
    }
  };

  // --- RENDERING HELPERS ---
  const sundaysOfMonth = useMemo(() => {
    const year = selectedDate.getFullYear();
    const month = selectedDate.getMonth();
    const sundays = [];
    const date = new Date(year, month, 1);
    
    while (date.getMonth() === month) {
      if (date.getDay() === 0) {
        sundays.push(new Date(date));
      }
      date.setDate(date.getDate() + 1);
    }
    return sundays;
  }, [selectedDate]);

  const playerStarterCount = useMemo(() => {
    if (!selectedPlayerForDetail) return 0;
    return matches.filter(m => {
      if (!m.isFinished || !m.lineup) return false;
      try {
        const lineup = typeof m.lineup === 'string' ? JSON.parse(m.lineup) : m.lineup;
        return lineup && lineup[selectedPlayerForDetail.id]?.starterPos !== undefined;
      } catch (e) { return false; }
    }).length;
  }, [matches, selectedPlayerForDetail]);

  const renderFinancial = () => {
    const monthKey = getMonthKey(selectedDate);
    
    // Filtro de pagantes
    const filteredPlayers = players.filter(p => {
      const isPaid = !!p.paymentHistory[monthKey];
      if (paymentFilter === 'paid') return isPaid && p.position !== 'GOL';
      if (paymentFilter === 'pending') return !isPaid && p.position !== 'GOL' && p.status !== 'injured';
      return true;
    });

    return (
      <div className="space-y-8 md:space-y-10 animation-fade-in pb-20">
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 md:gap-8">
            <div className="xl:col-span-1 bg-surface-light dark:bg-surface-dark rounded-2xl p-6 md:p-8 border border-gray-200 dark:border-gray-800 shadow-sm relative overflow-hidden flex flex-col justify-between min-h-[200px] md:min-h-[220px]">
               <div className="absolute top-0 right-0 w-64 h-64 bg-primary/5 rounded-full blur-3xl -mr-16 -mt-16 pointer-events-none"></div>
               <div className="relative z-10">
                 <div className="flex items-center justify-between mb-1">
                   <h2 className="text-muted-light dark:text-muted-dark font-medium text-sm md:text-base">Total em Caixa ({selectedDate.toLocaleDateString('pt-BR', {month: 'long', year: 'numeric'})})</h2>
                   <button 
                    onClick={() => { setTempExtraValue((monthlyAdjustments[getMonthKey(selectedDate)] || 0).toString()); setIsEditingExtra(true); }} 
                    className="w-8 h-8 rounded-full flex items-center justify-center bg-black/5 dark:bg-white/5 hover:bg-primary/10 transition-colors"
                   >
                     <span className="material-icons-outlined text-xs">edit</span>
                   </button>
                 </div>
                 {isEditingExtra ? (
                   <div className="flex items-center gap-2 mb-6 animate-fade-in">
                      <input 
                        type="number" 
                        autoFocus
                        value={tempExtraValue}
                        onChange={(e) => setTempExtraValue(e.target.value)}
                        className="bg-gray-100 dark:bg-black/40 border-0 rounded-xl p-2 text-lg font-bold w-32 focus:ring-2 focus:ring-primary/20"
                      />
                      <button onClick={saveExtraBox} className="bg-primary text-white p-2 rounded-xl"><span className="material-icons-outlined text-sm">check</span></button>
                      <button onClick={() => setIsEditingExtra(false)} className="opacity-40 p-2"><span className="material-icons-outlined text-sm">close</span></button>
                   </div>
                 ) : (
                   <div className="flex items-baseline gap-2 mb-6">
                     <span className="text-4xl md:text-5xl font-bold tracking-tighter text-gray-900 dark:text-white">R$ {financialStats.collected}</span>
                     <span className="text-sm md:text-lg text-muted-light dark:text-muted-dark font-medium">/ {financialStats.potential}</span>
                   </div>
                 )}
               </div>
               <div className="relative z-10 mt-auto">
                 <div className="flex justify-between text-sm font-semibold mb-3">
                   <span className="text-primary">{financialStats.paid} Pagos</span>
                   <span className="text-muted-light dark:text-muted-dark">{financialStats.count - financialStats.paid} Pendentes</span>
                 </div>
                 <div className="w-full bg-gray-200 dark:bg-gray-800 rounded-full h-3 md:h-4 overflow-hidden">
                   <div className="bg-primary h-3 md:h-4 rounded-full transition-all duration-700 ease-out" style={{ width: `${financialStats.progress}%` }}></div>
                 </div>
               </div>
            </div>
            <div className="xl:col-span-2 bg-surface-light dark:bg-surface-dark rounded-2xl p-6 md:p-8 border border-gray-200 dark:border-gray-800 shadow-sm relative overflow-hidden">
                <div className="flex items-center gap-2 mb-6"><span className="material-icons-outlined text-red-500">warning</span><h3 className="font-bold text-lg">Pendências Acumuladas</h3></div>
                <div className="flex items-end justify-around h-36 md:h-40 pb-2">
                   {[0, 1, 2].map((idx) => {
                       const p = debtorStats[idx];
                       return p ? (
                          <div key={p.id} className={`flex flex-col items-center gap-2 ${idx === 0 ? 'mb-4' : ''}`}>
                               <div className="relative">
                                   <img src={p.photoUrl} className={`${idx === 0 ? 'w-20 h-20 md:w-24 md:h-24 border-red-500' : 'w-14 h-14 md:w-16 md:h-16 border-gray-400'} rounded-full border-4 object-cover object-top`} />
                                   <div className="absolute -bottom-1 -right-1 bg-red-500 text-white text-[8px] font-black px-1.5 py-0.5 rounded-full shadow-lg">R$ {p.totalOwed}</div>
                               </div>
                               <div className="text-center mt-2"><p className="font-bold text-xs truncate max-w-[80px]">{p.name}</p></div>
                          </div>
                       ) : (
                         idx === 0 && <div key="empty" className="text-muted-light text-xs opacity-40 italic">Nenhuma pendência crítica</div>
                       );
                   })}
                </div>
            </div>
          </div>

          <div className="space-y-6">
              <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                  <div className="flex items-center gap-4">
                    <h3 className="text-xl font-bold flex items-center gap-2">Elenco <span className="text-xs bg-gray-200 dark:bg-gray-800 px-2 py-1 rounded">{players.length}</span></h3>
                    
                    {/* FILTROS DE PAGAMENTO */}
                    <div className="flex bg-gray-200 dark:bg-surface-dark p-1 rounded-full border border-gray-100 dark:border-gray-800">
                      <button onClick={() => setPaymentFilter('all')} className={`px-3 py-1 rounded-full text-[10px] font-black uppercase transition-all ${paymentFilter === 'all' ? 'bg-white dark:bg-gray-700 shadow text-primary' : 'text-muted-light'}`}>Todos</button>
                      <button onClick={() => setPaymentFilter('paid')} className={`px-3 py-1 rounded-full text-[10px] font-black uppercase transition-all ${paymentFilter === 'paid' ? 'bg-white dark:bg-gray-700 shadow text-green-500' : 'text-muted-light'}`}>Pagos</button>
                      <button onClick={() => setPaymentFilter('pending')} className={`px-3 py-1 rounded-full text-[10px] font-black uppercase transition-all ${paymentFilter === 'pending' ? 'bg-white dark:bg-gray-700 shadow text-red-500' : 'text-muted-light'}`}>Pend.</button>
                    </div>
                  </div>

                  <div className="flex w-full md:w-auto items-center gap-2">
                      <div className="flex items-center gap-2 bg-surface-light dark:bg-surface-dark px-2 py-1 rounded-full border border-gray-200 dark:border-gray-700">
                          <button onClick={() => changeMonth(-1)} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full"><span className="material-icons-outlined">chevron_left</span></button>
                          <span className="font-bold text-sm px-2">{selectedDate.toLocaleDateString('pt-BR', {month: 'long', year: 'numeric'})}</span>
                          <button onClick={() => changeMonth(1)} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full"><span className="material-icons-outlined">chevron_right</span></button>
                      </div>
                      <button onClick={() => {setAddMode('player'); setIsAddModalOpen(true);}} className="flex items-center justify-center gap-2 bg-primary text-white font-bold px-4 py-2 rounded-xl text-sm shadow-lg shadow-primary/20"><span className="material-icons-outlined text-lg">add</span> <span className="hidden sm:inline">Novo Atleta</span></button>
                  </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                   {filteredPlayers.map(p => {
                       const isPaid = !!p.paymentHistory[monthKey];
                       const displayValue = getAccumulatedOwed(p, selectedDate);
                       const isGoalkeeper = p.position === 'GOL';

                       return (
                        <div key={p.id} className={`relative group h-[280px] md:h-[340px] bg-gradient-to-b from-white to-gray-200 dark:from-[#1a1d22] dark:to-[#0f1115] rounded-[2.5rem] border ${p.status === 'injured' ? 'border-[#29caff]/50' : (isPaid || isGoalkeeper ? 'border-green-500/50' : 'border-gray-200 dark:border-gray-800')} transition-all duration-500 hover:-translate-y-2 hover:shadow-2xl overflow-hidden flex flex-col justify-end`}>
                            <div className="absolute top-6 right-6 z-30 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                               <button onClick={(e) => openEditPlayerModal(p, e)} className="w-8 h-8 rounded-full flex items-center justify-center bg-white/20 backdrop-blur-md text-gray-400 hover:text-white hover:bg-primary transition-colors"><span className="material-icons-outlined text-sm">edit</span></button>
                               <button onClick={(e) => togglePlayerStatus(p.id, e)} className={`w-8 h-8 rounded-full flex items-center justify-center backdrop-blur-md ${p.status === 'injured' ? 'bg-[#29caff] text-white' : 'bg-white/20 text-gray-400 hover:text-[#29caff]'}`}><span className="material-icons-outlined text-sm">medical_services</span></button>
                               <button onClick={(e) => deletePlayer(p.id, e)} className="w-8 h-8 rounded-full flex items-center justify-center bg-white/20 backdrop-blur-md text-gray-400 hover:text-red-500 transition-colors"><span className="material-icons-outlined text-sm">delete</span></button>
                            </div>
                            <div className="absolute top-0 left-0 w-full px-6 py-6 flex justify-between items-start z-20 pointer-events-none">
                                <img src={TEAM_LOGO_URL} className="w-10 h-10 object-contain opacity-80" />
                                <span className="font-display font-black text-5xl text-gray-300 dark:text-gray-800 group-hover:text-primary/20 transition-colors">{p.jerseyNumber}</span>
                            </div>
                            <div className="absolute bottom-14 left-0 right-0 h-4/5 z-10 flex items-end justify-center">
                                <img src={p.photoUrl} className={`h-full w-auto max-w-[120%] object-cover object-top transition-all duration-500 ${p.status === 'injured' ? 'grayscale opacity-60' : ''}`} style={{ WebkitMaskImage: 'linear-gradient(to bottom, black 70%, transparent 100%)' }} />
                                <div className="absolute inset-0 bg-gradient-to-t from-gray-200 dark:from-[#0f1115] via-transparent to-transparent pointer-events-none"></div>
                            </div>
                            <div className="relative z-20 w-full text-center mb-28 md:mb-24 px-2">
                                 <span className="block text-3xl md:text-5xl font-black uppercase text-white leading-none tracking-tighter truncate">{p.name.split(' ')[0]}</span>
                                 <div className="mt-2 flex justify-center">
                                    <span className={`text-[10px] font-bold uppercase text-white px-2 py-0.5 rounded-full ${p.status === 'injured' ? 'bg-[#29caff]' : (isGoalkeeper ? 'bg-[#f9abd8]' : (isPaid ? 'bg-green-500' : 'bg-red-500'))}`}>
                                      {p.status === 'injured' ? 'Afastado' : (isGoalkeeper ? 'Goleiro Isento' : (isPaid ? 'Pago' : 'Pendente'))}
                                    </span>
                                 </div>
                            </div>
                            <div className="absolute bottom-0 w-full px-6 z-20 bg-gradient-to-t from-black/90 to-transparent pt-10 pb-6">
                                <div className="flex items-center justify-between border-t border-white/20 pt-4">
                                    {!isGoalkeeper ? (
                                      <>
                                        {p.status === 'injured' && !isPaid ? (
                                           <div className="flex flex-col w-full text-center">
                                              <span className="text-[9px] uppercase font-bold text-muted-light mb-1 tracking-widest">Afastado</span>
                                              <span className="font-bold text-white/50 text-xs italic">Sem cobrança ativa</span>
                                           </div>
                                        ) : (
                                          <>
                                            <div className="flex flex-col">
                                              <span className="text-[9px] uppercase font-bold text-gray-400 mb-1">
                                                {isPaid ? 'Mensalidade' : 'Total Devido'}
                                              </span>
                                              <span className={`font-bold text-white text-lg ${!isPaid && displayValue > p.value ? 'text-red-400' : ''}`}>
                                                R$ {displayValue}
                                              </span>
                                            </div>
                                            <label className="cursor-pointer">
                                                <input type="checkbox" className="sr-only peer" checked={isPaid} onChange={() => togglePayment(p.id)} disabled={p.status === 'injured'} />
                                                <div className="w-12 h-7 bg-white/10 rounded-full peer-checked:bg-primary transition-all relative backdrop-blur-md border border-white/10 shadow-inner">
                                                    <div className={`absolute top-1 left-1 bg-white w-5 h-5 rounded-full transition-all shadow-md ${isPaid ? 'translate-x-5' : ''}`}></div>
                                                </div>
                                            </label>
                                          </>
                                        )}
                                      </>
                                    ) : (
                                      <div className="flex flex-col w-full text-center">
                                        <span className="text-[9px] uppercase font-bold text-[#f9abd8] mb-1 tracking-widest">Inscrito como Goleiro</span>
                                        <span className="font-bold text-white/50 text-xs italic">Não há custos mensais</span>
                                      </div>
                                    )}
                                </div>
                            </div>
                        </div>
                       );
                   })}
              </div>
          </div>
      </div>
    );
  };

  const renderMatches = () => {
    const upcoming = matches.filter(m => !m.isFinished).sort((a,b) => a.date.localeCompare(b.date));
    const history = matches.filter(m => m.isFinished).sort((a,b) => b.date.localeCompare(a.date));
    const list = matchViewMode === 'upcoming' ? upcoming : history;
    const filtered = list.filter(m => m.opponent.toLowerCase().includes(searchQuery.toLowerCase()));

    return (
    <div className="space-y-8 animation-fade-in pb-20">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
             <div className="bg-surface-light dark:bg-surface-dark rounded-2xl p-6 border border-gray-200 dark:border-gray-800 flex items-center justify-between">
                  <div><h3 className="text-muted-light font-bold text-sm uppercase">Aproveitamento</h3><p className="text-4xl font-bold mt-2">{matchStats.winRate}%</p></div>
                  <div className="w-16 h-16 flex items-center justify-center">
                    <svg viewBox="0 0 100 100" className="w-full h-full transform -rotate-90">
                      <circle cx="50" cy="50" r="40" stroke="currentColor" strokeWidth="8" fill="transparent" className="text-gray-100 dark:text-gray-800" />
                      <circle cx="50" cy="50" r="40" stroke="currentColor" strokeWidth="8" fill="transparent" strokeDasharray={251.2} strokeDashoffset={251.2 - (251.2 * matchStats.winRate) / 100} strokeLinecap="round" className="text-green-500 transition-all duration-1000 ease-out" />
                    </svg>
                  </div>
             </div>
             <div className="lg:col-span-2 grid grid-cols-3 gap-2">
                 <div className="bg-green-500/10 rounded-2xl p-4 flex flex-col items-center justify-center"><span className="text-2xl font-bold text-green-500">{matchStats.wins}</span><span className="text-[10px] font-bold uppercase text-green-600">Vitórias</span></div>
                 <div className="bg-gray-200/50 dark:bg-gray-700/30 rounded-2xl p-4 flex flex-col items-center justify-center"><span className="text-2xl font-bold text-gray-500">{matchStats.draws}</span><span className="text-[10px] font-bold uppercase text-gray-600">Empates</span></div>
                 <div className="bg-red-500/10 rounded-2xl p-4 flex flex-col items-center justify-center"><span className="text-2xl font-bold text-red-500">{matchStats.losses}</span><span className="text-[10px] font-bold uppercase text-red-600">Derrotas</span></div>
             </div>
             <div className="bg-surface-light dark:bg-surface-dark rounded-2xl p-5 border border-gray-200 dark:border-gray-800 flex flex-col justify-between">
                  <h3 className="text-muted-light font-bold text-[10px] uppercase mb-1">Estatísticas Gerais</h3>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                    <div className="flex justify-between items-center text-[11px] font-bold"><span className="opacity-60">Jogos:</span> <span>{matchStats.total}</span></div>
                    <div className="flex justify-between items-center text-[11px] font-bold"><span className="opacity-60">Gols Pró:</span> <span>{matchStats.goalsFor}</span></div>
                    <div className="flex justify-between items-center text-[11px] font-bold"><span className="opacity-60">Gols Contra:</span> <span>{matchStats.goalsAgainst}</span></div>
                    <div className="flex justify-between items-center text-[11px] font-bold"><span className="opacity-60">Saldo:</span> <span className={matchStats.goalDiff >= 0 ? 'text-primary' : 'text-red-500'}>{matchStats.goalDiff > 0 ? '+' : ''}{matchStats.goalDiff}</span></div>
                  </div>
             </div>
        </div>

        {/* CALENDÁRIO DE DOMINGOS */}
        <div className="bg-surface-light dark:bg-surface-dark rounded-[2.5rem] p-6 md:p-8 border border-gray-200 dark:border-gray-800 shadow-sm relative overflow-hidden">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
                <div>
                    <h3 className="text-xl font-bold flex items-center gap-2">Agenda de Domingos</h3>
                    <p className="text-[10px] font-bold uppercase opacity-40 mt-1 tracking-widest">Disponibilidade do Elenco</p>
                </div>
                <div className="flex items-center gap-2 bg-gray-100 dark:bg-black/20 px-2 py-1 rounded-full border border-gray-200 dark:border-gray-700">
                    <button onClick={() => changeMonth(-1)} className="p-2 hover:bg-gray-200 dark:hover:bg-gray-800 rounded-full transition-colors"><span className="material-icons-outlined">chevron_left</span></button>
                    <span className="font-bold text-xs px-2 min-w-[120px] text-center uppercase tracking-widest">{selectedDate.toLocaleDateString('pt-BR', {month: 'long', year: 'numeric'})}</span>
                    <button onClick={() => changeMonth(1)} className="p-2 hover:bg-gray-200 dark:hover:bg-gray-800 rounded-full transition-colors"><span className="material-icons-outlined">chevron_right</span></button>
                </div>
            </div>
            
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
                {sundaysOfMonth.map((sunday) => {
                    const dateStr = sunday.toISOString().split('T')[0];
                    const matchOnThisDay = matches.find(m => m.date === dateStr);
                    const isPast = sunday < new Date(new Date().setHours(0,0,0,0));
                    
                    return (
                        <div key={dateStr} className={`relative flex flex-col p-5 rounded-[2rem] border-2 transition-all duration-500 ${matchOnThisDay ? 'bg-primary/5 border-primary shadow-lg shadow-primary/10' : 'bg-gray-50 dark:bg-black/20 border-transparent hover:border-gray-200 dark:hover:border-gray-700'}`}>
                            <div className="flex flex-col mb-4">
                                <span className={`text-5xl font-black italic tracking-tighter leading-none ${matchOnThisDay ? 'text-primary' : 'opacity-20'}`}>{sunday.getDate()}</span>
                                <div className="mt-2">
                                    <span className={`inline-block text-[7px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full ${matchOnThisDay ? 'bg-primary text-white shadow-sm shadow-primary/20' : 'bg-gray-200 dark:bg-white/10 opacity-60'}`}>
                                        {matchOnThisDay ? 'Reservado' : 'Livre'}
                                    </span>
                                </div>
                            </div>
                            {matchOnThisDay ? (
                                <div className="space-y-1">
                                    <p className="text-[10px] font-black uppercase italic truncate tracking-tight">{matchOnThisDay.opponent}</p>
                                    <p className="text-[8px] font-bold opacity-40 uppercase">{matchOnThisDay.time.slice(0,5)} • {matchOnThisDay.location}</p>
                                </div>
                            ) : (
                                <p className="text-[9px] font-bold opacity-30 uppercase italic">Livre</p>
                            )}
                            {isPast && !matchOnThisDay && <div className="absolute inset-0 bg-white/40 dark:bg-black/40 rounded-[2rem] backdrop-grayscale-[0.5] pointer-events-none"></div>}
                        </div>
                    );
                })}
            </div>
        </div>

        <div>
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-4 gap-4">
                <div className="flex bg-gray-200 dark:bg-surface-dark p-1 rounded-lg">
                    <button onClick={() => setMatchViewMode('upcoming')} className={`px-4 py-1.5 rounded-md text-xs font-bold transition-all ${matchViewMode === 'upcoming' ? 'bg-white dark:bg-gray-700 shadow text-primary' : 'text-muted-light'}`}>Próximos</button>
                    <button onClick={() => setMatchViewMode('history')} className={`px-4 py-1.5 rounded-md text-xs font-bold transition-all ${matchViewMode === 'history' ? 'bg-white dark:bg-gray-700 shadow text-primary' : 'text-muted-light'}`}>Histórico</button>
                </div>
                <div className="flex w-full md:w-auto items-center gap-2 flex-wrap">
                    <div className="relative flex-1 min-w-[150px]">
                      <input type="text" placeholder="Buscar..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full bg-white dark:bg-black/20 border border-gray-200 dark:border-gray-700 rounded-full px-4 py-2 text-sm font-bold pl-10" />
                      <span className="material-icons-outlined absolute left-3 top-1/2 -translate-y-1/2 text-muted-light text-sm">search</span>
                    </div>
                    <button onClick={() => {setAddMode('match'); setIsAddModalOpen(true);}} className="flex items-center justify-center gap-2 bg-primary text-white px-4 py-2 rounded-xl font-bold text-sm shadow-lg shadow-primary/20 whitespace-nowrap"><span className="material-icons-outlined text-lg">add</span> Nova Partida</button>
                </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {filtered.map(m => (
                    <div key={m.id} className={`relative rounded-2xl overflow-hidden flex flex-col transition-all duration-300 ${matchViewMode === 'upcoming' ? 'bg-gradient-to-br from-primary to-[#f9abd8] text-black' : 'bg-surface-light dark:bg-surface-dark border border-gray-200 dark:border-gray-800 shadow-sm'}`}>
                        <div className="absolute top-3 right-3 z-30"><button onClick={(e) => deleteMatch(m.id, e)} className={`p-2 rounded-full hover:bg-black/10 ${matchViewMode === 'upcoming' ? 'text-black' : 'text-muted-light'}`}><span className="material-icons-outlined text-lg">delete_outline</span></button></div>
                        <div className="p-6 pt-10 flex items-center justify-between">
                             <div className="flex flex-col items-center gap-2 w-1/3"><img src={TEAM_LOGO_URL} className="w-10 h-10 object-contain" /><span className="font-bold text-xs truncate">Pesadão</span></div>
                             <div className="flex flex-col items-center justify-center w-1/3">
                                 <div className="px-3 py-1.5 rounded-lg font-mono text-3xl font-bold mb-2">{m.isFinished ? `${m.homeScore}-${m.awayScore}` : 'VS'}</div>
                                 <div className="text-[10px] font-bold uppercase opacity-80 text-center"><span>{new Date(m.date + 'T00:00:00').toLocaleDateString('pt-BR')}</span><br/><span>{m.time.slice(0,5)}</span></div>
                             </div>
                             <div className="flex flex-col items-center gap-2 w-1/3 text-center"><div className="w-10 h-10 rounded-full flex items-center justify-center bg-white/10 overflow-hidden">{m.locationImg ? <img src={m.locationImg} className="w-full h-full object-cover" /> : <span className="material-icons-outlined">sports_soccer</span>}</div><span className="font-bold text-xs truncate w-full">{m.opponent}</span></div>
                        </div>
                        <div className={`p-3 border-t flex items-center gap-2 justify-center ${matchViewMode === 'upcoming' ? 'border-black/10 bg-black/5' : 'border-gray-100 dark:border-gray-800'}`}>
                             <button onClick={() => openMatchResultModal(m)} className={`flex-1 py-2.5 rounded-lg text-xs font-bold uppercase flex items-center justify-center gap-2 transition-all ${matchViewMode === 'upcoming' ? 'bg-black/10 text-black' : 'bg-white dark:bg-surface-dark border border-gray-200 dark:border-gray-700 hover:bg-primary hover:text-white'}`}>
                                 <span className="material-icons-outlined text-[14px]">{m.isFinished ? "edit" : "sports_score"}</span> {m.isFinished ? "Relatório" : "Informar Placar"}
                             </button>
                             {m.isFinished && (
                               <button 
                                 onClick={(e) => { e.stopPropagation(); openMatchShareModal(m); }}
                                 title="Compartilhar no WhatsApp"
                                 className="px-3.5 py-2.5 rounded-lg text-xs font-bold uppercase flex items-center justify-center gap-1.5 transition-all bg-green-500/10 hover:bg-green-500/20 text-green-600 dark:text-green-400 border border-green-500/20"
                               >
                                 <span className="material-icons-outlined text-[14px]">share</span>
                                 Zap
                               </button>
                             )}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    </div>
  );
  };

  const renderStats = () => {
    const filteredPlayers = players.filter(p => p.name.toLowerCase().includes(searchQuery.toLowerCase()));
    const bestScorer = topScorers[0];
    const mostMatches = topAppearances[0];

    return (
      <div className="space-y-8 animation-fade-in pb-20">
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-surface-light dark:bg-surface-dark rounded-2xl p-4 border border-gray-200 dark:border-gray-800 shadow-sm relative overflow-hidden flex flex-col items-center text-center">
            <div className="relative mb-2">
              {bestScorer ? (
                <>
                  <img src={bestScorer.photoUrl} className="w-16 h-16 rounded-full object-cover object-top border-2 border-yellow-500 shadow-md" />
                  <div className="absolute -top-1 -right-1 bg-yellow-500 text-white w-5 h-5 rounded-full flex items-center justify-center border-2 border-surface-light dark:border-surface-dark shadow-sm">
                    <span className="material-icons-outlined text-[10px]">emoji_events</span>
                  </div>
                </>
              ) : (
                <div className="w-16 h-16 rounded-full bg-gray-100 dark:bg-black/20 flex items-center justify-center"><span className="material-icons-outlined opacity-20">person</span></div>
              )}
            </div>
            <div className="flex-1">
              <span className="text-[9px] font-black uppercase tracking-widest text-muted-light block">Artilheiro</span>
              <h4 className="text-xs font-black uppercase italic tracking-tighter truncate max-w-[100px] mt-1">{bestScorer ? bestScorer.name : '---'}</h4>
              <p className="text-xl font-black text-primary leading-none mt-1">{bestScorer ? bestScorer.goals : 0} <span className="text-[8px] font-bold uppercase opacity-40">Gols</span></p>
            </div>
            <button onClick={() => { setRankingType('goals'); setIsRankingModalOpen(true); }} className="mt-3 text-[8px] font-black uppercase tracking-widest bg-gray-100 dark:bg-black/30 px-3 py-1.5 rounded-full hover:bg-primary hover:text-white transition-all">Ver Ranking</button>
          </div>

          <div className="bg-surface-light dark:bg-surface-dark rounded-2xl p-4 border border-gray-200 dark:border-gray-800 shadow-sm relative overflow-hidden flex flex-col items-center text-center">
            <div className="relative mb-2">
              {mostMatches ? (
                <>
                  <img src={mostMatches.photoUrl} className="w-16 h-16 rounded-full object-cover object-top border-2 border-[#f9abd8] shadow-md" />
                  <div className="absolute -top-1 -right-1 bg-[#f9abd8] text-white w-5 h-5 rounded-full flex items-center justify-center border-2 border-surface-light dark:border-surface-dark shadow-sm">
                    <span className="material-icons-outlined text-[10px]">history</span>
                  </div>
                </>
              ) : (
                <div className="w-16 h-16 rounded-full bg-gray-100 dark:bg-black/20 flex items-center justify-center"><span className="material-icons-outlined opacity-20">person</span></div>
              )}
            </div>
            <div className="flex-1">
              <span className="text-[9px] font-black uppercase tracking-widest text-muted-light block">Participações</span>
              <h4 className="text-xs font-black uppercase italic tracking-tighter truncate max-w-[100px] mt-1">{mostMatches ? mostMatches.name : '---'}</h4>
              <p className="text-xl font-black text-[#f9abd8] leading-none mt-1">{mostMatches ? mostMatches.matchesPlayed : 0} <span className="text-[8px] font-bold uppercase opacity-40">Jogos</span></p>
            </div>
            <button onClick={() => { setRankingType('matches'); setIsRankingModalOpen(true); }} className="mt-3 text-[8px] font-black uppercase tracking-widest bg-gray-100 dark:bg-black/30 px-3 py-1.5 rounded-full hover:bg-[#f9abd8] hover:text-white transition-all">Ver Ranking</button>
          </div>
        </div>

        <div className="space-y-6">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <h3 className="text-xl font-bold flex items-center gap-2">Desempenho por Atleta</h3>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {filteredPlayers.map(p => {
              return (
                <div 
                  key={p.id} 
                  onClick={() => { setSelectedPlayerForDetail(p); setIsPlayerDetailModalOpen(true); }}
                  className={`relative group h-[280px] md:h-[340px] bg-gradient-to-b from-white to-gray-200 dark:from-[#1a1d22] dark:to-[#0f1115] rounded-[2.5rem] border ${p.status === 'injured' ? 'border-[#f9abd8]/50' : 'border-gray-200 dark:border-gray-800'} transition-all duration-500 hover:-translate-y-2 hover:shadow-2xl overflow-hidden flex flex-col justify-end cursor-pointer`}
                >
                  <div className="absolute top-0 left-0 w-full px-6 py-6 flex justify-between items-start z-20 pointer-events-none">
                    <img src={TEAM_LOGO_URL} className="w-10 h-10 object-contain opacity-80" />
                    <span className="font-display font-black text-5xl text-gray-300 dark:text-gray-800 group-hover:text-primary/20 transition-colors">{p.jerseyNumber}</span>
                  </div>
                  <div className="absolute bottom-14 left-0 right-0 h-4/5 z-10 flex items-end justify-center">
                    <img src={p.photoUrl} className={`h-full w-auto max-w-[120%] object-cover object-top transition-all duration-500 ${p.status === 'injured' ? 'grayscale opacity-60' : ''}`} style={{ WebkitMaskImage: 'linear-gradient(to bottom, black 70%, transparent 100%)' }} />
                    <div className="absolute inset-0 bg-gradient-to-t from-gray-200 dark:from-[#0f1115] via-transparent to-transparent pointer-events-none"></div>
                  </div>
                  <div className="relative z-20 w-full text-center mb-28 md:mb-24 px-2">
                    <span className="block text-3xl md:text-5xl font-black uppercase text-white leading-none tracking-tighter truncate drop-shadow-lg">{p.name.split(' ')[0]}</span>
                  </div>
                  <div className="absolute bottom-0 w-full px-6 z-20 bg-gradient-to-t from-black/90 to-transparent pt-10 pb-6">
                    <div className="flex items-center justify-between border-t border-white/20 pt-4">
                      <div className="flex flex-col"><span className="text-[8px] uppercase font-black text-primary mb-1 tracking-widest">Gols</span><span className="font-black text-white text-lg leading-none">{p.goals}</span></div>
                      <div className="flex flex-col text-center"><span className="text-[8px] uppercase font-black text-muted-dark mb-1 tracking-widest">Posição</span><span className="font-black text-white text-lg leading-none">{p.position}</span></div>
                      <div className="flex flex-col text-right"><span className="text-[8px] uppercase font-black text-[#f9abd8] mb-1 tracking-widest">Jogos</span><span className="font-black text-white text-lg leading-none">{p.matchesPlayed}</span></div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-background-light dark:bg-background-dark text-gray-900 dark:text-gray-100 font-display p-4 md:p-8 transition-colors duration-300 pb-24 md:pb-8">
        <div className="max-w-7xl mx-auto flex flex-row items-center justify-between mb-4 md:mb-8 sticky top-0 bg-background-light/95 dark:bg-background-dark/95 backdrop-blur z-40 py-4">
             <div className="flex items-center gap-3"><img src={TEAM_LOGO_URL} className="w-10 h-10 md:w-12 md:h-12 object-contain" /><h1 className="text-lg md:text-xl font-bold tracking-tight">Pesadão F.C<span className="text-primary">.</span></h1></div>
             <nav className="hidden md:flex bg-gray-200 dark:bg-surface-dark p-1.5 rounded-full">
                 <button onClick={() => setCurrentTab('financial')} className={`px-4 py-2 rounded-full text-sm font-bold transition-all ${currentTab === 'financial' ? 'bg-white dark:bg-gray-700 shadow text-primary' : 'text-muted-light'}`}>Financeiro</button>
                 <button onClick={() => setCurrentTab('matches')} className={`px-4 py-2 rounded-full text-sm font-bold transition-all ${currentTab === 'matches' ? 'bg-white dark:bg-gray-700 shadow text-primary' : 'text-muted-light'}`}>Jogos</button>
                 <button onClick={() => setCurrentTab('stats')} className={`px-4 py-2 rounded-full text-sm font-bold transition-all ${currentTab === 'stats' ? 'bg-white dark:bg-gray-700 shadow text-primary' : 'text-muted-light'}`}>Jogadores</button>
                 <button onClick={() => setCurrentTab('whatsapp')} className={`px-4 py-2 rounded-full text-sm font-bold transition-all flex items-center gap-1.5 ${currentTab === 'whatsapp' ? 'bg-white dark:bg-gray-700 shadow text-primary font-black' : 'text-muted-light'}`}>
                   <span className="material-icons-outlined text-sm text-green-500">chat</span>
                   WhatsApp
                 </button>
             </nav>
             <button onClick={toggleTheme} className="w-10 h-10 rounded-full bg-surface-light dark:bg-surface-dark border border-gray-200 dark:border-gray-700 flex items-center justify-center hover:text-primary transition-colors"><span className="material-icons-outlined">{theme === 'dark' ? 'light_mode' : 'dark_mode'}</span></button>
        </div>

        <main className="max-w-7xl mx-auto">
             {currentTab === 'financial' && renderFinancial()}
             {currentTab === 'matches' && renderMatches()}
             {currentTab === 'stats' && renderStats()}
             {currentTab === 'whatsapp' && <WhatsAppTab players={players} selectedDate={selectedDate} matches={matches} />}
        </main>

        <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-surface-light/90 dark:bg-surface-dark/90 backdrop-blur-xl border-t border-gray-200 dark:border-gray-800 p-2 z-50 flex justify-around items-center safe-area-bottom pb-4 shadow-lg">
             <button onClick={() => setCurrentTab('financial')} className={`flex flex-col items-center justify-center w-full p-2 rounded-lg ${currentTab === 'financial' ? 'text-primary font-black' : 'text-muted-light'}`}><span className="material-icons-outlined mb-1 text-2xl">attach_money</span><span className="text-[10px] font-bold uppercase">Financeiro</span></button>
             <button onClick={() => setCurrentTab('matches')} className={`flex flex-col items-center justify-center w-full p-2 rounded-lg ${currentTab === 'matches' ? 'text-primary font-black' : 'text-muted-light'}`}><span className="material-icons-outlined mb-1 text-2xl">sports_soccer</span><span className="text-[10px] font-bold uppercase">Jogos</span></button>
             <button onClick={() => setCurrentTab('stats')} className={`flex flex-col items-center justify-center w-full p-2 rounded-lg ${currentTab === 'stats' ? 'text-primary font-black' : 'text-muted-light'}`}><span className="material-icons-outlined mb-1 text-2xl">groups</span><span className="text-[10px] font-bold uppercase">Jogadores</span></button>
             <button onClick={() => setCurrentTab('whatsapp')} className={`flex flex-col items-center justify-center w-full p-2 rounded-lg ${currentTab === 'whatsapp' ? 'text-primary font-black' : 'text-muted-light'}`}><span className="material-icons-outlined mb-1 text-2xl text-green-500">chat</span><span className="text-[10px] font-bold uppercase">WhatsApp</span></button>
        </nav>

        {/* MODAL RANKING COMPLETO */}
        {isRankingModalOpen && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-fade-in">
            <div className="bg-surface-light dark:bg-surface-dark w-full max-sm rounded-3xl border border-gray-200 dark:border-gray-800 overflow-hidden shadow-2xl">
              <div className="p-6 border-b border-gray-100 dark:border-gray-800 flex justify-between items-center">
                <h3 className="font-black uppercase tracking-widest text-xs italic">Ranking: {rankingType === 'goals' ? 'Artilheiros' : 'Participações'}</h3>
                <button onClick={() => setIsRankingModalOpen(false)} className="material-icons-outlined opacity-40">close</button>
              </div>
              <div className="p-6 space-y-4">
                {(rankingType === 'goals' ? topScorers : topAppearances).slice(0, 5).map((p, i) => (
                  <div key={p.id} className="flex items-center justify-between p-3 rounded-2xl bg-gray-50 dark:bg-black/20">
                    <div className="flex items-center gap-3">
                      <span className={`text-xl font-black italic ${i === 0 ? 'text-yellow-500' : i === 1 ? 'text-gray-400' : 'text-orange-500'}`}>{i+1}º</span>
                      <img src={p.photoUrl} className="w-10 h-10 rounded-full object-cover object-top" />
                      <span className="text-xs font-bold">{p.name}</span>
                    </div>
                    <span className="text-sm font-black text-primary">
                      {rankingType === 'goals' ? p.goals : p.matchesPlayed}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* MODAL DETALHE DO JOGADOR */}
        {isPlayerDetailModalOpen && selectedPlayerForDetail && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-xl animate-fade-in overflow-y-auto">
            <div className="bg-surface-light dark:bg-surface-dark w-full max-w-xl my-auto rounded-[2.5rem] border border-gray-200 dark:border-gray-800 overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
              <div className="relative p-6 md:p-8 flex flex-col items-center flex-shrink-0 bg-gray-50/50 dark:bg-black/20">
                <button onClick={() => setIsPlayerDetailModalOpen(false)} className="absolute top-6 right-6 w-9 h-9 rounded-full bg-black/5 dark:bg-white/5 flex items-center justify-center hover:bg-black/10 transition-colors"><span className="material-icons-outlined">close</span></button>
                <div className="w-32 h-32 md:w-36 md:h-36 relative mb-4">
                  <div className="w-full h-full rounded-3xl overflow-hidden border-4 border-primary shadow-xl bg-gray-100 dark:bg-black/40">
                    <img src={selectedPlayerForDetail.photoUrl} className="w-full h-full object-cover object-top" />
                  </div>
                  <div className="absolute -bottom-1 -right-1 bg-primary text-white font-black text-lg px-3 py-1 rounded-xl shadow-lg leading-none">#{selectedPlayerForDetail.jerseyNumber}</div>
                </div>
                <div className="text-center">
                  <h3 className="text-2xl font-black uppercase italic tracking-tighter leading-none mb-1">{selectedPlayerForDetail.name}</h3>
                  <span className="text-[10px] font-black uppercase tracking-widest text-primary">{selectedPlayerForDetail.position}</span>
                </div>
                <div className="grid grid-cols-3 gap-2 w-full mt-6">
                  <div className="bg-white dark:bg-black/20 p-3 rounded-2xl text-center border border-black/5">
                    <span className="text-xl font-black text-primary leading-none block">
                      {selectedPlayerForDetail.goals}
                    </span>
                    <p className="text-[8px] font-bold uppercase opacity-40 mt-1">Gols</p>
                  </div>
                  <div className="bg-white dark:bg-black/20 p-3 rounded-2xl text-center border border-black/5">
                    <span className="text-xl font-black leading-none block">
                      {selectedPlayerForDetail.matchesPlayed}
                    </span>
                    <p className="text-[8px] font-bold uppercase opacity-40 mt-1">Partidas</p>
                  </div>
                  <div className="bg-white dark:bg-black/20 p-3 rounded-2xl text-center border border-black/5">
                    <span className="text-xl font-black text-[#f9abd8] leading-none block">
                      {playerStarterCount}
                    </span>
                    <p className="text-[8px] font-bold uppercase opacity-40 mt-1">Titular</p>
                  </div>
                </div>

                {selectedPlayerForDetail.position === 'GOL' && (
                  <div className="grid grid-cols-2 gap-4 w-full mt-4">
                    <div className="bg-white dark:bg-black/20 p-3 rounded-2xl text-center border border-black/5">
                      <span className="text-xl font-black text-[#29caff] leading-none block">
                        {gkStats[selectedPlayerForDetail.id]?.golsSofridos || 0}
                      </span>
                      <p className="text-[8px] font-black uppercase opacity-40 mt-1">Gols Sofridos</p>
                    </div>
                    <div className="bg-white dark:bg-black/20 p-3 rounded-2xl text-center border border-black/5">
                      <span className="text-xl font-black text-[#29caff] leading-none block">
                        {gkStats[selectedPlayerForDetail.id]?.jogosSemSofrerGols || 0}
                      </span>
                      <p className="text-[8px] font-black uppercase opacity-40 mt-1">Jogos s/ Gols</p>
                    </div>
                  </div>
                )}
              </div>

              {/* Seção de Histórico */}
              <div className="flex-1 overflow-y-auto p-6 md:p-8 scrollbar-hide">
                <h4 className="text-[11px] font-bold uppercase text-primary mb-4 flex items-center gap-2">
                  <span className="material-icons-outlined text-sm">history</span> Histórico de Atuações
                </h4>
                <div className="space-y-3">
                  {matches
                    .filter(m => {
                      if (!m.isFinished || !m.lineup) return false;
                      const lineup = typeof m.lineup === 'string' ? JSON.parse(m.lineup) : m.lineup;
                      return lineup[selectedPlayerForDetail.id]?.present;
                    })
                    .sort((a, b) => b.date.localeCompare(a.date))
                    .map(match => {
                      const lineup = typeof match.lineup === 'string' ? JSON.parse(match.lineup) : match.lineup;
                      const playerMatchStat = lineup[selectedPlayerForDetail.id];
                      return (
                        <div key={match.id} className="bg-gray-50 dark:bg-black/20 p-4 rounded-2xl border border-black/5 flex items-center justify-between">
                          <div className="flex flex-col">
                            <span className="text-[10px] font-bold opacity-40 uppercase">{new Date(match.date + 'T00:00:00').toLocaleDateString('pt-BR')}</span>
                            <span className="text-xs font-black uppercase italic tracking-tight truncate max-w-[120px]">vs {match.opponent}</span>
                          </div>
                          <div className="flex items-center gap-4">
                            <div className="flex flex-col items-center">
                              <span className={`text-xs font-black px-2 py-0.5 rounded ${match.result === 'win' ? 'bg-green-500/10 text-green-500' : match.result === 'loss' ? 'bg-red-500/10 text-red-500' : 'bg-gray-500/10 text-gray-500'}`}>
                                {match.homeScore}-{match.awayScore}
                              </span>
                              <span className="text-[7px] font-bold opacity-30 uppercase mt-0.5">{match.result === 'win' ? 'Vitória' : match.result === 'loss' ? 'Derrota' : 'Empate'}</span>
                            </div>
                            {playerMatchStat && playerMatchStat.goals > 0 && (
                              <div className="flex items-center gap-1 bg-primary/10 px-2 py-1 rounded-lg">
                                <span className="material-icons-outlined text-primary text-[10px]">sports_soccer</span>
                                <span className="text-[10px] font-black text-primary">{playerMatchStat.goals}</span>
                              </div>
                            )}
                            {playerMatchStat && playerMatchStat.starterPos !== undefined && (
                              <div className="flex items-center gap-1 bg-orange-500/10 px-2 py-1 rounded-lg">
                                <span className="material-icons-outlined text-orange-500 text-[10px]">stadium</span>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  {matches.filter(m => {
                    if (!m.isFinished || !m.lineup) return false;
                    const lineup = typeof m.lineup === 'string' ? JSON.parse(m.lineup) : m.lineup;
                    return lineup[selectedPlayerForDetail.id]?.present;
                  }).length === 0 && (
                    <div className="py-8 text-center">
                      <p className="text-[10px] font-bold uppercase opacity-30 italic">Nenhuma partida registrada na súmula.</p>
                    </div>
                  )}
                </div>
              </div>

              <div className="p-6 md:p-8 border-t border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-black/20">
                <button onClick={() => setIsPlayerDetailModalOpen(false)} className="w-full py-4 bg-white dark:bg-gray-800 rounded-2xl text-[10px] font-bold uppercase tracking-widest border border-black/5 shadow-sm active:scale-95 transition-all">Fechar Perfil</button>
              </div>
            </div>
          </div>
        )}

        {/* MODAL DE RESULTADO DA PARTIDA */}
        {isMatchResultModalOpen && selectedMatch && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in overflow-y-auto">
            <div className="bg-surface-light dark:bg-surface-dark w-full max-w-2xl my-auto rounded-[2.5rem] border border-gray-200 dark:border-gray-800 overflow-hidden shadow-2xl flex flex-col max-h-[95vh]">
              
              <div className="p-5 md:p-6 border-b border-gray-100 dark:border-gray-800 bg-gradient-to-b from-gray-50/80 to-transparent dark:from-black/40 flex-shrink-0">
                <div className="flex justify-between items-center mb-6">
                  <div className="flex flex-col">
                    <h3 className="text-xl font-black italic uppercase tracking-tight leading-none">Relatório de Jogo</h3>
                    <span className="text-[10px] font-black uppercase tracking-widest text-primary mt-1">Súmula Técnica</span>
                  </div>
                  <button onClick={() => setIsMatchResultModalOpen(false)} className="w-9 h-9 rounded-full bg-black/5 dark:bg-white/5 flex items-center justify-center hover:bg-black/10 transition-colors">
                    <span className="material-icons-outlined opacity-40 hover:opacity-100">close</span>
                  </button>
                </div>
                
                {/* INFO CARD TOP - RESUMO IGUAL AGENDA */}
                <div className="bg-white/5 dark:bg-black/20 backdrop-blur-xl border border-black/5 dark:border-white/10 rounded-[2rem] p-5 flex items-center justify-between mb-2 shadow-inner">
                    <div className="flex flex-col items-center gap-1.5 flex-1 min-w-0">
                        <img src={TEAM_LOGO_URL} className="w-9 h-9 object-contain" />
                        <span className="text-[10px] font-black uppercase italic tracking-tighter leading-none truncate w-full text-center">Pesadão</span>
                    </div>
                    
                    <div className="flex flex-col items-center justify-center px-2 md:px-4 flex-shrink-0">
                        <div className="flex items-center gap-2 md:gap-3 mb-1">
                          <input 
                            type="number" 
                            value={manualHomeScore} 
                            onChange={(e) => setManualHomeScore(e.target.value)} 
                            className="w-14 md:w-20 text-center text-2xl md:text-3xl font-black bg-white/10 dark:bg-black/30 rounded-xl py-2 px-1 outline-none border-b-2 border-primary focus:bg-primary/10 transition-all [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" 
                          />
                          <span className="text-lg md:text-xl font-black opacity-20 italic">X</span>
                          <input 
                            type="number" 
                            value={manualAwayScore} 
                            onChange={(e) => setManualAwayScore(e.target.value)} 
                            className="w-14 md:w-20 text-center text-2xl md:text-3xl font-black bg-white/10 dark:bg-black/30 rounded-xl py-2 px-1 outline-none border-b-2 border-primary focus:bg-primary/10 transition-all [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" 
                          />
                        </div>
                        <div className="text-[9px] font-bold uppercase opacity-50 text-center leading-tight">
                            {new Date(selectedMatch.date + 'T00:00:00').toLocaleDateString('pt-BR', {day:'2-digit', month:'short'})} • {selectedMatch.time.slice(0,5)}
                        </div>
                    </div>

                    <div className="flex flex-col items-center gap-1.5 flex-1 min-w-0 text-center">
                        <div className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center border border-black/5 overflow-hidden">
                            {selectedMatch.locationImg ? <img src={selectedMatch.locationImg} className="w-full h-full object-cover" /> : <span className="material-icons-outlined text-sm">sports_soccer</span>}
                        </div>
                        <span className="text-[10px] font-black uppercase italic tracking-tighter truncate w-full leading-none">{selectedMatch.opponent}</span>
                    </div>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-5 md:p-6 space-y-6 scrollbar-hide">
                {/* CAMPO DE FUTEBOL - ESCALAÇÃO INICIAL */}
                <div className="space-y-3">
                  <h4 className="text-[11px] font-bold uppercase text-primary flex items-center gap-2 px-1">
                    <span className="material-icons-outlined text-sm">stadium</span> Escalação Inicial (7)
                  </h4>
                  <div className="relative w-full aspect-[3/4] max-w-[320px] mx-auto bg-green-900/40 dark:bg-black/40 rounded-[2.5rem] border-2 border-white/10 overflow-hidden shadow-xl backdrop-blur-md">
                    {/* Linhas do campo minimalistas */}
                    <div className="absolute inset-0 pointer-events-none opacity-20">
                      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-1/2 h-[15%] border-b-2 border-x-2 border-white"></div>
                      <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-1/2 h-[15%] border-t-2 border-x-2 border-white"></div>
                      <div className="absolute top-1/2 left-0 w-full h-0 border-t-2 border-white"></div>
                      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[30%] aspect-square border-2 border-white rounded-full"></div>
                    </div>

                    {/* Slots dos jogadores */}
                    {FIELD_POSITIONS.map(pos => {
                      const assignedPid = Object.keys(matchPlayerStats).find(pid => matchPlayerStats[pid].starterPos === pos.id);
                      const assignedPlayer = assignedPid ? players.find(p => p.id === assignedPid) : null;
                      
                      return (
                        <button
                          key={pos.id}
                          onClick={() => setActiveSlot(pos.id)}
                          style={{ top: pos.top, left: pos.left }}
                          className="absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-1 group active:scale-95 transition-transform"
                        >
                          <div className={`w-10 h-10 md:w-12 md:h-12 rounded-full border-2 flex items-center justify-center overflow-hidden transition-all ${assignedPlayer ? 'border-primary bg-surface-dark shadow-lg' : 'border-dashed border-white/30 bg-white/5 hover:border-white/50'}`}>
                            {assignedPlayer ? (
                              <img src={assignedPlayer.photoUrl} className="w-full h-full object-cover object-top" />
                            ) : (
                              <span className="material-icons-outlined text-white/30 text-lg group-hover:text-white/60">add</span>
                            )}
                          </div>
                          <div className="bg-black/60 backdrop-blur-md px-1.5 py-0.5 rounded text-[7px] font-black uppercase text-white tracking-tighter shadow-sm">
                            {assignedPlayer ? assignedPlayer.name.split(' ')[0] : pos.label}
                          </div>
                        </button>
                      );
                    })}

                    {/* Overlay de seleção de jogador no campo */}
                    {activeSlot !== null && (
                      <div className="absolute inset-0 bg-black/80 backdrop-blur-md z-30 animate-fade-in flex flex-col p-4">
                        <div className="flex justify-between items-center mb-4">
                          <span className="text-[10px] font-black uppercase text-white">Escalar {FIELD_POSITIONS[activeSlot].label}</span>
                          <button onClick={() => setActiveSlot(null)} className="material-icons-outlined text-white/60">close</button>
                        </div>
                        <div className="flex-1 overflow-y-auto space-y-2 pr-1 scrollbar-hide">
                          {players.filter(p => p.status === 'active').map(p => (
                            <button
                              key={p.id}
                              onClick={() => setPlayerToFieldSlot(p.id, activeSlot)}
                              className="w-full flex items-center gap-3 p-2 rounded-xl bg-white/5 hover:bg-primary/20 transition-colors"
                            >
                              <img src={p.photoUrl} className="w-8 h-8 rounded-full object-cover object-top" />
                              <div className="flex flex-col items-start">
                                <span className="text-[10px] font-bold text-white">{p.name}</span>
                                <span className="text-[8px] font-bold text-white/40 uppercase">{p.position}</span>
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div>
                    <h4 className="text-[11px] font-bold uppercase text-primary mb-3 flex items-center gap-2 px-1">
                      <span className="material-icons-outlined text-sm">groups</span> Presença e Gols do Elenco
                    </h4>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {players.filter(p => p.status === 'active').map(player => {
                            const stat = matchPlayerStats[player.id] || { goals: 0, present: false };
                            return (
                                <div 
                                    key={player.id} 
                                    onClick={() => toggleMatchPresence(player.id)}
                                    className={`flex items-center justify-between p-2.5 rounded-[1.5rem] border transition-all cursor-pointer ${
                                        stat.present 
                                        ? 'bg-primary/10 border-primary/50' 
                                        : 'bg-gray-50 dark:bg-black/20 border-transparent opacity-60 grayscale'
                                    }`}
                                >
                                    <div className="flex items-center gap-3">
                                        <div className="relative">
                                            <img src={player.photoUrl} className="w-9 h-9 rounded-full object-cover object-top border border-white dark:border-gray-800" />
                                            {stat.present && (
                                                <div className="absolute -top-1 -right-1 bg-green-500 text-white w-4 h-4 rounded-full flex items-center justify-center border border-surface-light dark:border-surface-dark">
                                                    <span className="material-icons-outlined text-[8px] font-bold">check</span>
                                                </div>
                                            )}
                                        </div>
                                        <div className="flex flex-col">
                                            <span className="text-[11px] font-bold truncate max-w-[90px]">{player.name}</span>
                                            <span className="text-[8px] font-bold opacity-40 uppercase">{player.position}</span>
                                        </div>
                                    </div>

                                    {stat.present && (
                                        <div className="flex items-center gap-1 bg-white dark:bg-black/30 rounded-xl p-1 border border-black/5 shadow-sm">
                                            <button onClick={(e) => updateMatchStat(player.id, -1, e)} className="w-6 h-6 flex items-center justify-center hover:text-primary transition-colors"><span className="material-icons-outlined text-sm">remove</span></button>
                                            <div className="flex flex-col items-center min-w-[20px]">
                                                <span className="text-[10px] font-black">{stat.goals}</span>
                                            </div>
                                            <button onClick={(e) => updateMatchStat(player.id, 1, e)} className="w-6 h-6 flex items-center justify-center hover:text-primary transition-colors"><span className="material-icons-outlined text-sm">add</span></button>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>

                <div>
                    <h4 className="text-[11px] font-bold uppercase text-primary mb-2 px-1">Observações Técnicas</h4>
                    <textarea 
                        value={matchComments} 
                        onChange={(e) => setMatchComments(e.target.value)}
                        placeholder="Destaques do jogo, cartões ou observações importantes..."
                        className="w-full h-24 bg-gray-50 dark:bg-black/30 border-0 rounded-[1.5rem] p-4 text-xs font-medium focus:ring-2 focus:ring-primary/20 outline-none resize-none placeholder:opacity-30"
                    />
                </div>
              </div>

              <div className="p-5 md:p-6 border-t border-gray-100 dark:border-gray-800 flex gap-3 flex-shrink-0">
                <button onClick={() => setIsMatchResultModalOpen(false)} className="flex-1 py-3 text-xs font-bold uppercase opacity-40 tracking-tight">Cancelar</button>
                <button 
                    onClick={confirmMatchResult} 
                    disabled={isSubmitting} 
                    className="flex-[2] py-4 bg-primary text-white font-bold text-xs uppercase rounded-2xl shadow-xl shadow-primary/20 active:scale-95 transition-all flex items-center justify-center gap-2"
                >
                    {isSubmitting ? (
                        <span className="animate-spin border-2 border-white/20 border-t-white rounded-full w-4 h-4"></span>
                    ) : (
                        "Salvar Relatório Final"
                    )}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* MODAL ADICIONAR */}
        {isAddModalOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
            <div className="bg-surface-light dark:bg-surface-dark w-full max-md rounded-[2.5rem] border border-gray-200 dark:border-gray-800 overflow-hidden shadow-2xl p-8">
              <div className="flex justify-between items-center mb-8">
                <h3 className="text-xl font-bold flex items-center gap-2">
                  <span className="material-icons-outlined text-primary">{addMode === 'player' ? 'person_add' : 'event'}</span>
                  {addMode === 'player' ? 'Novo Atleta' : 'Novo Jogo'}
                </h3>
                <button onClick={() => setIsAddModalOpen(false)} className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-gray-200 dark:hover:bg-gray-800 transition-colors"><span className="material-icons-outlined">close</span></button>
              </div>
              
              {addMode === 'player' ? (
                <form onSubmit={handleAddPlayer} className="space-y-5">
                  <div>
                    <label className="text-[10px] font-black uppercase text-primary mb-2 block tracking-widest">Nome Completo</label>
                    <input type="text" required value={newPlayerName} onChange={(e) => setNewPlayerName(e.target.value)} className="w-full bg-gray-50 dark:bg-black/20 border-0 rounded-[1.25rem] p-4 text-sm font-bold shadow-inner" placeholder="Ex: João Silva" />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-[10px] font-black uppercase text-primary mb-2 block tracking-widest">Nº Camisa</label>
                      <input type="number" required value={newPlayerNumber} onChange={(e) => setNewPlayerNumber(e.target.value)} className="w-full bg-gray-50 dark:bg-black/20 border-0 rounded-[1.25rem] p-4 text-sm font-bold shadow-inner" placeholder="00" />
                    </div>
                    <div>
                      <label className="text-[10px] font-black uppercase text-primary mb-2 block tracking-widest">Posição</label>
                      <select value={newPlayerPosition} onChange={(e) => setNewPlayerPosition(e.target.value)} className="w-full bg-gray-50 dark:bg-black/20 border-0 rounded-[1.25rem] p-4 text-sm font-bold shadow-inner appearance-none">
                        <option value="GOL">Goleiro</option>
                        <option value="LAT">Lateral</option>
                        <option value="ZAG">Zagueiro</option>
                        <option value="VOL">Volante</option>
                        <option value="MEI">Meia</option>
                        <option value="ATA">Atacante</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] font-black uppercase text-primary mb-2 block tracking-widest">Foto do Atleta</label>
                    <div className="relative group">
                      <input type="file" accept="image/*" onChange={(e) => handlePhotoUpload(e, setNewPlayerPhoto)} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" />
                      <div className="w-full bg-gray-50 dark:bg-black/20 border-2 border-dashed border-gray-200 dark:border-gray-800 rounded-[1.25rem] p-6 flex flex-col items-center justify-center transition-all group-hover:bg-primary/5 group-hover:border-primary/50">
                        {newPlayerPhoto ? (
                          <div className="flex items-center gap-3">
                            <img src={newPlayerPhoto} className="w-12 h-12 rounded-xl object-cover" />
                            <span className="text-xs font-bold text-primary">Foto selecionada</span>
                          </div>
                        ) : (
                          <>
                            <span className="material-icons-outlined text-3xl opacity-20 mb-2">add_a_photo</span>
                            <span className="text-[10px] font-bold opacity-40 uppercase">Clique para subir imagem</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                  <button type="submit" disabled={isSubmitting} className="w-full bg-primary text-white font-black py-5 rounded-[1.5rem] shadow-xl shadow-primary/20 mt-4 active:scale-95 transition-all flex items-center justify-center gap-2">
                    {isSubmitting ? (
                      <span className="animate-spin border-2 border-white/20 border-t-white rounded-full w-5 h-5"></span>
                    ) : (
                      <>Finalizar Cadastro</>
                    )}
                  </button>
                </form>
              ) : (
                <form onSubmit={handleAddMatch} className="space-y-6">
                  {/* Opponent & Location side-by-side or stacked cleanly */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="relative">
                      <input type="text" required placeholder="Adversário" value={newMatchOpponent} onChange={(e) => setNewMatchOpponent(e.target.value)} className="w-full bg-gray-100 dark:bg-black/20 border-0 rounded-2xl p-4 text-sm font-bold placeholder:opacity-30" />
                    </div>
                    <div className="relative">
                      <input type="text" required placeholder="Local do Jogo" value={newMatchLocation} onChange={(e) => setNewMatchLocation(e.target.value)} className="w-full bg-gray-100 dark:bg-black/20 border-0 rounded-2xl p-4 text-sm font-bold placeholder:opacity-30" />
                    </div>
                  </div>

                  {/* Minimalist Sunday Chips */}
                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-widest text-primary px-1">Selecione o Domingo</label>
                    <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide -mx-1 px-1">
                      {nextSundays.map(date => {
                        const val = date.toISOString().split('T')[0];
                        const isSelected = newMatchDate === val;
                        return (
                          <button 
                            type="button"
                            key={val}
                            onClick={() => setNewMatchDate(val)}
                            className={`flex-shrink-0 w-14 h-16 rounded-2xl flex flex-col items-center justify-center border-2 transition-all duration-300 ${
                              isSelected 
                              ? 'bg-primary border-primary text-white shadow-lg shadow-primary/20' 
                              : 'bg-gray-100 dark:bg-black/20 border-transparent text-muted-light hover:border-gray-300 dark:hover:border-gray-700'
                            }`}
                          >
                            <span className="text-[8px] font-bold uppercase leading-none mb-1 opacity-60">
                              {date.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '')}
                            </span>
                            <span className="text-lg font-black italic leading-none">{date.getDate()}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Subtle Time Input */}
                  <div className="flex items-center justify-between bg-gray-100 dark:bg-black/20 p-4 rounded-2xl border border-black/5">
                    <div className="flex items-center gap-2">
                      <span className="material-icons-outlined text-muted-light text-sm">schedule</span>
                      <label className="text-[10px] font-black uppercase text-muted-light">Horário de Início</label>
                    </div>
                    <input 
                      type="time" 
                      required 
                      value={newMatchTime} 
                      onChange={(e) => setNewMatchTime(e.target.value)} 
                      className="bg-transparent border-0 p-0 text-sm font-black text-primary focus:ring-0 w-16 text-right appearance-none" 
                    />
                  </div>

                  <button type="submit" disabled={isSubmitting} className="w-full bg-primary text-white font-black py-4 rounded-2xl shadow-xl shadow-primary/20 mt-2 active:scale-95 transition-all">
                    {isSubmitting ? 'Marcando...' : 'Confirmar Partida'}
                  </button>
                </form>
              )}
            </div>
          </div>
        )}

        {/* MODAL EDITAR JOGADOR */}
        {isEditPlayerModalOpen && editingPlayer && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in overflow-y-auto">
            <div className="bg-surface-light dark:bg-surface-dark w-full max-sm rounded-[2.5rem] border border-gray-200 dark:border-gray-800 p-8 my-auto shadow-2xl relative">
              <button onClick={() => setIsEditPlayerModalOpen(false)} className="absolute top-6 right-6 w-10 h-10 flex items-center justify-center rounded-full hover:bg-gray-200 dark:hover:bg-gray-800 transition-colors"><span className="material-icons-outlined">close</span></button>
              
              <h3 className="text-2xl font-bold mb-8 flex items-center gap-3">
                <span className="material-icons-outlined text-primary">edit</span>
                Editar Atleta
              </h3>
              
              <form onSubmit={handleUpdatePlayer} className="space-y-6">
                  <div className="flex justify-center mb-6">
                    <div className="relative group">
                      <div className="w-24 h-24 rounded-full overflow-hidden border-4 border-primary/20 bg-gray-100 dark:bg-black/40">
                        <img src={editPlayerPhoto || editingPlayer.photoUrl} className="w-full h-full object-cover object-top" />
                      </div>
                      <input type="file" accept="image/*" onChange={(e) => handlePhotoUpload(e, setEditPlayerPhoto)} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" />
                      <div className="absolute inset-0 flex items-center justify-center bg-black/40 rounded-full opacity-0 group-hover:opacity-100 transition-opacity">
                         <span className="material-icons-outlined text-white">add_a_photo</span>
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="text-[10px] font-black uppercase text-primary mb-2 block tracking-widest">Nome do Atleta</label>
                    <input type="text" value={editPlayerName} onChange={(e) => setEditPlayerName(e.target.value)} className="w-full bg-gray-100 dark:bg-black/20 border-0 rounded-[1.25rem] p-4 text-sm font-bold shadow-inner" placeholder="Nome" />
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-[10px] font-black uppercase text-primary mb-2 block tracking-widest">Nº Camisa</label>
                      <input type="number" value={editPlayerNumber} onChange={(e) => setEditPlayerNumber(e.target.value)} className="w-full bg-gray-100 dark:bg-black/20 border-0 rounded-[1.25rem] p-4 text-sm font-bold shadow-inner" placeholder="Número" />
                    </div>
                    <div>
                      <label className="text-[10px] font-black uppercase text-primary mb-2 block tracking-widest">Posição</label>
                      <select value={editPlayerPosition} onChange={(e) => setEditPlayerPosition(e.target.value)} className="w-full bg-gray-100 dark:bg-black/20 border-0 rounded-[1.25rem] p-4 text-sm font-bold shadow-inner appearance-none">
                        <option value="GOL">Goleiro</option>
                        <option value="LAT">Lateral</option>
                        <option value="ZAG">Zagueiro</option>
                        <option value="VOL">Volante</option>
                        <option value="MEI">Meia</option>
                        <option value="ATA">Atacante</option>
                      </select>
                    </div>
                  </div>

                  {editPlayerPosition === 'GOL' && (
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="text-[10px] font-black uppercase text-primary mb-2 block tracking-widest">Gols Sofridos</label>
                        <input type="number" value={gkStats[editingPlayer.id]?.golsSofridos || 0} onChange={(e) => setGkStats(prev => ({ ...prev, [editingPlayer.id]: { ...prev[editingPlayer.id], golsSofridos: parseInt(e.target.value) || 0 } }))} className="w-full bg-gray-100 dark:bg-black/20 border-0 rounded-[1.25rem] p-4 text-sm font-bold shadow-inner" placeholder="0" />
                      </div>
                      <div>
                        <label className="text-[10px] font-black uppercase text-primary mb-2 block tracking-widest">Jogos sem Gols</label>
                        <input type="number" value={gkStats[editingPlayer.id]?.jogosSemSofrerGols || 0} onChange={(e) => setGkStats(prev => ({ ...prev, [editingPlayer.id]: { ...prev[editingPlayer.id], jogosSemSofrerGols: parseInt(e.target.value) || 0 } }))} className="w-full bg-gray-100 dark:bg-black/20 border-0 rounded-[1.25rem] p-4 text-sm font-bold shadow-inner" placeholder="0" />
                      </div>
                    </div>
                  )}

                  <div>
                    <label className="text-[10px] font-black uppercase text-primary mb-2 block tracking-widest">Valor Mensalidade (R$)</label>
                    <input type="number" step="0.01" value={editPlayerValue} onChange={(e) => setEditPlayerValue(e.target.value)} className="w-full bg-gray-100 dark:bg-black/20 border-0 rounded-[1.25rem] p-4 text-sm font-bold shadow-inner" placeholder="40.00" />
                  </div>

                  <button type="submit" disabled={isSubmitting} className="w-full bg-primary text-white font-black py-5 rounded-[1.5rem] shadow-xl shadow-primary/20 mt-4 active:scale-95 transition-all">
                    {isSubmitting ? <span className="animate-spin border-2 border-white/20 border-t-white rounded-full w-5 h-5 mx-auto"></span> : "Salvar Alterações"}
                  </button>
              </form>
            </div>
          </div>
        )}

        {/* MODAL COMPARTILHAR RELATÓRIO DO JOGO NO WHATSAPP */}
        {isMatchShareModalOpen && matchToShare && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/75 backdrop-blur-md animate-fade-in overflow-y-auto">
            <div className="bg-surface-light dark:bg-surface-dark w-full max-w-lg rounded-[2.5rem] border border-gray-200 dark:border-gray-800 p-6 md:p-8 my-auto shadow-2xl relative space-y-5">
              <button
                onClick={() => setIsMatchShareModalOpen(false)}
                className="absolute top-6 right-6 w-10 h-10 flex items-center justify-center rounded-full hover:bg-gray-200 dark:hover:bg-gray-800 transition-colors"
              >
                <span className="material-icons-outlined">close</span>
              </button>

              {/* Feedback toast inside modal */}
              {matchShareFeedback && (
                <div
                  className={`p-4 rounded-2xl text-xs font-bold flex items-center gap-2 ${
                    matchShareFeedback.type === 'success'
                      ? 'bg-green-500/10 text-green-500 border border-green-500/20'
                      : 'bg-red-500/10 text-red-500 border border-red-500/20'
                  }`}
                >
                  <span className="material-icons-outlined text-base">
                    {matchShareFeedback.type === 'success' ? 'check_circle' : 'error'}
                  </span>
                  {matchShareFeedback.text}
                </div>
              )}

              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-green-500/10 flex items-center justify-center flex-shrink-0">
                  <span className="material-icons-outlined text-2xl text-green-500">sports_soccer</span>
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-xl font-bold">Relatório do Jogo Salvo!</h3>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase bg-green-500/10 text-green-500">
                      Finalizado
                    </span>
                  </div>
                  <p className="text-xs text-muted-light">
                    Deseja compartilhar o relatório pós-jogo no WhatsApp?
                  </p>
                </div>
              </div>

              {/* Placar Badge */}
              <div className="p-4 rounded-2xl bg-gray-100 dark:bg-black/30 border border-black/5 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-black uppercase">Pesadão</span>
                  <span className="text-lg font-mono font-black text-primary">
                    {matchToShare.homeScore ?? matchToShare.home_score ?? 0} x {matchToShare.awayScore ?? matchToShare.away_score ?? 0}
                  </span>
                  <span className="text-xs font-black uppercase">{matchToShare.opponent}</span>
                </div>
                <span className="text-[10px] font-black uppercase tracking-wider px-2.5 py-1 rounded-full bg-primary/10 text-primary">
                  {matchToShare.result}
                </span>
              </div>

              {/* Informação do Grupo Destino */}
              <div className="flex items-center justify-between text-xs px-1">
                <span className="text-muted-light">Grupo de Jogos configurado:</span>
                <span className="font-bold text-primary truncate max-w-[200px]">
                  {matchShareTargetGroup || 'Grupo de Partidas'}
                </span>
              </div>

              {/* Preview Editável da Mensagem */}
              <div className="space-y-1">
                <label className="text-[10px] font-black uppercase text-muted-light tracking-widest block">
                  Mensagem que será enviada (você pode editar antes de enviar):
                </label>
                <div className="p-3 rounded-2xl bg-[#0b141a] text-[#e9edef] border border-white/5 shadow-inner">
                  <textarea
                    rows={8}
                    value={matchShareText}
                    onChange={(e) => setMatchShareText(e.target.value)}
                    className="w-full bg-transparent text-xs font-mono font-medium outline-none resize-y leading-relaxed text-[#e9edef]"
                    placeholder="Carregando mensagem do pós-jogo..."
                  />
                </div>
              </div>

              {/* Ações de Envio */}
              <div className="space-y-2 pt-1">
                <button
                  type="button"
                  onClick={handleSendMatchToWhatsAppGroup}
                  disabled={sendingMatchReport}
                  className="w-full py-4 bg-green-600 hover:bg-green-700 text-white font-black text-xs uppercase tracking-wider rounded-2xl shadow-xl shadow-green-600/20 active:scale-95 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {sendingMatchReport ? (
                    <span className="animate-spin border-2 border-white/20 border-t-white rounded-full w-4 h-4"></span>
                  ) : (
                    <>
                      <span className="material-icons-outlined text-base">send</span>
                      Enviar no Grupo do WhatsApp (Bot)
                    </>
                  )}
                </button>

                <div className="grid grid-cols-2 gap-2">
                  <a
                    href={`https://api.whatsapp.com/send?text=${encodeURIComponent(matchShareText)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="py-3 px-4 rounded-xl bg-gray-100 dark:bg-black/30 hover:bg-gray-200 dark:hover:bg-gray-700 text-xs font-bold flex items-center justify-center gap-1.5 transition-colors text-center"
                  >
                    <span className="material-icons-outlined text-sm text-green-500">open_in_new</span>
                    Abrir no WhatsApp
                  </a>

                  <button
                    type="button"
                    onClick={() => setIsMatchShareModalOpen(false)}
                    className="py-3 px-4 rounded-xl bg-gray-100 dark:bg-black/30 hover:bg-gray-200 dark:hover:bg-gray-700 text-xs font-bold text-muted-light transition-colors"
                  >
                    Concluir
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* MENSAGENS PWA */}
        {showInstallPrompt && isMobile && (
          <div className="fixed bottom-[85px] left-4 right-4 z-[70] animation-fade-in pointer-events-none">
            <div className="bg-surface-light dark:bg-surface-dark border border-gray-200 dark:border-gray-700 rounded-2xl p-4 flex items-center justify-between shadow-2xl backdrop-blur-md pointer-events-auto">
              <div className="flex items-center gap-3">
                <img src={PWA_LOGO_URL} className="w-10 h-10 rounded-xl" />
                <div>
                  <h4 className="font-bold text-sm">Pesadão FC App</h4>
                  <p className="text-[10px] opacity-70">Acesso rápido no seu celular</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => setShowInstallPrompt(false)} className="text-[10px] font-bold uppercase opacity-50 px-3">Fechar</button>
                <button onClick={handleInstallClick} className="bg-primary text-white text-xs font-bold px-4 py-2 rounded-xl shadow-lg shadow-primary/20">Instalar</button>
              </div>
            </div>
          </div>
        )}
    </div>
  );
};

export default App;