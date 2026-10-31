import type { ReactNode } from "react";
import { Box, Paper, Stack } from "@mantine/core";

/** Układ „komunikator”: lista po lewej, szczegóły po prawej; na telefonie jedno okno naraz (steruje tym rodzic). */
export function MasterDetail({
  mobile,
  showList,
  showRight,
  list,
  detail,
  plainDetail,
}: {
  mobile: boolean;
  showList: boolean;
  showRight: boolean;
  list: ReactNode;
  detail: ReactNode;
  plainDetail?: boolean;
}) {
  return (
    <Paper withBorder radius="md" style={{ display: "flex", height: "calc(100dvh - 110px)", minHeight: 420, overflow: "hidden" }}>
      {showList && (
        <Stack
          gap={0}
          w={mobile ? "100%" : 340}
          style={{ borderRight: mobile ? undefined : "1px solid var(--mantine-color-default-border)", minHeight: 0 }}
        >
          {list}
        </Stack>
      )}
      {showRight && (
        <Box style={{ flex: 1, minWidth: 0, minHeight: 0, ...(plainDetail ? {} : { display: "flex", flexDirection: "column" }) }}>{detail}</Box>
      )}
    </Paper>
  );
}
