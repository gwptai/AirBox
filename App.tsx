import AsyncStorage from '@react-native-async-storage/async-storage';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, FlatList, Modal, Pressable, SafeAreaView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { GestureResponderEvent, LayoutChangeEvent } from 'react-native';
import { VideoView, useVideoPlayer } from 'expo-video';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { initExecutorch, useLLM } from 'react-native-executorch';
import { ExpoResourceFetcher } from 'react-native-executorch-expo-resource-fetcher';

(StyleSheet as any).absoluteFillObject ??= StyleSheet.absoluteFill;
initExecutorch({ resourceFetcher: ExpoResourceFetcher });
type Kind = 'video' | 'audio';
type Media = { id: string; title: string; uri: string; kind: Kind; importedAt: number; size?: number; favorite?: boolean; folder?: string; progress?: number; lastPlayed?: number };
const KEY = '@airbox/media-v1';
const CHAT_KEY = '@airbox/local-ai-chat-v1';
const MEDIA_DIRECTORY = `${FileSystem.documentDirectory}airbox/`;
const titleOf = (item: Media) => item.title.replace(/\.[^/.]+$/, '');
const sizeOf = (size?: number) => size ? `${(size / 1048576).toFixed(1)} МБ` : 'Офлайн';
const timeOf = (seconds = 0) => {
  const safe = Math.max(0, Math.floor(seconds));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
};

type ChatMessage = { id: string; role: 'user' | 'assistant'; content: string };
const LOCAL_MODEL = {
  // Bundled Expo assets: no URL and no model download at runtime.
  modelName: 'lfm2.5-1.2b-instruct-quantized',
  modelSource: require('./assets/models/lfm2_5_350m_xnnpack_8w4da.pte'),
  tokenizerSource: require('./assets/models/tokenizer.json'),
  tokenizerConfigSource: require('./assets/models/tokenizer_config.json'),
} as const;

function Close({ onPress, dark = false }: { onPress: () => void; dark?: boolean }) {
  return <Pressable onPress={onPress} style={[styles.close, dark && styles.closeDark]} hitSlop={12}><Text style={[styles.closeText, dark && styles.closeTextDark]}>×</Text><Text style={[styles.closeLabel, dark && styles.closeTextDark]}>Закрыть</Text></Pressable>;
}

function VideoPlayer({ item, close, saveProgress }: { item: Media; close: () => void; saveProgress: (seconds: number) => void }) {
  const player = useVideoPlayer(item.uri, (p) => { p.currentTime = item.progress || 0; p.timeUpdateEventInterval = 5; p.play(); });
  const video = useRef<VideoView>(null);
  useEffect(() => { const subscription = player.addListener('timeUpdate', ({ currentTime }) => saveProgress(Math.floor(currentTime))); return () => { subscription.remove(); player.pause(); }; }, [player, saveProgress]);
  return <View style={[styles.videoPage, { paddingTop: 47 }]}>
    <View style={styles.videoNav}><Close onPress={close} dark /><Text numberOfLines={1} style={styles.videoNavTitle}>{titleOf(item)}</Text></View>
    <VideoView ref={video} style={styles.video} player={player} nativeControls contentFit="contain" fullscreenOptions={{ enable: true, orientation: 'landscape' }} />
    <View style={styles.videoDetails}><Text style={styles.videoOverline}>ДОСТУПНО БЕЗ ИНТЕРНЕТА</Text><Text style={styles.videoTitle}>{titleOf(item)}</Text><Pressable onPress={() => video.current?.enterFullscreen()} style={styles.fullscreen}><Text style={styles.fullscreenText}>⛶   Смотреть на весь экран</Text></Pressable></View>
  </View>;
}

