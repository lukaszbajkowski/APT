import { useState } from "react";
import { Box, type BoxProps } from "@mantine/core";

import { withAcct } from "../api";

/**
 * Jedna strona dokumentu jako „biała kartka” (obraz z serwera, ze znakiem wodnym, bez możliwości pobrania:
 * obraz nie reaguje na dotyk ani przeciąganie). Do wczytania kartka ma proporcje A4, potem proporcje strony –
 * strona pozioma (np. rzut mieszkania) nie zostawia pod sobą pustego pola.
 */
export function PageSheet({ index, src, ...rest }: { index: number; src: string } & BoxProps) {
  const [loaded, setLoaded] = useState(false);
  return (
    <Box
      role="img"
      aria-label={`Strona ${index + 1}`}
      w="100%"
      {...rest}
      style={{
        aspectRatio: loaded ? undefined : "210 / 297",
        backgroundColor: "#fff", // papier jest zawsze biały, także w ciemnym motywie
        boxShadow: "0 1px 4px rgba(0,0,0,.15)",
        pointerEvents: "none",
        userSelect: "none",
        WebkitTouchCallout: "none",
      }}
    >
      <img
        src={withAcct(src)}
        alt=""
        draggable={false}
        onLoad={() => setLoaded(true)}
        style={{ display: "block", width: "100%", height: "auto", pointerEvents: "none" }}
      />
    </Box>
  );
}
