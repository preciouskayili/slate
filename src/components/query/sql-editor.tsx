import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab, toggleComment } from "@codemirror/commands";
import { PostgreSQL, sql, type SQLNamespace } from "@codemirror/lang-sql";
import { bracketMatching, HighlightStyle, indentOnInput, syntaxHighlighting } from "@codemirror/language";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { Compartment, EditorState, RangeSetBuilder, StateEffect, StateField, type Extension } from "@codemirror/state";
import {
  Decoration,
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  placeholder as placeholderExt,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { tags as t } from "@lezer/highlight";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { splitStatements, statementAt } from "@shared/sql";

const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.operatorKeyword, t.modifier, t.controlKeyword], color: "rgb(var(--syn-keyword))", fontWeight: "500" },
  { tag: [t.string, t.special(t.string)], color: "rgb(var(--syn-string))" },
  { tag: [t.number, t.bool, t.null], color: "rgb(var(--syn-number))" },
  { tag: [t.typeName, t.standard(t.name)], color: "rgb(var(--syn-type))" },
  { tag: [t.function(t.variableName), t.function(t.name)], color: "rgb(var(--syn-fn))" },
  { tag: [t.comment, t.lineComment, t.blockComment], color: "rgb(var(--fg) / 0.38)", fontStyle: "italic" },
  { tag: [t.operator, t.punctuation, t.bracket], color: "rgb(var(--fg) / 0.6)" },
]);

// ---- Error underline

const setError = StateEffect.define<{ from: number; to: number } | null>();
const errorField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setError)) {
        deco = e.value && e.value.to > e.value.from ? Decoration.set([Decoration.mark({ class: "cm-error-mark" }).range(e.value.from, e.value.to)]) : Decoration.none;
      }
    }
    if (tr.docChanged) deco = Decoration.none;
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

// ---- Highlight the statement ⌘↵ will run

const statementLine = Decoration.line({ class: "cm-statement-active" });
const statementHighlighter = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = this.build(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.selectionSet || u.focusChanged) this.decorations = this.build(u.view);
    }
    build(view: EditorView): DecorationSet {
      const doc = view.state.doc.toString();
      const sel = view.state.selection.main;
      if (!view.hasFocus || !sel.empty || splitStatements(doc).length < 2) return Decoration.none;
      const stmt = statementAt(doc, sel.head);
      if (!stmt) return Decoration.none;
      const builder = new RangeSetBuilder<Decoration>();
      const first = view.state.doc.lineAt(stmt.from).number;
      const last = view.state.doc.lineAt(stmt.to).number;
      for (let n = first; n <= last; n++) builder.add(view.state.doc.line(n).from, view.state.doc.line(n).from, statementLine);
      return builder.finish();
    }
  },
  { decorations: (v) => v.decorations },
);

export interface RunRequest {
  text: string;
  offset: number;
  all: boolean;
}

export interface SqlEditorHandle {
  view: EditorView | null;
  focus(): void;
  showError(pos: number | undefined): void;
  setValue(value: string): void;
  insert(text: string): void;
  /** Selection, else statement at cursor. */
  target(all?: boolean): RunRequest | null;
}

interface Props {
  value: string;
  onChange?: (value: string) => void;
  schema?: SQLNamespace;
  defaultSchema?: string;
  readOnly?: boolean;
  placeholder?: string;
  lineNumbers?: boolean;
  onRun?: (req: RunRequest) => void;
  onExplain?: (req: RunRequest) => void;
  onSave?: () => void;
  onFormat?: () => void;
  autoFocus?: boolean;
}