function AudioPlayer({ item, close, previous, next, saveProgress }: { item: Media; close: () => void; previous: () => void; next: () => void; saveProgress: (seconds: number) => void }) {
  const player = useAudioPlayer(item.uri);
  const status = useAudioPlayerStatus(player);
  const [progressWidth, setProgressWidth] = useState(0);
  useEffect(() => {
    if (item.progress) player.seekTo(item.progress);
    player.play();
    return () => {
      saveProgress(player.currentTime);
      player.pause();
    };
  }, [item.id, player]);
  const toggle = () => status.playing ? player.pause() : player.play();
  const seek = (event: GestureResponderEvent) => {
    if (!status.duration || progressWidth <= 0) return;
    const ratio = Math.max(0, Math.min(1, event.nativeEvent.locationX / progressWidth));
    const seconds = ratio * status.duration;
    player.seekTo(seconds);
    saveProgress(seconds);
  };
  const measureProgress = (event: LayoutChangeEvent) => setProgressWidth(event.nativeEvent.layout.width);
  const progress = (status.duration > 0 ? `${Math.min(100, (status.currentTime / status.duration) * 100)}%` : '0%') as `${number}%`;
  return <View style={styles.musicPage}>
    <View style={styles.musicNav}><Close onPress={close} /><Text style={styles.musicNavTitle}>Сейчас играет</Text><Text style={styles.more}>•••</Text></View>
    <View style={styles.album}><View style={styles.albumSun} /><Text style={styles.albumWord}>AIRBOX</Text><Text style={styles.albumNote}>♫</Text></View>
    <View style={styles.trackRow}><View style={styles.tinyCover}><Text>♫</Text></View><View style={styles.trackCopy}><Text numberOfLines={1} style={styles.trackName}>{titleOf(item)}</Text><Text style={styles.artist}>Личная медиатека</Text></View><Text style={styles.more}>•••</Text></View>
    <Pressable style={styles.progress} onLayout={measureProgress} onPress={seek}><View style={[styles.progressFill, { width: progress }]} /></Pressable><View style={styles.timeRow}><Text style={styles.timeRowText}>{timeOf(status.currentTime)}</Text><Text style={styles.timeRowText}>{status.duration ? timeOf(status.duration) : 'Офлайн'}</Text></View>
    <View style={styles.controls}><Text style={styles.sideControl}>↶</Text><Pressable onPress={previous}><Text style={styles.skip}>|◀</Text></Pressable><Pressable onPress={toggle} style={styles.playCircle}><Text style={styles.pause}>{status.playing ? 'Ⅱ' : '▶'}</Text></Pressable><Pressable onPress={next}><Text style={styles.skip}>▶|</Text></Pressable><Text style={styles.sideControl}>♡</Text></View>
    <View style={styles.playerBottom}><Text>⌁</Text><Text>HD</Text><Text>☾</Text><Text>≋</Text></View>
  </View>;
}

function RenameModal({ item, save, close }: { item: Media | null; save: (name: string) => void; close: () => void }) {
  const [name, setName] = useState(item ? titleOf(item) : '');
  useEffect(() => setName(item ? titleOf(item) : ''), [item]);
  return <Modal transparent visible={!!item} animationType="fade" onRequestClose={close}><View style={styles.modalShade}><View style={styles.modalCard}><Text style={styles.modalTitle}>Переименовать</Text><Text style={styles.modalDescription}>Это изменит название только в AirBox.</Text><TextInput value={name} onChangeText={setName} autoFocus selectTextOnFocus style={styles.renameInput} placeholder="Название" /><View style={styles.modalButtons}><Pressable onPress={close} style={styles.cancel}><Text style={styles.cancelText}>Отмена</Text></Pressable><Pressable onPress={() => name.trim() && save(name.trim())} style={styles.save}><Text style={styles.saveText}>Сохранить</Text></Pressable></View></View></View></Modal>;
}

