import { forwardRef, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Button, type ButtonProps } from "@mantine/core";

/**
 * Jednolity przycisk akcji (styl „Szybkich akcji” ze strony Start): jasne tło, ikona po lewej.
 * Z `to` działa jak link, z `onClick` – jak zwykły przycisk. Nowe przyciski na stronie Start
 * dodawaj przez ten komponent, żeby wszystkie wyglądały tak samo.
 */
type Props = ButtonProps & { to?: string; icon?: ReactNode; onClick?: () => void; children: ReactNode };

export const ActionButton = forwardRef<HTMLButtonElement, Props>(function ActionButton({ to, icon, children, ...rest }, ref) {
  const common = { variant: "light" as const, size: "sm" as const, leftSection: icon, ...rest };
  return to ? (
    <Button component={Link} to={to} {...common}>
      {children}
    </Button>
  ) : (
    <Button ref={ref} {...common}>
      {children}
    </Button>
  );
});