export const SqlEditor = forwardRef<SqlEditorHandle, Props>(function SqlEditor(props, ref) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const cbs = useRef(props);
  cbs.current = props;
  const langCompartment = useRef(new Compartment());

  const target = (all = false): RunRequest | null => {
    const v = view.current;
    if (!v) return null;
    const doc = v.state.doc.toString();
    const sel = v.state.selection.main;
    if (all) return { text: doc, offset: 0, all: true };
    if (!sel.empty) return { text: doc.slice(sel.from, sel.to), offset: sel.from, all: false };
    const stmt = statementAt(doc, sel.head);
    return stmt ? { text: stmt.text, offset: stmt.from, all: false } : null;
  };

  useImperativeHandle(ref, () => ({
    get view() {
      return view.current;
    },
    focus: () => view.current?.focus(),
    showError(pos) {
      const v = view.current;
      if (!v) return;
      if (pos === undefined || pos < 0) {
        v.dispatch({ effects: setError.of(null) });
        return;
      }
      const doc = v.state.doc;
      const from = Math.min(pos, doc.length);
      const word = /^[\w."$]+/.exec(doc.sliceString(from, from + 80))?.[0].length ?? 1;
      const to = Math.min(doc.length, from + Math.max(1, word));
      v.dispatch({ effects: setError.of({ from, to }), selection: { anchor: from }, scrollIntoView: true });
    },
    setValue(value) {
      const v = view.current;
      if (v) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } });
    },
    insert(text) {
      const v = view.current;
      if (!v) return;
      v.dispatch(v.state.replaceSelection(text));
      v.focus();
    },
    target,
  }));

  const language = (): Extension =>
    sql({ dialect: PostgreSQL, schema: cbs.current.schema, defaultSchema: cbs.current.defaultSchema ?? "public", upperCaseKeywords: true });

  useEffect(() => {
    const run = (all: boolean) => () => {
      const req = target(all);
      if (req) cbs.current.onRun?.(req);
      return true;
    };
    const state = EditorState.create({
      doc: props.value,
      extensions: [
        props.lineNumbers === false ? [] : [lineNumbers(), highlightActiveLineGutter()],
        history(),
        drawSelection(),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        autocompletion({ activateOnTyping: true, icons: true }),
        langCompartment.current.of(language()),
        syntaxHighlighting(highlight),
        errorField,
        statementHighlighter,
        EditorView.lineWrapping,
        props.placeholder ? placeholderExt(props.placeholder) : [],
        EditorState.readOnly.of(Boolean(props.readOnly)),
        EditorView.editable.of(!props.readOnly),
        keymap.of([
          { key: "Mod-Enter", run: run(false), preventDefault: true },
          { key: "Shift-Mod-Enter", run: run(true), preventDefault: true },
          {
            key: "Mod-e",
            run: () => {
              const req = target(false);
              if (req) cbs.current.onExplain?.(req);
              return true;
            },
            preventDefault: true,
          },
          { key: "Mod-s", run: () => (cbs.current.onSave?.(), true), preventDefault: true },
          { key: "Shift-Alt-f", run: () => (cbs.current.onFormat?.(), true), preventDefault: true },
          { key: "Mod-/", run: toggleComment },
          ...closeBracketsKeymap,
          ...completionKeymap,
          ...searchKeymap,
          ...historyKeymap,
          indentWithTab,
          ...defaultKeymap,
        ]),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) cbs.current.onChange?.(u.state.doc.toString());
        }),
      ],
    });
    view.current = new EditorView({ state, parent: host.current! });
    if (props.autoFocus) {
      view.current.focus();
      view.current.dispatch({ selection: { anchor: view.current.state.doc.length } });
    }
    return () => {
      view.current?.destroy();
      view.current = null;
    };
  }, []);

  // Reconfigure autocomplete when the schema arrives/changes.
  useEffect(() => {
    view.current?.dispatch({ effects: langCompartment.current.reconfigure(language()) });
  }, [props.schema, props.defaultSchema]);

  // External value changes (e.g. read-only DDL view)
  useEffect(() => {
    const v = view.current;
    if (v && props.value !== v.state.doc.toString()) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: props.value } });
  }, [props.value]);

  return <div ref={host} className="h-full min-h-0 overflow-hidden" />;
});

/** Build the autocomplete namespace: schema → table → columns. */
export function buildNamespace(columns: Record<string, string[]> | undefined): SQLNamespace | undefined {
  if (!columns) return undefined;
  const ns: Record<string, Record<string, string[]>> = {};
  for (const [key, cols] of Object.entries(columns)) {
    const dot = key.indexOf(".");
    const schema = key.slice(0, dot);
    const table = key.slice(dot + 1);
    (ns[schema] ??= {})[table] = cols;
  }
  return ns;
}