function LocalAI({ close }: { close: () => void }) {
  const llm = useLLM({ model: LOCAL_MODEL });
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const list = useRef<FlatList<ChatMessage>>(null);
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => { AsyncStorage.getItem(CHAT_KEY).then((saved) => { if (saved) setHistory(JSON.parse(saved)); }).catch(() => undefined); return () => { if (timeout.current) clearTimeout(timeout.current); if (llm.isGenerating) llm.interrupt(); }; }, []);
  useEffect(() => { if (llm.isGenerating) list.current?.scrollToEnd({ animated: true }); }, [llm.response, llm.isGenerating]);
  const save = async (next: ChatMessage[]) => { setHistory(next); await AsyncStorage.setItem(CHAT_KEY, JSON.stringify(next.slice(-40))); };
  const send = async () => {
    const text = draft.trim();
    if (!text || !llm.isReady || llm.isGenerating) return;
    setDraft('');
    const user: ChatMessage = { id: `${Date.now()}-user`, role: 'user', content: text };
    const next = [...history, user].slice(-16);
    setHistory(next);
    try {
      llm.configure({ generationConfig: { temperature: 0.35, topp: 0.9, outputTokenBatchSize: 1, batchTimeInterval: 80 }, chatConfig: { systemPrompt: 'Ты AirBox AI: полезный, короткий, дружелюбный офлайн-помощник. Отвечай на русском, если к тебе обращаются по-русски. Не выдумывай доступ к интернету.', initialMessageHistory: [], contextStrategy: { buildContext: (_system, messages) => messages.slice(-16) } } });
      timeout.current = setTimeout(() => llm.interrupt(), 45000);
      const prompt = [{ role: 'system' as const, content: 'Ты AirBox AI: полезный, короткий, дружелюбный офлайн-помощник. Отвечай на русском, если к тебе обращаются по-русски.' }, ...next.map(({ role, content }) => ({ role, content }))];
      const answer = await llm.generate(prompt);
      await save([...next, { id: `${Date.now()}-assistant`, role: 'assistant', content: answer.trim() || 'Генерация остановлена.' }]);
    } catch {
      await save([...next, { id: `${Date.now()}-assistant`, role: 'assistant', content: 'Не удалось запустить локальную модель. Проверьте, что AirBox установлен как production-приложение на iPhone с iOS 17 или новее.' }]);
    } finally { if (timeout.current) clearTimeout(timeout.current); timeout.current = null; }
  };
  const newChat = () => Alert.alert('Новый чат?', 'Текущая история будет удалена только с этого iPhone.', [{ text: 'Отмена', style: 'cancel' }, { text: 'Очистить', style: 'destructive', onPress: () => save([]) }]);
  const loadingText = llm.error ? 'Не удалось загрузить локальную модель' : !llm.isReady ? 'AI загружается в память…' : llm.isGenerating ? 'AI думает…' : 'Полностью локально · без сети';
  return <SafeAreaView style={aiStyles.screen}><StatusBar style="dark" />
    <View style={aiStyles.top}><Pressable onPress={close} style={aiStyles.back}><Text style={aiStyles.backText}>‹</Text><Text style={aiStyles.backLabel}>Библиотека</Text></Pressable><Text style={aiStyles.title}>AI</Text><Pressable onPress={newChat} style={aiStyles.newChat}><Text style={aiStyles.newChatText}>＋</Text></Pressable></View>
    <View style={[aiStyles.status, llm.error && aiStyles.errorStatus]}><View style={aiStyles.statusDot} /><Text style={aiStyles.statusText}>{loadingText}</Text></View>
    <FlatList ref={list} data={history} keyExtractor={(item) => item.id} contentContainerStyle={history.length ? aiStyles.messages : aiStyles.emptyMessages} ListEmptyComponent={<View style={aiStyles.welcome}><Text style={aiStyles.aiMark}>✦</Text><Text style={aiStyles.welcomeTitle}>Локальный AI готов</Text><Text style={aiStyles.welcomeText}>Ваши сообщения не покидают iPhone. Модель включена в приложение и работает в авиарежиме.</Text></View>} renderItem={({ item }) => <View style={[aiStyles.bubble, item.role === 'user' ? aiStyles.userBubble : aiStyles.aiBubble]}><Text style={[aiStyles.bubbleText, item.role === 'user' && aiStyles.userText]}>{item.content}</Text></View>} ListFooterComponent={llm.isGenerating ? <View style={aiStyles.aiBubble}><Text style={aiStyles.bubbleText}>{llm.response || 'AI думает…'}</Text></View> : null} />
    <View style={aiStyles.composer}>{llm.isGenerating ? <Pressable onPress={() => llm.interrupt()} style={aiStyles.stop}><Text style={aiStyles.stopText}>■  Остановить</Text></Pressable> : <><TextInput value={draft} onChangeText={setDraft} editable={llm.isReady} onSubmitEditing={send} placeholder={llm.isReady ? 'Напишите сообщение…' : 'Подготавливаем AI…'} placeholderTextColor="#7B8AA7" style={aiStyles.input} multiline /><Pressable onPress={send} disabled={!draft.trim() || !llm.isReady} style={[aiStyles.send, (!draft.trim() || !llm.isReady) && aiStyles.sendOff]}><Text style={aiStyles.sendText}>↑</Text></Pressable></>}</View>
  </SafeAreaView>;
}

