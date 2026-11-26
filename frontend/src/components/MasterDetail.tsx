import { useEffect, useRef, useState, type ReactNode } from "react";
import { Box, Paper, Stack } from "@mantine/core";

/**
 * Układ „skrzynka” (komputer): nagłówek strony z jedną akcją główną, pod nim ramka z listą po lewej,
 * szczegółami w środku i opcjonalną kolumną kontekstu po prawej (tylko na szerokim ekranie ≥ 1600 px).
 * Na telefonie jedno okno naraz (steruje tym rodzic).
 */
export function MasterDetail({
  mobile,
  single,
  showList,
  showRight,
  list,
  detail,
  plainDetail,
  head,
  aside,
}: {
  mobile: boolean;
  /** wąski obszar na komputerze: widać listę albo szczegóły, na całą szerokość ramki */
  single?: boolean;
  showList: boolean;
  showRight: boolean;
  list: ReactNode;
  detail: ReactNode;
  plainDetail?: boolean;
  /** nagłówek strony nad ramką (tytuł i akcja główna) */
  head?: ReactNode;
  /** kolumna kontekstu po prawej – widoczna od 1600 px */
  aside?: ReactNode;
}) {
  // telefon: widać jedną część naraz – naturalna wysokość, przewija się tylko strona (bez drugiego paska przewijania w środku)
  if (mobile)
    return (
      <Box className="ui-md-mobile">
        {showList ? <Stack gap={0}>{list}</Stack> : showRight ? <Box>{detail}</Box> : null}
      </Box>
    );
  return (
    <div className="ui-inbox-page">
      {head}
      <Paper withBorder radius="md" className="ui-inbox" data-head={head ? true : undefined} data-single={single || undefined}>
        {showList && (
          <Stack gap={0} className="ui-inbox-list">
            {list}
          </Stack>
        )}
        {showRight && (
          <Box style={{ flex: 1, minWidth: 0, minHeight: 0, ...(plainDetail ? {} : { display: "flex", flexDirection: "column" }) }}>{detail}</Box>
        )}
        {aside && <aside className="ui-inbox-aside">{aside}</aside>}
      </Paper>
    </div>
  );
}

/** Wąski obszar treści na komputerze (< 880 px – ten sam próg co Checklisty): lista albo szczegóły, nie obie ściśnięte.
 *  Ref na element otaczający MasterDetail; na telefonie nie mierzy (tam rządzi `mobile`). */
export function useNarrowArea(mobile: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || mobile) return;
    const ro = new ResizeObserver(([e]) => setNarrow(e.contentRect.width < 880));
    ro.observe(el);
    return () => ro.disconnect();
  }, [mobile]);
  return [ref, narrow && !mobile] as const;
}
