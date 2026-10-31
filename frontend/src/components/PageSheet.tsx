import { Box, type BoxProps } from "@mantine/core";

import { withAcct } from "../api";

/** Jedna strona dokumentu jako „biała kartka” (obraz z serwera, ze znakiem wodnym, bez możliwości pobrania). */
export function PageSheet({ index, src, ...rest }: { index: number; src: string } & BoxProps) {
  return (
    <Box
      role="img"
      aria-label={`Strona ${index + 1}`}
      w="100%"
      {...rest}
      style={{
        aspectRatio: "210 / 297",
        backgroundImage: `url(${withAcct(src)})`,
        backgroundSize: "contain",
        backgroundRepeat: "no-repeat",
        backgroundPosition: "center top",
        backgroundColor: "#fff", // papier jest zawsze biały, także w ciemnym motywie
        boxShadow: "0 1px 4px rgba(0,0,0,.15)",
        pointerEvents: "none",
      }}
    />
  );
}