export default function App() {
  const [media, setMedia] = useState<Media[]>([]); const [tab, setTab] = useState<'all' | Kind>('all'); const [search, setSearch] = useState(''); const [active, setActive] = useState<Media | null>(null); const [renaming, setRenaming] = useState<Media | null>(null); const [filterFolder, setFilterFolder] = useState('Все'); const [sort, setSort] = useState<'new' | 'name' | 'size'>('new'); const [screen, setScreen] = useState<'library' | 'ai'>('library'); const [ready, setReady] = useState(false);
  useEffect(() => { (async () => { try { const saved = await AsyncStorage.getItem(KEY); if (saved) setMedia(JSON.parse(saved)); } catch { Alert.alert('Не удалось открыть библиотеку', 'Перезапустите AirBox и попробуйте снова.'); } finally { setReady(true); } })(); }, []);
  const persist = async (next: Media[]) => { setMedia(next); await AsyncStorage.setItem(KEY, JSON.stringify(next)); };
  const add = async (kind: Kind) => { try { const result = await DocumentPicker.getDocumentAsync({ type: kind === 'video' ? 'video/*' : 'audio/*', copyToCacheDirectory: true, multiple: true }); if (result.canceled) return; await FileSystem.makeDirectoryAsync(MEDIA_DIRECTORY, { intermediates: true }); const additions: Media[] = []; for (const file of result.assets) { const extension = file.name.match(/\.[^./]+$/)?.[0] || ''; const uri = `${MEDIA_DIRECTORY}${Date.now()}-${Math.random().toString(36).slice(2)}${extension}`; await FileSystem.copyAsync({ from: file.uri, to: uri }); additions.push({ id: uri, title: file.name, uri, kind, importedAt: Date.now(), size: file.size, folder: 'Библиотека' }); } await persist([...additions, ...media]); } catch { Alert.alert('Не удалось добавить файл', 'Проверьте доступ к приложению «Файлы» и свободное место на устройстве.'); } };
  const remove = (item: Media) => Alert.alert('Удалить файл?', `«${item.title}» исчезнет только из AirBox.`, [{ text: 'Отмена', style: 'cancel' }, { text: 'Удалить', style: 'destructive', onPress: async () => { await FileSystem.deleteAsync(item.uri, { idempotent: true }); await persist(media.filter((x) => x.id !== item.id)); } }]);
  const rename = async (name: string) => { if (!renaming) return; await persist(media.map((x) => x.id === renaming.id ? { ...x, title: name } : x)); setRenaming(null); };
  const toggleFavorite = async (item: Media) => await persist(media.map((x) => x.id === item.id ? { ...x, favorite: !x.favorite } : x));
  const saveProgress = async (item: Media, progress: number) => await persist(media.map((x) => x.id === item.id ? { ...x, progress, lastPlayed: Date.now() } : x));
  const shown = useMemo(() => media.filter((x) => (tab === 'all' || x.kind === tab) && (filterFolder === 'Все' || filterFolder === 'Избранное' ? filterFolder !== 'Избранное' || x.favorite : (x.folder || 'Библиотека') === filterFolder) && x.title.toLowerCase().includes(search.toLowerCase())).sort((a, b) => sort === 'name' ? a.title.localeCompare(b.title) : sort === 'size' ? (b.size || 0) - (a.size || 0) : (b.importedAt || 0) - (a.importedAt || 0)), [media, tab, search, filterFolder, sort]);
  if (!ready) return <View style={styles.loading}><Text style={styles.loadingText}>AIRBOX</Text></View>;
  if (screen === 'ai') return <LocalAI close={() => setScreen('library')} />;
  return <SafeAreaView style={styles.screen}><StatusBar style="dark" />
    <View style={styles.header}><View><Text style={styles.eyebrow}>OFFLINE LIBRARY</Text><Text style={styles.headline}>В дороге —{`\n`}как дома.</Text></View><Pressable onPress={() => setScreen('ai')} style={newStyles.aiButton}><Text style={newStyles.aiHeaderIcon}>✦</Text><Text style={newStyles.aiHeaderLabel}>AI</Text></Pressable></View>
    <View style={styles.storage}><View style={styles.storageIcon}><Text>↓</Text></View><View><Text style={styles.storageTitle}>Всё хранится на iPhone</Text><Text style={styles.storageText}>{media.length ? `${media.length} файлов · ${(media.reduce((sum, item) => sum + (item.size || 0), 0) / 1048576).toFixed(1)} МБ офлайн` : 'Добавьте фильмы и музыку из «Файлов»'}</Text></View></View>
    <View style={styles.actions}><Pressable style={styles.videoAction} onPress={() => add('video')}><Text style={styles.actionText}>＋  Видео</Text></Pressable><Pressable style={styles.audioAction} onPress={() => add('audio')}><Text style={styles.audioActionText}>＋  Музыка</Text></Pressable></View>
    <TextInput value={search} onChangeText={setSearch} placeholder="Поиск по библиотеке" placeholderTextColor="#7B8AA7" style={styles.search} />
    <View style={styles.sectionRow}><Text style={styles.sectionTitle}>Моя библиотека</Text><Text style={styles.count}>{shown.length}</Text></View>
    <View style={styles.tabs}>{([['all', 'Все'], ['video', 'Видео'], ['audio', 'Музыка']] as const).map(([value, label]) => <Pressable onPress={() => setTab(value)} key={value} style={[styles.tab, tab === value && styles.selectedTab]}><Text style={[styles.tabText, tab === value && styles.selectedText]}>{label}</Text></Pressable>)}</View>
    <View style={newStyles.folderRow}>{['Все', 'Библиотека', 'Избранное'].map((name) => <Pressable key={name} onPress={() => setFilterFolder(name)} style={[newStyles.folderChip, filterFolder === name && newStyles.folderChipActive]}><Text style={[newStyles.folderText, filterFolder === name && newStyles.folderTextActive]}>{name === 'Избранное' ? '♥  Избранное' : name}</Text></Pressable>)}<Pressable onPress={() => setSort(sort === 'new' ? 'name' : sort === 'name' ? 'size' : 'new')} style={newStyles.sort}><Text style={newStyles.sortText}>⇅</Text></Pressable></View>
    <FlatList data={shown} keyExtractor={(item) => item.id} contentContainerStyle={shown.length ? styles.list : styles.emptyList} ListEmptyComponent={<View style={styles.empty}><Text style={styles.emptyEmoji}>☁</Text><Text style={styles.emptyTitle}>Здесь будет ваша медиатека</Text><Text style={styles.emptyText}>Добавьте фильм или музыку — они останутся доступными даже в самолёте.</Text></View>} renderItem={({ item }) => <Pressable style={styles.card} onPress={() => setActive(item)}><View style={[styles.cover, item.kind === 'audio' && styles.musicCover]}><Text style={styles.coverSign}>{item.kind === 'video' ? '▶' : '♫'}</Text></View><View style={styles.cardCopy}><Text numberOfLines={2} style={styles.cardTitle}>{titleOf(item)}</Text><Text style={styles.cardMeta}>{item.progress ? `Продолжить с ${Math.floor(item.progress / 60)}:${String(item.progress % 60).padStart(2, '0')}` : `${item.kind === 'video' ? 'ВИДЕО' : 'МУЗЫКА'} · ${sizeOf(item.size)}`}</Text></View><Pressable hitSlop={8} onPress={() => toggleFavorite(item)}><Text style={newStyles.favorite}>{item.favorite ? '♥' : '♡'}</Text></Pressable><Pressable hitSlop={8} onPress={() => setRenaming(item)} style={styles.edit}><Text style={styles.editText}>✎</Text></Pressable><Pressable hitSlop={8} onPress={() => remove(item)}><Text style={styles.delete}>×</Text></Pressable></Pressable>} />
    <RenameModal item={renaming} save={rename} close={() => setRenaming(null)} />
    {active?.kind === 'video' && <VideoPlayer key={active.id} item={active} close={() => setActive(null)} saveProgress={(seconds) => saveProgress(active, seconds)} />}{active?.kind === 'audio' && <AudioPlayer key={active.id} item={active} close={() => setActive(null)} saveProgress={(seconds) => saveProgress(active, seconds)} previous={() => { const queue = shown.filter((x) => x.kind === 'audio'); const index = queue.findIndex((x) => x.id === active.id); setActive(queue[(index - 1 + queue.length) % queue.length] || active); }} next={() => { const queue = shown.filter((x) => x.kind === 'audio'); const index = queue.findIndex((x) => x.id === active.id); setActive(queue[(index + 1) % queue.length] || active); }} />}
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F5F8FF' }, loading: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#177BFF' }, loadingText: { color: 'white', fontWeight: '900', fontSize: 30, letterSpacing: 3 }, header: { backgroundColor: '#1B7BFA', minHeight: 156, padding: 22, flexDirection: 'row', justifyContent: 'space-between' }, eyebrow: { color: '#BBD8FF', fontSize: 11, fontWeight: '800', letterSpacing: 1.1 }, headline: { color: 'white', fontSize: 30, fontWeight: '900', lineHeight: 35, marginTop: 8 }, plane: { width: 45, height: 45, borderRadius: 22, backgroundColor: '#FFFFFF33', justifyContent: 'center', alignItems: 'center', marginTop: 4 }, storage: { marginHorizontal: 18, marginTop: -19, backgroundColor: 'white', borderRadius: 18, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 11, shadowColor: '#3E77C5', shadowOpacity: .15, shadowRadius: 16, elevation: 3 }, storageIcon: { height: 38, width: 38, borderRadius: 12, backgroundColor: '#DBEAFF', justifyContent: 'center', alignItems: 'center' }, storageTitle: { color: '#112342', fontWeight: '800' }, storageText: { color: '#6B7C98', fontSize: 12, marginTop: 2 }, actions: { flexDirection: 'row', gap: 10, padding: 18, paddingBottom: 14 }, videoAction: { flex: 1, backgroundColor: '#1B7BFA', height: 62, borderRadius: 18, alignItems: 'center', justifyContent: 'center' }, audioAction: { flex: 1, backgroundColor: '#DDF0FF', height: 62, borderRadius: 18, alignItems: 'center', justifyContent: 'center' }, actionText: { color: 'white', fontSize: 15, fontWeight: '800' }, audioActionText: { color: '#1263C7', fontSize: 15, fontWeight: '800' }, search: { backgroundColor: 'white', marginHorizontal: 18, height: 46, paddingHorizontal: 15, borderRadius: 14, color: '#183050', fontSize: 15 }, sectionRow: { paddingHorizontal: 20, marginTop: 19, flexDirection: 'row', alignItems: 'center' }, sectionTitle: { color: '#132A4A', fontSize: 19, fontWeight: '900' }, count: { color: '#237DFA', backgroundColor: '#DDEEFF', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, marginLeft: 8, fontSize: 12, fontWeight: '800' }, tabs: { flexDirection: 'row', paddingHorizontal: 18, gap: 8, marginTop: 11 }, tab: { paddingHorizontal: 13, paddingVertical: 8, borderRadius: 12 }, selectedTab: { backgroundColor: '#173D73' }, tabText: { color: '#71809A', fontWeight: '700' }, selectedText: { color: 'white' }, list: { padding: 18, paddingTop: 12, gap: 9, paddingBottom: 76 }, emptyList: { flexGrow: 1 }, empty: { alignItems: 'center', paddingHorizontal: 44, paddingTop: 60 }, emptyEmoji: { fontSize: 45, color: '#54A0FC' }, emptyTitle: { color: '#17345C', fontSize: 18, fontWeight: '900', textAlign: 'center', marginTop: 16 }, emptyText: { color: '#72809A', textAlign: 'center', lineHeight: 20, marginTop: 7 }, card: { minHeight: 76, backgroundColor: 'white', borderRadius: 18, padding: 10, flexDirection: 'row', alignItems: 'center', gap: 9 }, cover: { width: 55, height: 55, borderRadius: 14, backgroundColor: '#277FF6', justifyContent: 'center', alignItems: 'center' }, musicCover: { backgroundColor: '#A9783D' }, coverSign: { color: 'white', fontSize: 20 }, cardCopy: { flex: 1 }, cardTitle: { color: '#163257', fontWeight: '800', fontSize: 15, lineHeight: 19 }, cardMeta: { color: '#7887A0', marginTop: 4, fontSize: 10, fontWeight: '800' }, edit: { width: 32, height: 32, borderRadius: 10, backgroundColor: '#E5F1FF', alignItems: 'center', justifyContent: 'center' }, editText: { color: '#1D78F7', fontSize: 17 }, delete: { color: '#9AA8BA', fontSize: 25 }, bottom: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 58, backgroundColor: '#FFFFFFF2', borderTopColor: '#E5ECF7', borderTopWidth: 1, flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center' }, bottomActive: { color: '#197BFA', fontSize: 12, fontWeight: '800' }, bottomItem: { color: '#8492A8', fontSize: 12, fontWeight: '700' }, videoPage: { ...StyleSheet.absoluteFillObject, backgroundColor: '#071629', zIndex: 10 }, videoNav: { height: 65, paddingHorizontal: 17, flexDirection: 'row', alignItems: 'center', gap: 11 }, videoNavTitle: { color: '#F1F6FF', fontSize: 15, fontWeight: '800', flex: 1 }, close: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 8 }, closeText: { fontSize: 25, lineHeight: 25, color: '#664B24' }, closeLabel: { color: '#664B24', fontSize: 13, fontWeight: '800' }, closeDark: { backgroundColor: '#1A314E', paddingHorizontal: 8, borderRadius: 11 }, closeTextDark: { color: '#D7E8FF' }, video: { width: '100%', height: 270, backgroundColor: '#000' }, videoDetails: { padding: 23 }, videoOverline: { color: '#5EABFF', fontSize: 11, fontWeight: '900', letterSpacing: 1.2 }, videoTitle: { color: 'white', fontSize: 22, fontWeight: '900', marginTop: 8 }, fullscreen: { backgroundColor: '#207BFA', borderRadius: 15, height: 53, alignItems: 'center', justifyContent: 'center', marginTop: 27 }, fullscreenText: { color: 'white', fontWeight: '900', fontSize: 15 }, musicPage: { ...StyleSheet.absoluteFillObject, backgroundColor: '#B99762', zIndex: 10, paddingHorizontal: 20 }, musicNav: { height: 68, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, musicNavTitle: { color: '#F7EEDC', fontSize: 14, fontWeight: '800' }, more: { color: '#63481F', fontSize: 20, width: 45, textAlign: 'right' }, album: { width: '100%', aspectRatio: 1, backgroundColor: '#86602D', borderRadius: 8, overflow: 'hidden', justifyContent: 'flex-end', padding: 24, shadowColor: '#583C1B', shadowOpacity: .24, shadowRadius: 14, elevation: 4 }, albumSun: { position: 'absolute', width: 260, height: 260, borderRadius: 130, backgroundColor: '#D7B271', top: -100, right: -63 }, albumWord: { color: '#FAEACD', fontWeight: '900', fontSize: 37, letterSpacing: 3 }, albumNote: { position: 'absolute', right: 24, bottom: 18, color: '#F7E8C7', fontSize: 54 }, trackRow: { flexDirection: 'row', alignItems: 'center', marginTop: 22 }, tinyCover: { width: 42, height: 42, backgroundColor: '#805B2E', borderRadius: 7, justifyContent: 'center', alignItems: 'center' }, trackCopy: { flex: 1, marginLeft: 10 }, trackName: { color: '#FFF6E7', fontSize: 15, fontWeight: '900' }, artist: { color: '#75582D', fontSize: 12, marginTop: 3, fontWeight: '700' }, progress: { height: 3, backgroundColor: '#D7BF92', marginTop: 23, borderRadius: 2 }, progressFill: { height: 3, backgroundColor: '#FFF5E2', width: '7%', borderRadius: 2 }, timeRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 5 }, timeRowText: { color: '#775A2F', fontSize: 10 }, controls: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 23, paddingHorizontal: 4 }, sideControl: { color: '#694D26', fontSize: 24 }, skip: { color: '#FFF6E7', fontSize: 22 }, playCircle: { width: 60, height: 60, borderRadius: 30, backgroundColor: '#FFF9EE', justifyContent: 'center', alignItems: 'center' }, pause: { color: '#7C5B2D', fontSize: 22, fontWeight: '800' }, playerBottom: { marginTop: 34, flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 18 }, playerBottomText: { color: '#72552B' }, modalShade: { flex: 1, backgroundColor: '#08162B80', justifyContent: 'center', padding: 22 }, modalCard: { backgroundColor: 'white', borderRadius: 22, padding: 22 }, modalTitle: { color: '#142C4E', fontSize: 20, fontWeight: '900' }, modalDescription: { color: '#72809A', marginTop: 5 }, renameInput: { borderWidth: 1, borderColor: '#D8E2F1', borderRadius: 12, paddingHorizontal: 13, height: 48, color: '#17345C', marginTop: 18, fontSize: 16 }, modalButtons: { flexDirection: 'row', gap: 10, marginTop: 16 }, cancel: { flex: 1, height: 46, alignItems: 'center', justifyContent: 'center', backgroundColor: '#EDF3FC', borderRadius: 12 }, save: { flex: 1, height: 46, alignItems: 'center', justifyContent: 'center', backgroundColor: '#1B7BFA', borderRadius: 12 }, cancelText: { color: '#476485', fontWeight: '800' }, saveText: { color: 'white', fontWeight: '800' },
});

