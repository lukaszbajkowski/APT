import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { IconGripVertical } from "@tabler/icons-react";

import type { TemplateField } from "../api";
import { CanvasField, announce } from "./TemplateEditDesktop";

/**
 * Komputer: formularz jako płótno w dwóch kolumnach (jak „Nowy dokument”).
 * Przeciąganie: chwyt za ⋮⋮, pole/grupa jedzie za kursorem, reszta formularza na bieżąco się przestawia (animacja FLIP),
 * w miejscu docelowym widać szczelinę. Klawiatura: ↑/↓ na ⋮⋮ (pole – o jedno miejsce, na brzegu grupy wchodzi/wychodzi; grupa – o jeden blok).
 */
type Drag =
  | { kind: "field"; key: string; order: TemplateField[]; x: number; y: number; dx: number; dy: number; w: number }
  | { kind: "group"; group: string; order: TemplateField[]; x: number; y: number; dx: number; dy: number; w: number };

const blocksOf = (fields: TemplateField[]) => {
  const out: TemplateField[][] = [];
  for (const f of fields) {
    const last = out[out.length - 1];
    if (f.group && last && last[0].group === f.group) last.push(f);
    else out.push([f]);
  }
  return out;
};

export function GridCanvas({
  fields,
  selected,
  onSelect,
  onMove,
  onMoveGroup,
  groupName,
  groupActions,
  formatLabel,
  moved,
}: {
  fields: TemplateField[];
  selected: number;
  onSelect: (i: number) => void;
  onMove: (from: number, to: number, group: string | null) => void;
  onMoveGroup: (fromBlock: number, toBlock: number) => void;
  groupName: (g: string) => ReactNode;
  groupActions: (g: string) => ReactNode;
  formatLabel: (f: TemplateField) => string | undefined;
  moved?: string | null;
}) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  dragRef.current = drag;
  const box = useRef<HTMLDivElement>(null);
  const raf = useRef<number | null>(null);
  const pointer = useRef({ x: 0, y: 0, startY: 0 });

  // —— animacja FLIP: elementy płynnie przechodzą na nowe miejsce, gdy kolejność się zmienia ——
  const lastPos = useRef(new Map<string, { x: number; y: number }>());
  useLayoutEffect(() => {
    const root = box.current;
    if (!root) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const next = new Map<string, { x: number; y: number }>();
    root.querySelectorAll<HTMLElement>("[data-flip]").forEach((el) => {
      const r = el.getBoundingClientRect();
      const pos = { x: r.left + window.scrollX, y: r.top + window.scrollY };
      const k = el.dataset.flip!;
      next.set(k, pos);
      const prev = lastPos.current.get(k);
      if (!prev || reduce || !dragRef.current) return;
      const dx = prev.x - pos.x;
      const dy = prev.y - pos.y;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], { duration: 160, easing: "cubic-bezier(.2,.8,.2,1)" });
    });
    lastPos.current = next;
  });

  const view = drag?.order ?? fields;
  const blocks = blocksOf(view);

  // —— wyznaczenie miejsca pod kursorem ——
  const recompute = () => {
    const d = dragRef.current;
    if (!d) return;
    const { x, y } = pointer.current;
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    const cell = el?.closest<HTMLElement>("[data-cell]");
    const head = el?.closest<HTMLElement>("[data-ghead]");
    const base = fields;
    if (d.kind === "field") {
      const me = base.find((f) => f.key === d.key)!;
      const rest = base.filter((f) => f.key !== d.key);
      let order: TemplateField[] | null = null;
      if (cell && cell.dataset.cell !== d.key) {
        const target = rest.findIndex((f) => f.key === cell.dataset.cell);
        if (target < 0) return;
        const r = cell.getBoundingClientRect();
        const after = x > r.left + r.width / 2 || y > r.bottom - r.height / 4;
        const at = after ? target + 1 : target;
        const g = rest[target].group ?? null;
        order = [...rest.slice(0, at), { ...me, group: g }, ...rest.slice(at)];
      } else if (head) {
        const g = head.dataset.ghead!;
        const start = rest.findIndex((f) => f.group === g);
        const r = head.getBoundingClientRect();
        const inside = y > r.top + r.height / 2;
        order = [...rest.slice(0, start), { ...me, group: inside ? g : null }, ...rest.slice(start)];
      }
      if (order && order.map((f) => f.key + (f.group ?? "")).join() !== d.order.map((f) => f.key + (f.group ?? "")).join()) {
        setDrag({ ...d, order });
      }
    } else {
      const bs = blocksOf(base);
      const from = bs.findIndex((b) => b[0].group === d.group);
      const keyOver = cell?.dataset.cell ?? (head ? `g:${head.dataset.ghead}` : null);
      if (!keyOver) return;
      const overBlock = keyOver.startsWith("g:") ? bs.findIndex((b) => b[0].group === keyOver.slice(2)) : bs.findIndex((b) => b.some((f) => f.key === keyOver));
      if (overBlock < 0 || overBlock === from) return;
      const r = (cell ?? head)!.getBoundingClientRect();
      const after = y > r.top + r.height / 2;
      const rest = bs.filter((_, j) => j !== from);
      let at = rest.indexOf(bs[overBlock]) + (after ? 1 : 0);
      at = Math.max(0, Math.min(rest.length, at));
      const order = [...rest.slice(0, at), bs[from], ...rest.slice(at)].flat();
      if (order.map((f) => f.key).join() !== d.order.map((f) => f.key).join()) setDrag({ ...d, order });
    }
  };

  // —— przewijanie przy krawędzi okna (pasek „Zapisz szablon” to dolna krawędź) ——
  const loop = () => {
    const d = dragRef.current;
    if (!d) return;
    const { y, startY } = pointer.current;
    const bar = document.querySelector<HTMLElement>(".ui-tpe-save");
    const bottom = (bar ? bar.getBoundingClientRect().top : window.innerHeight) - 72;
    const top = 72;
    const moved = y - startY;
    const v = y < top && moved < -12 ? -Math.min(20, 4 + Math.round((top - y) / 4)) : y > bottom && moved > 12 ? Math.min(20, 4 + Math.round((y - bottom) / 4)) : 0;
    if (v) {
      window.scrollBy(0, v);
      recompute();
    }
    raf.current = requestAnimationFrame(loop);
  };

  const begin = (e: React.PointerEvent, d: Drag) => {
    e.preventDefault();
    pointer.current = { x: e.clientX, y: e.clientY, startY: e.clientY };
    setDrag(d);
    raf.current = requestAnimationFrame(loop);
  };
  const moveTo = (e: PointerEvent) => {
    if (!dragRef.current) return;
    pointer.current.x = e.clientX;
    pointer.current.y = e.clientY;
    setDrag((d) => (d ? { ...d, x: e.clientX, y: e.clientY } : d));
    recompute();
  };
  const finish = () => {
    if (raf.current) cancelAnimationFrame(raf.current);
    const d = dragRef.current;
    setDrag(null);
    if (document.activeElement instanceof HTMLElement && document.activeElement.classList.contains("ui-gc-handle")) document.activeElement.blur();
    if (!d) return;
    if (d.kind === "field") {
      const from = fields.findIndex((f) => f.key === d.key);
      const to = d.order.findIndex((f) => f.key === d.key);
      const g = d.order[to].group ?? null;
      if (from !== to || g !== (fields[from].group ?? null)) {
        onMove(from, to, g);
        announce(`${fields[from].label || "Pole"}: pozycja ${to + 1} z ${fields.length}, ${g ? `grupa ${g}` : "bez grupy"}`);
      }
    } else {
      const bs = blocksOf(fields);
      const from = bs.findIndex((b) => b[0].group === d.group);
      const to = blocksOf(d.order).findIndex((b) => b[0].group === d.group);
      if (from !== to) {
        onMoveGroup(from, to);
        announce(`Grupa ${d.group} przeniesiona`);
      }
    }
  };

  // ruch i puszczenie śledzimy na całym oknie – element chwyconego pola bywa tworzony od nowa przy przestawianiu
  const handlers = useRef({ moveTo, finish });
  handlers.current = { moveTo, finish };
  const dragging = !!drag;
  useEffect(() => {
    if (!dragging) return;
    const mv = (e: PointerEvent) => handlers.current.moveTo(e);
    const up = () => handlers.current.finish();
    window.addEventListener("pointermove", mv);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointermove", mv);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [dragging]);

  // —— klawiatura ——
  const refocus = (key: string) => requestAnimationFrame(() => box.current?.querySelector<HTMLElement>(`[data-handle="${CSS.escape(key)}"]`)?.focus());
  const keyStep = (i: number, dir: -1 | 1) => {
    const f = fields[i];
    const nb = fields[i + dir];
    const g = f.group ?? null;
    const ng = nb?.group ?? null;
    let to = i;
    let group: string | null = g;
    if (g && ng !== g) group = null;
    else if (!nb) return;
    else if (!g && ng) group = ng;
    else to = i + dir;
    onMove(i, to, group);
    refocus(f.key);
    announce(`${f.label || "Pole"}: pozycja ${to + 1} z ${fields.length}, ${group ? `grupa ${group}` : "bez grupy"}`);
  };
  const gKeyStep = (g: string, dir: -1 | 1) => {
    const bs = blocksOf(fields);
    const from = bs.findIndex((b) => b[0].group === g);
    const to = from + dir;
    if (to < 0 || to >= bs.length) return;
    onMoveGroup(from, to);
    refocus(`g:${g}`);
    announce(`Grupa ${g} przeniesiona ${dir < 0 ? "wyżej" : "niżej"}`);
  };
  const arrows = (fn: (dir: -1 | 1) => void) => (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    fn(e.key === "ArrowUp" ? -1 : 1);
  };

  const indexOf = (k: string) => fields.findIndex((f) => f.key === k);
  const cellFor = (f: TemplateField) => {
    const lifted = drag?.kind === "field" && drag.key === f.key;
    const i = indexOf(f.key);
    return (
      <div
        key={f.key}
        data-flip={f.key}
        data-cell={f.key}
        className="ui-gc-cell"
        data-placeholder={lifted || undefined}
        data-selected={(!drag && i === selected) || undefined}
        data-moved={moved === f.key || undefined}
      >
        <span
          className="ui-gc-handle"
          role="button"
          tabIndex={0}
          data-handle={f.key}
          title="Przeciągnij albo użyj strzałek ↑ ↓"
          aria-label={`${f.label || "Pole"}: przeciągnij albo użyj strzałek w górę i w dół`}
          onKeyDown={arrows((dir) => keyStep(i, dir))}
          onPointerDown={(e) => {
            const r = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
            begin(e, { kind: "field", key: f.key, order: fields, x: e.clientX, y: e.clientY, dx: e.clientX - r.left, dy: e.clientY - r.top, w: r.width });
          }}
        >
          <IconGripVertical size={16} aria-hidden />
        </span>
        <button type="button" className="ui-gc-body" onClick={() => !drag && onSelect(i)} aria-current={i === selected || undefined}>
          <CanvasField f={f} formatLabel={formatLabel(f)} />
        </button>
      </div>
    );
  };

  const draggedField = drag?.kind === "field" ? fields.find((f) => f.key === drag.key) : null;
  const draggedGroup = drag?.kind === "group" ? drag.group : null;
  const targetGroup = drag?.kind === "field" ? drag.order.find((f) => f.key === drag.key)?.group ?? null : null;

  return (
    <div ref={box} className="ui-gc" data-dragging={drag ? true : undefined}>
      {blocks.map((b, bi) =>
        b[0].group ? (
          <fieldset
            key={`g:${b[0].group}`}
            data-flip={`g:${b[0].group}`}
            className="ui-gc-group"
            data-placeholder={draggedGroup === b[0].group || undefined}
            data-target={(targetGroup === b[0].group && draggedField?.group !== b[0].group) || undefined}
          >
            <legend className="ui-gc-ghead" data-ghead={b[0].group}>
              <span
                className="ui-gc-handle"
                role="button"
                tabIndex={0}
                data-handle={`g:${b[0].group}`}
                title="Przeciągnij albo użyj strzałek ↑ ↓"
                aria-label={`Grupa ${b[0].group}: przeciągnij albo użyj strzałek w górę i w dół`}
                onKeyDown={arrows((dir) => gKeyStep(b[0].group!, dir))}
                onPointerDown={(e) => {
                  const r = (e.currentTarget.closest("fieldset") as HTMLElement).getBoundingClientRect();
                  begin(e, { kind: "group", group: b[0].group!, order: fields, x: e.clientX, y: e.clientY, dx: e.clientX - r.left, dy: 12, w: r.width });
                }}
              >
                <IconGripVertical size={16} aria-hidden />
              </span>
              <span className="ui-gc-gname">{groupName(b[0].group)}</span>
              {groupActions(b[0].group)}
            </legend>
            <div className="ui-gc-grid">{b.map(cellFor)}</div>
          </fieldset>
        ) : (
          // pola bez grupy: kolejne pojedyncze bloki składamy w jedną siatkę
          bi > 0 && !blocks[bi - 1][0].group ? null : (
            <div key={`loose:${b[0].key}`} className="ui-gc-grid">
              {blocks
                .slice(bi)
                .filter((_, j, arr) => arr.slice(0, j + 1).every((x) => !x[0].group))
                .flat()
                .map(cellFor)}
            </div>
          )
        ),
      )}
      {/* kopia pod kursorem */}
      {drag && (
        <div className="ui-gc-ghost" style={{ left: drag.x - drag.dx, top: drag.y - drag.dy, width: drag.w }} aria-hidden>
          {draggedField ? (
            <div className="ui-gc-cell" data-lifted>
              <span className="ui-gc-handle">
                <IconGripVertical size={16} />
              </span>
              <span className="ui-gc-body">
                <CanvasField f={{ ...draggedField, group: targetGroup }} formatLabel={formatLabel(draggedField)} />
              </span>
            </div>
          ) : (
            <div className="ui-gc-ghosthead">
              <IconGripVertical size={16} /> <b>{draggedGroup}</b> <span className="ui-tpl-meta">{((n) => (n === 1 ? "1 pole" : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? `${n} pola` : `${n} pól`))(fields.filter((f) => f.group === draggedGroup).length)}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
