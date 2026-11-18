/**
 * Liczba niezapisanych zmian na liście (checklisty, pola szablonu): elementy nowe, usunięte, zmienione i przestawione –
 * każdy raz. Przestawione = poza najdłuższym ciągiem niezmienionych elementów w zapisanej kolejności (najmniej
 * przeniesień, które dają obecny układ), więc przeniesienie jednego elementu to 1, a nie liczba przesuniętych sąsiadów;
 * element przeniesiony i zmieniony (np. inny termin po przeniesieniu do innej grupy) też liczy się raz.
 */
export function countListChanges<T>(now: T[], saved: T[], id: (x: T) => string | number | null | undefined): number {
  const byId = new Map<string | number, { x: T; i: number }>();
  saved.forEach((x, i) => {
    const k = id(x);
    if (k != null) byId.set(k, { x, i });
  });
  const strip = (x: T) => JSON.stringify(x);
  const kept = now.filter((x) => {
    const k = id(x);
    return k != null && byId.has(k);
  });
  const orig = (x: T) => byId.get(id(x) as string | number)!;
  const edited = kept.filter((x) => strip(x) !== strip(orig(x).x));
  const plain = kept.filter((x) => strip(x) === strip(orig(x).x));
  // najdłuższy rosnący podciąg zapisanych pozycji (listy są krótkie – O(n²) wystarczy)
  const pos = plain.map((x) => orig(x).i);
  const len = pos.map(() => 1);
  for (let i = 0; i < pos.length; i++) for (let j = 0; j < i; j++) if (pos[j] < pos[i] && len[j] + 1 > len[i]) len[i] = len[j] + 1;
  const inOrder = len.length ? Math.max(...len) : 0;
  return edited.length + (plain.length - inOrder) + (now.length - kept.length) + (saved.length - kept.length);
}