const newStyles = StyleSheet.create({
  folderRow: { flexDirection: 'row', gap: 7, paddingHorizontal: 18, marginTop: 10, alignItems: 'center' },
  folderChip: { backgroundColor: '#E6EFFB', borderRadius: 11, paddingVertical: 7, paddingHorizontal: 9 },
  folderChipActive: { backgroundColor: '#1B7BFA' },
  folderText: { color: '#536A8B', fontSize: 11, fontWeight: '800' },
  folderTextActive: { color: 'white' },
  sort: { marginLeft: 'auto', width: 32, height: 30, borderRadius: 10, backgroundColor: '#173D73', alignItems: 'center', justifyContent: 'center' },
  sortText: { color: 'white', fontSize: 16 },
  favorite: { color: '#E14C70', fontSize: 22, paddingHorizontal: 1 },
  aiButton: { width: 52, height: 52, borderRadius: 18, backgroundColor: '#FFFFFF33', justifyContent: 'center', alignItems: 'center', marginTop: 4 },
  aiHeaderIcon: { color: 'white', fontSize: 20, lineHeight: 20 },
  aiHeaderLabel: { color: 'white', fontSize: 10, fontWeight: '900' },
});

const aiStyles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F5F8FF' },
  top: { height: 62, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: 'white' },
  back: { flexDirection: 'row', alignItems: 'center', width: 100 }, backText: { fontSize: 34, lineHeight: 34, color: '#176FE2' }, backLabel: { fontSize: 12, fontWeight: '800', color: '#176FE2' },
  title: { color: '#153258', fontSize: 20, fontWeight: '900' }, newChat: { width: 38, height: 38, borderRadius: 13, backgroundColor: '#E5F1FF', justifyContent: 'center', alignItems: 'center' }, newChatText: { color: '#176FE2', fontSize: 24 },
  status: { flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: '#E8F8EF', margin: 14, marginBottom: 5, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 13 }, errorStatus: { backgroundColor: '#FFF0F1' }, statusDot: { height: 7, width: 7, borderRadius: 5, backgroundColor: '#33B86C' }, statusText: { color: '#3D6F54', fontSize: 12, fontWeight: '700' },
  messages: { padding: 16, gap: 10, paddingBottom: 24 }, emptyMessages: { flexGrow: 1 }, welcome: { paddingHorizontal: 38, paddingTop: 105, alignItems: 'center' }, aiMark: { width: 62, height: 62, borderRadius: 22, backgroundColor: '#197BFA', color: 'white', textAlign: 'center', textAlignVertical: 'center', fontSize: 30 }, welcomeTitle: { color: '#17345C', fontSize: 21, fontWeight: '900', marginTop: 18 }, welcomeText: { color: '#72809A', textAlign: 'center', lineHeight: 20, marginTop: 8 },
  bubble: { maxWidth: '84%', padding: 13, borderRadius: 17 }, aiBubble: { alignSelf: 'flex-start', backgroundColor: 'white', borderBottomLeftRadius: 5 }, userBubble: { alignSelf: 'flex-end', backgroundColor: '#1B7BFA', borderBottomRightRadius: 5 }, bubbleText: { color: '#243B5C', fontSize: 15, lineHeight: 21 }, userText: { color: 'white' },
  composer: { minHeight: 76, paddingHorizontal: 14, paddingVertical: 12, backgroundColor: 'white', flexDirection: 'row', gap: 9, alignItems: 'flex-end', borderTopWidth: 1, borderTopColor: '#E5ECF7' }, input: { flex: 1, maxHeight: 108, minHeight: 46, backgroundColor: '#F0F5FC', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 12, color: '#1B3558', fontSize: 15 }, send: { height: 46, width: 46, borderRadius: 15, backgroundColor: '#1B7BFA', justifyContent: 'center', alignItems: 'center' }, sendOff: { backgroundColor: '#B8CCE7' }, sendText: { color: 'white', fontSize: 24, fontWeight: '900' }, stop: { flex: 1, height: 47, backgroundColor: '#FFE6E9', borderRadius: 15, alignItems: 'center', justifyContent: 'center' }, stopText: { color: '#C13E55', fontWeight: '900' },
});
