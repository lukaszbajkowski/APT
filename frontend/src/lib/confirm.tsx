import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { Button, Group, Modal, Text } from "@mantine/core";

interface Options {
  message: string;
  title?: string;
  confirmLabel?: string;
  danger?: boolean;
}
type Confirm = (opts: string | Options) => Promise<boolean>;

const Ctx = createContext<Confirm>(() => Promise.resolve(window.confirm("Na pewno?")));

/** Okno potwierdzenia w stylu aplikacji (zamiast natywnego window.confirm). Użycie: if (await confirm("...")) … */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [opts, setOpts] = useState<Options | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);
  const confirm = useCallback<Confirm>((o) => {
    setOpts(typeof o === "string" ? { message: o } : o);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);
  const close = (ok: boolean) => {
    resolver.current?.(ok);
    resolver.current = null;
    setOpts(null);
  };
  return (
    <Ctx.Provider value={confirm}>
      {children}
      <Modal opened={!!opts} onClose={() => close(false)} title={opts?.title ?? "Potwierdź"} centered size="sm">
        <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>
          {opts?.message}
        </Text>
        <Group justify="flex-end" mt="lg">
          <Button variant="default" onClick={() => close(false)}>
            Anuluj
          </Button>
          <Button color={opts?.danger ? "red" : undefined} onClick={() => close(true)} data-autofocus>
            {opts?.confirmLabel ?? "Potwierdź"}
          </Button>
        </Group>
      </Modal>
    </Ctx.Provider>
  );
}

export const useConfirm = () => useContext(Ctx);
