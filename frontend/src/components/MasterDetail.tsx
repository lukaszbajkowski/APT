import type { ReactNode } from "react";
import { Box, Paper, Stack } from "@mantine/core";

/**
 * Układ „skrzynka” (komputer): nagłówek strony z jedną akcją główną, pod nim ramka z listą po lewej,
 * szczegółami w środku i opcjonalną kolumną kontekstu po prawej (tylko na szerokim ekranie ≥ 1600 px).
 * Na telefonie jedno okno naraz (steruje tym rodzic).
 */
export function MasterDetail({
  mobile,
  showList,
  showRight,
  list,
  detail,
  plainDetail,
  head,
  aside,
}: {
  mobile: boolean;
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
      <Paper withBorder radius="md" className="ui-inbox" data-head={head ? true : undefined}>
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
