/**
 * TO-DO LIST DO DIA — dentro do cartão "Today's progress".
 *
 * Pedido da operação (26/09/2026): "hoje no aplicativo, onde está escrito Today's Progress, a gente
 * vai incluir uma to-do list que vai ser editável: o cara vai clicar, vai escrever o que ele tem que
 * fazer no dia e vai gerar tipo aquela bolinha para você clicar no menu".
 *
 * Decisões: a lista é DO DIA (a tela carrega o dia escolhido no cabeçalho; ontem continua guardado no histórico) e
 * é do gestor (o banco só deixa gestor escrever — o motorista lê). A bolinha do menu conta os itens
 * ainda ABERTOS.
 *
 * `title` existe por causa da navegação por dia (27/09/2026): quando o gestor arrasta o cabeçalho
 * para amanhã, "Today's to-do" seria mentira.
 */
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { colors, radii } from '@/features/theme/tokens';
import { pendingTodos, sortTodos, TODO_TEXTO_MAX, type DailyTodo } from './dayOperation';

type Props = {
  /** Título do cartão; padrão "Today's to-do" (a Home passa "<dia>'s to-do"). */
  title?: string;
  todos: DailyTodo[];
  busy?: boolean;
  onAdd: (text: string) => void;
  onToggle: (id: string, done: boolean) => void;
  onEdit: (id: string, text: string) => void;
  onRemove: (id: string) => void;
};

export function TodoCard({ title = "Today's to-do", todos, busy = false, onAdd, onToggle, onEdit, onRemove }: Props) {
  const [novo, setNovo] = useState('');
  const [editando, setEditando] = useState<string | null>(null);
  const [rascunho, setRascunho] = useState('');
  const lista = sortTodos(todos);
  const abertos = pendingTodos(todos);

  const adicionar = () => {
    const texto = novo.trim();
    if (!texto) return;
    onAdd(texto);
    setNovo('');
  };

  const salvarEdicao = () => {
    const texto = rascunho.trim();
    if (editando && texto) onEdit(editando, texto);
    setEditando(null);
    setRascunho('');
  };

  return (
    <View style={styles.cartao}>
      <View style={styles.topo}>
        <Text style={styles.titulo}>{title}</Text>
        <View style={[styles.selo, abertos === 0 && styles.seloOk]}>
          <Text style={[styles.seloTexto, abertos === 0 && styles.seloTextoOk]}>
            {abertos === 0 ? 'all done' : `${abertos} open`}
          </Text>
        </View>
      </View>

      {lista.length === 0 ? (
        <Text style={styles.vazio}>Nothing on the list yet — write what has to happen today.</Text>
      ) : (
        lista.map((item) => (
          <View key={item.id} style={styles.linha}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ checked: item.done, disabled: busy }}
              disabled={busy}
              accessibilityLabel={item.done ? `Mark ${item.text} as not done` : `Mark ${item.text} as done`}
              onPress={() => onToggle(item.id, !item.done)}
              style={[styles.bolinha, item.done && styles.bolinhaOn]}
            >
              <Text style={styles.bolinhaTexto}>{item.done ? '✓' : ''}</Text>
            </Pressable>

            {editando === item.id ? (
              <TextInput
                accessibilityLabel={`Edit ${item.text}`}
                value={rascunho}
                onChangeText={setRascunho}
                onSubmitEditing={salvarEdicao}
                onBlur={salvarEdicao}
                autoFocus
                maxLength={TODO_TEXTO_MAX}
                style={[styles.texto, styles.textoEditando]}
              />
            ) : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Edit item ${item.text}`}
                onPress={() => {
                  setEditando(item.id);
                  setRascunho(item.text);
                }}
                style={styles.textoArea}
              >
                <Text style={[styles.texto, item.done && styles.textoFeito]}>{item.text}</Text>
              </Pressable>
            )}

            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: busy }}
              disabled={busy}
              accessibilityLabel={`Remove ${item.text}`}
              onPress={() => onRemove(item.id)}
              style={styles.remover}
            >
              <Text style={styles.removerTexto}>✕</Text>
            </Pressable>
          </View>
        ))
      )}

      <View style={styles.novaLinha}>
        <TextInput
          accessibilityLabel="New to-do for today"
          placeholder="Add something for today…"
          placeholderTextColor={colors.muted}
          value={novo}
          onChangeText={setNovo}
          onSubmitEditing={adicionar}
          maxLength={TODO_TEXTO_MAX}
          style={styles.entrada}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: busy || novo.trim().length === 0 }}
          disabled={busy || novo.trim().length === 0}
          accessibilityLabel="Add to-do"
          onPress={adicionar}
          style={[styles.adicionar, (busy || !novo.trim()) && styles.adicionarOff]}
        >
          <Text style={styles.adicionarTexto}>Add</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  cartao: { backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.line, borderRadius: radii.large, padding: 16, marginHorizontal: 18, marginTop: 12 },
  topo: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  titulo: { fontFamily: 'serif', fontWeight: '800', fontSize: 16, color: colors.ink },
  selo: { backgroundColor: '#FBEAE6', borderRadius: 20, paddingHorizontal: 9, paddingVertical: 5 },
  seloOk: { backgroundColor: '#E3F1DF' },
  seloTexto: { color: colors.urgency, fontSize: 10, fontWeight: '800' },
  seloTextoOk: { color: '#2E6334' },
  vazio: { color: colors.muted, fontSize: 12, marginBottom: 6 },
  linha: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 5 },
  bolinha: { width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, borderColor: colors.forest500, alignItems: 'center', justifyContent: 'center' },
  bolinhaOn: { backgroundColor: colors.success, borderColor: colors.success },
  bolinhaTexto: { color: 'white', fontWeight: '900', fontSize: 12 },
  textoArea: { flex: 1 },
  texto: { color: colors.ink, fontSize: 13.5, flex: 1 },
  textoFeito: { color: colors.muted, textDecorationLine: 'line-through' },
  textoEditando: { borderBottomWidth: 1, borderBottomColor: colors.forest500, paddingVertical: 2 },
  remover: { paddingHorizontal: 6, paddingVertical: 2 },
  removerTexto: { color: colors.muted, fontSize: 13, fontWeight: '800' },
  novaLinha: { flexDirection: 'row', gap: 8, marginTop: 10 },
  entrada: { flex: 1, borderWidth: 1, borderColor: colors.line, borderRadius: radii.small, paddingHorizontal: 11, paddingVertical: 10, color: colors.ink, fontSize: 13, backgroundColor: colors.cream },
  adicionar: { backgroundColor: colors.forest700, borderRadius: radii.small, paddingHorizontal: 16, justifyContent: 'center' },
  adicionarOff: { opacity: 0.45 },
  adicionarTexto: { color: 'white', fontWeight: '800', fontSize: 13 },
});
